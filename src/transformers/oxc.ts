import { pathToFileURL } from "node:url";
import { basename, dirname, extname, join, relative } from "pathe";
import { writeFile } from "node:fs/promises";
import { resolveModulePath } from "exsolve";
import MagicString from "magic-string";
import oxcTransform from "oxc-transform";
import oxcParser from "oxc-parser";
import { minify as oxcMinify } from "oxc-minify";

import type { ResolveOptions as ExsolveOptions } from "exsolve";
import type { TransformOptions as ExternalOxcTransformOptions } from "oxc-transform";
import type { ParserOptions as ExternalOxcParserOptions } from "oxc-parser";
import type { MinifyOptions as ExternalOxcMinifyOptions } from "oxc-minify";

import type {
  InputFile,
  OutputFile,
  SourceMapFile,
  Transformer,
  TransformerContext,
  TransformResult,
} from "./types.ts";
import { SourceMapConsumer, SourceMapGenerator } from "source-map-js";

export interface OxcTransformerOptions {
  oxc?: {
    /**
     * Options for module resolution.
     *
     * See [exsolve](https://github.com/unjs/exsolve) for more details.
     */
    resolve?: Omit<ExsolveOptions, "from">;

    /**
     * Options passed to oxc-transform.
     *
     * See [oxc-transform](https://www.npmjs.com/package/oxc-transform) for more details.
     */
    transform?: ExternalOxcTransformOptions;

    /**
     * Minify the output using oxc-minify.
     *
     * Defaults to `false` if not provided.
     */
    minify?: boolean | ExternalOxcMinifyOptions;
  };
}

type TransformableFile = OutputFile & {
  contents: string;
  extension: string;
};

type DeclarationFile = TransformableFile & {
  type: "declaration";
};

type MinifiedFile = TransformableFile & {
  type: "minified";
};

type ExtensionConfig = {
  transform?: boolean;
  declaration?: boolean;
  language?: ExternalOxcParserOptions["lang"];
  outputExtension?: `.${string}`;
};

type ProcessOptions = {
  resolve: ExsolveOptions;
  parser: ExternalOxcParserOptions;
  transform: ExternalOxcTransformOptions;
  minify: ExternalOxcMinifyOptions | false | undefined;
  extensionConfig: ExtensionConfig;
};

const extensionConfigs: Record<string, ExtensionConfig | undefined> = {
  ".ts": {
    transform: true,
    declaration: true,
    language: "ts",
    outputExtension: ".mjs",
  },
  ".mts": {
    transform: true,
    declaration: true,
    language: "ts",
    outputExtension: ".mjs",
  },
  ".tsx": {
    transform: true,
    declaration: true,
    language: "tsx",
    outputExtension: ".mjs",
  },
  ".jsx": {
    transform: true,
    declaration: true,
    language: "jsx",
    outputExtension: ".mjs",
  },
  ".js": {},
  ".mjs": {},
  ".cjs": {},
};

const DECLARATION_RE = /\.d\.[cm]?ts$/;

export const oxcTransformer: Transformer = async (
  input,
  context,
): Promise<TransformResult> => {
  const extensionConfig = extensionConfigs[input.extension];

  if (DECLARATION_RE.test(input.path) || extensionConfig === undefined) {
    return;
  }

  const options = resolveProcessOptions(input, context, extensionConfig);
  const outputFiles = await processFile(
    {
      path: input.path,
      srcPath: input.srcPath,
      extension: extensionConfig.outputExtension || input.extension,
      contents: await input.getContents(),
      type: "code",
    },
    options,
  );

  return outputFiles.filter((file) => file !== undefined);
};

async function processFile(
  file: TransformableFile,
  options: ProcessOptions,
): Promise<Array<OutputFile | undefined>> {
  if (!options.extensionConfig.transform) {
    if (!options.minify) {
      return [{ ...file, raw: true }];
    }

    return minify(file, options.minify);
  }

  const [transformedFile, declarationFile, transformSourceMapFile] =
    await transform(rewriteSpecifiers(file, options), options.transform);

  if (!options.minify) {
    return [transformedFile, declarationFile, transformSourceMapFile];
  }

  const [minifiedFile, sourceMapFile] = await minify(
    transformedFile,
    options.minify,
    transformSourceMapFile,
  );

  return [minifiedFile, sourceMapFile, declarationFile];
}

function resolveProcessOptions(
  input: InputFile,
  context: TransformerContext,
  extensionConfig: ExtensionConfig,
): ProcessOptions {
  const { oxc: options } = context.options;

  const resolve: ExsolveOptions = {
    ...options?.resolve,
    extensions: options?.resolve?.extensions ?? [
      ".tsx",
      ".ts",
      ".jsx",
      ".js",
      ".mjs",
      ".cjs",
      ".json",
    ],
    suffixes: options?.resolve?.suffixes ?? ["", "/index"],
  };

  const parser: ExternalOxcParserOptions = {
    lang: extensionConfig.language,
    sourceType: "module",
  };

  const sourcemap =
    (typeof options?.minify === "object" && options.minify.sourcemap) ||
    options?.transform?.sourcemap;

  const transform: ExternalOxcTransformOptions = {
    ...options?.transform,
    ...parser,
    cwd: input.srcPath ? dirname(input.srcPath) : undefined,
    typescript: {
      declaration: {
        // @todo - Should we make this also the default for the bundler?
        stripInternal: true,
      },
      ...options?.transform?.typescript,
      ...(extensionConfig.declaration === false
        ? { declaration: undefined }
        : {}),
    },
    sourcemap,
  };

  const minify: ExternalOxcMinifyOptions | false | undefined =
    options?.minify === true
      ? { sourcemap }
      : options?.minify === undefined
        ? undefined
        : { ...options?.minify, sourcemap };

  return {
    resolve,
    parser,
    transform,
    minify,
    extensionConfig,
  };
}

async function transform(
  input: Readonly<TransformableFile>,
  options?: ExternalOxcTransformOptions,
): Promise<
  | [TransformableFile]
  | [TransformableFile, DeclarationFile]
  | [TransformableFile, DeclarationFile, SourceMapFile]
> {
  const {
    code: transformedCode,
    declaration,
    map: sourceMap,
    errors: transformErrors,
  } = oxcTransform.transform(input.path, input.contents, options);

  const errors = transformErrors.filter(
    (err) => !err.message.includes("--isolatedDeclarations"),
  );

  if (errors.length > 0) {
    await writeFile(
      "build-dump.ts",
      `/** Error dump for ${input.srcPath} */\n\n` + input.contents,
      "utf8",
    );
    throw new Error(
      `Errors while transforming ${input.srcPath}: (hint: check build-dump.ts)`,
      {
        cause: errors,
      },
    );
  }

  const transformedFile = {
    ...input,
    contents: transformedCode,
  };

  if (!declaration) {
    return [transformedFile];
  }

  const declarationFile: DeclarationFile = {
    srcPath: input.srcPath,
    contents: declaration,
    path: input.path,
    extension: ".d.mts",
    type: "declaration",
  };

  if (!sourceMap) {
    return [transformedFile, declarationFile];
  }

  const transformedFileName = replaceExtension(
    basename(input.path),
    input.extension,
  );

  const sourceMapFile: SourceMapFile = {
    srcPath: input.srcPath,
    path: input.path,
    extension: `${input.extension}.map`,
    type: "source-map",
    map: {
      ...sourceMap,
      file: transformedFileName,
      version: String(sourceMap.version),
    },
  };

  return [transformedFile, declarationFile, sourceMapFile];
}

async function minify(
  input: Readonly<TransformableFile>,
  options?: ExternalOxcMinifyOptions,
  transformSourceMapFile?: Readonly<SourceMapFile>,
): Promise<[MinifiedFile] | [MinifiedFile, SourceMapFile]> {
  const { code: minifedCode, map: sourceMap } = oxcMinify(
    input.path,
    input.contents,
    {
      ...options,
      ...(transformSourceMapFile ? { sourcemap: true } : {}),
    },
  );

  const minifiedFile: MinifiedFile = {
    ...input,
    type: "minified",
    contents: minifedCode,
  };

  if (!sourceMap) {
    return [minifiedFile];
  }

  const minifiedFileName = basename(replaceExtension(input.path));

  if (!transformSourceMapFile) {
    const sourceMapFile: SourceMapFile = {
      srcPath: input.srcPath,
      path: input.path,
      extension: `${input.extension}.map`,
      type: "source-map",
      map: {
        ...sourceMap,
        file: minifiedFileName,
        version: String(sourceMap.version),
      },
    };

    return [minifiedFile, sourceMapFile];
  }

  // The source map is based on the minified code
  const generator = SourceMapGenerator.fromSourceMap(
    new SourceMapConsumer({
      ...sourceMap,
      version: String(sourceMap.version),
    }),
  );

  // Apply the transformed source map to the minified map
  generator.applySourceMap(new SourceMapConsumer(transformSourceMapFile.map));

  const sourceMapFile: SourceMapFile = {
    ...transformSourceMapFile,
    map: {
      ...generator.toJSON(),
      file: minifiedFileName,
    },
  };

  return [minifiedFile, sourceMapFile];
}

function replaceExtension(path: string, targetExtension?: string): string {
  const sourceExtension = extname(path);

  if (targetExtension === undefined) {
    const config = extensionConfigs[sourceExtension];

    if (config?.outputExtension === undefined) {
      return path;
    }

    targetExtension = config.outputExtension;
  }

  return join(dirname(path), basename(path, sourceExtension)) + targetExtension;
}

function rewriteSpecifiers(
  file: Readonly<TransformableFile>,
  options?: {
    parser?: ExternalOxcParserOptions;
    resolve?: ExsolveOptions;
  },
): TransformableFile {
  const { srcPath } = file;

  if (srcPath === undefined) {
    // Skip rewriting if srcPath is not available
    return { ...file };
  }

  const parsed = oxcParser.parseSync(file.path, file.contents, options?.parser);

  if (parsed.errors.length > 0) {
    throw new Error(`Errors while parsing ${file.path}:`, {
      cause: parsed.errors,
    });
  }

  const magicString = new MagicString(file.contents);

  // Rewrite relative imports
  const updatedStarts = new Set<number>();
  const rewriteSpecifier = (req: {
    value: string;
    start: number;
    end: number;
  }) => {
    const moduleId = req.value;
    if (!moduleId.startsWith(".")) {
      return;
    }
    if (updatedStarts.has(req.start)) {
      return; // prevent double rewritings
    }
    updatedStarts.add(req.start);
    const resolvedAbsolute = resolveModulePath(moduleId, {
      ...options?.resolve,
      from: pathToFileURL(srcPath),
    });
    const newId = relative(
      dirname(srcPath),
      replaceExtension(resolvedAbsolute),
    );
    magicString.remove(req.start, req.end);
    magicString.prependLeft(
      req.start,
      JSON.stringify(newId.startsWith(".") ? newId : `./${newId}`),
    );
  };

  for (const staticImport of parsed.module.staticImports) {
    rewriteSpecifier(staticImport.moduleRequest);
  }

  for (const staticExport of parsed.module.staticExports) {
    for (const staticExportEntry of staticExport.entries) {
      if (staticExportEntry.moduleRequest) {
        rewriteSpecifier(staticExportEntry.moduleRequest);
      }
    }
  }

  return {
    ...file,
    contents: magicString.toString(),
  };
}
