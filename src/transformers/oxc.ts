import { pathToFileURL } from "node:url";
import { basename, dirname, extname, relative } from "node:path";
import { writeFile } from "node:fs/promises";
import { resolveModulePath } from "exsolve";
import MagicString from "magic-string";
import oxcTransform from "oxc-transform";
import oxcParser from "oxc-parser";
import { minify as oxcMinify } from "oxc-minify";

import type { ResolveOptions } from "exsolve";
import type { TransformOptions as ExternalOxcTransformOptions } from "oxc-transform";
import type { ParserOptions as ExternalOxcParserOptions } from "oxc-parser";
import type { MinifyOptions as ExternalOxcMinifyOptions } from "oxc-minify";
import type { OutputFile, Transformer, TransformResult } from "./types.ts";

type Extension = `.${string}`;

type TransformConfig = Record<
  string,
  {
    transform?: boolean;
    language?: ExternalOxcParserOptions["lang"];
    extension?: Extension;
    declaration?: Extension | false;
  }
>;

const transformConfig: Partial<TransformConfig> = {
  ".ts": {
    transform: true,
    language: "ts",
    extension: ".mjs",
    declaration: ".d.mts",
  },
  ".tsx": {
    transform: true,
    language: "tsx",
    extension: ".jsx",
    declaration: ".d.mts",
  },
  ".jsx": {
    transform: true,
    language: "jsx",
  },
  ".js": {},
  ".mjs": {},
  ".cjs": {},
};

export interface OxcTransformerOptions {
  oxc?: {
    /**
     * Options for module resolution.
     *
     * See [exsolve](https://github.com/unjs/exsolve) for more details.
     */
    resolve?: Omit<ResolveOptions, "from">;

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

type MinifiableFile = OutputFile & {
  contents: string;
  srcPath: string;
  extension: string;
};

export const oxcTransformer: Transformer = async (
  input,
  context,
): Promise<TransformResult> => {
  const { extension = extname(input.path), srcPath } = input;
  const { options } = context;
  const fileTransformConfig = transformConfig[extension];

  if (srcPath === undefined || fileTransformConfig === undefined) {
    return undefined;
  }

  const code: MinifiableFile = {
    path: input.path,
    srcPath,
    extension: fileTransformConfig.extension || extension,
    contents: await input.getContents(),
  };
  const output: OutputFile[] = [code];
  const minifyOptions = options.oxc?.minify === true ? {} : options.oxc?.minify;

  if (!fileTransformConfig.transform) {
    if (minifyOptions) {
      output.push(...minify(code, minifyOptions));
      code.skip = true; // Skip the original file if minifying
    }

    return output;
  }

  const sourceOptions: ExternalOxcParserOptions = {
    lang: fileTransformConfig.language,
    sourceType: "module",
  };

  code.contents = rewriteSpecifiers(srcPath, code.contents, {
    ...sourceOptions,
    ...options?.oxc?.resolve,
  });

  const transformed = oxcTransform.transform(srcPath, code.contents, {
    ...options?.oxc?.transform,
    ...sourceOptions,
    cwd: dirname(srcPath),
    typescript: {
      declaration: { stripInternal: true },
      ...options.oxc?.transform?.typescript,
    },
  });

  if (fileTransformConfig.declaration && transformed.declaration) {
    output.push({
      srcPath,
      contents: transformed.declaration,
      declaration: true,
      path: input.path,
      extension: fileTransformConfig.declaration,
    });
  }

  const transformErrors = transformed.errors.filter(
    (err) => !err.message.includes("--isolatedDeclarations"),
  );

  if (transformErrors.length > 0) {
    await writeFile(
      "build-dump.ts",
      `/** Error dump for ${input.srcPath} */\n\n` + code.contents,
      "utf8",
    );
    throw new Error(
      `Errors while transforming ${input.srcPath}: (hint: check build-dump.ts)`,
      {
        cause: transformErrors,
      },
    );
  }

  code.contents = transformed.code;

  if (minifyOptions) {
    output.push(...minify(code, minifyOptions));
    code.skip = true; // Skip the original file if minifying
  }

  return output;
};

function minify(
  output: MinifiableFile,
  options?: ExternalOxcMinifyOptions,
): OutputFile[] {
  const minifyOutput: OutputFile[] = [];
  const minifyResult = oxcMinify(output.srcPath, output.contents, options);

  if (minifyResult.map) {
    // Convert absolute paths in the source map to relative paths
    minifyResult.map.sources = minifyResult.map.sources.map((source) => {
      return relative(dirname(output.path), source);
    });

    minifyOutput.push({
      srcPath: output.srcPath,
      path: output.path,
      extension: `${output.extension}.map`,
      sourceMap: true,
      contents: JSON.stringify(minifyResult.map),
    });
  }

  minifyOutput.push({
    ...output,
    skip: undefined,
    contents: minifyResult.code,
  });

  return minifyOutput;
}

function rewriteSpecifiers(
  filePath: string,
  code: string,
  options?: ExternalOxcParserOptions & {
    resolve?: ResolveOptions;
  },
): string {
  const parsed = oxcParser.parseSync(filePath, code, options);

  if (parsed.errors.length > 0) {
    throw new Error(`Errors while parsing ${filePath}:`, {
      cause: parsed.errors,
    });
  }

  function replaceExtension(path: string): string {
    const config = transformConfig[extname(path)];

    if (config === undefined) {
      return path;
    }

    return basename(path, extname(path)) + config.extension;
  }

  const magicString = new MagicString(code);

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
      from: pathToFileURL(filePath),
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
    });
    const newId = relative(
      dirname(filePath),
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

  return magicString.toString();
}
