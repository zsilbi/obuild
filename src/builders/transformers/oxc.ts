import { pathToFileURL } from "node:url";
import { dirname, extname, relative } from "node:path";
import { writeFile } from "node:fs/promises";
import { resolveModulePath } from "exsolve";
import MagicString from "magic-string";
import oxcTransform, {
  type TransformOptions as ExternalOxcTransformOptions,
} from "oxc-transform";
import oxcParser, {
  type ParserOptions as ExternalOxcParserOptions,
} from "oxc-parser";
import {
  minify,
  type MinifyOptions as ExternalOxcMinifyOptions,
} from "oxc-minify";
import type {
  OutputFile,
  Transformer,
  TransformerContext,
  TransformResult,
} from "./index.ts";

const KNOWN_EXT_RE = /\.(c|m)?[jt]sx?$/;

type Extension = `.${string}`;
type TransformConfig = Record<
  string,
  {
    transform?: boolean;
    language?: ExternalOxcParserOptions["lang"];
    extension: Extension;
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
    extension: ".jsx",
  },
  ".js": {
    extension: ".mjs",
  },
  ".mjs": {
    extension: ".mjs",
  },
  ".cjs": {
    extension: ".mjs",
  },
};

export interface OxcTransformerOptions {
  oxc?: {
    transform?: ExternalOxcTransformOptions;
    minify?: boolean | ExternalOxcMinifyOptions;
  };
}

export const oxcTransformer: Transformer = async (
  input,
  context,
): Promise<TransformResult> => {
  const { extension = extname(input.path), srcPath } = input;
  const { options } = context;
  const config = transformConfig[extension];

  if (srcPath === undefined || config === undefined) {
    return undefined;
  }

  const output: OutputFile[] = [];
  const codeOutputFile: OutputFile = {
    path: replaceExtension(input.path, config.extension),
    srcPath,
    extension: config.extension,
    declaration: config.declaration !== undefined,
    raw: config.transform === false,
  };
  const sourceOptions: ExternalOxcParserOptions = {
    lang: config.language,
    sourceType: "module",
  };
  const sourceText = rewriteSpecifiers(
    srcPath,
    await input.getContents(),
    context,
    sourceOptions,
  );

  if (config.transform === true) {
    const transformed = oxcTransform.transform(srcPath, sourceText, {
      ...options?.oxc?.transform,
      ...sourceOptions,
      cwd: dirname(srcPath),
      typescript: {
        declaration: { stripInternal: true },
        ...options.oxc?.transform?.typescript,
      },
    });

    if (config.declaration && transformed.declaration) {
      output.push({
        srcPath,
        contents: transformed.declaration,
        declaration: true,
        path: input.path.replace(KNOWN_EXT_RE, config.declaration),
      });
    }

    const transformErrors = transformed.errors.filter(
      (err) => !err.message.includes("--isolatedDeclarations"),
    );

    if (transformErrors.length > 0) {
      // console.log(sourceText);
      await writeFile(
        "build-dump.ts",
        `/** Error dump for ${input.srcPath} */\n\n` + sourceText,
        "utf8",
      );
      throw new Error(
        `Errors while transforming ${input.srcPath}: (hint: check build-dump.ts)`,
        {
          cause: transformErrors,
        },
      );
    }

    codeOutputFile.contents = transformed.code;
  }

  output.push(codeOutputFile);

  if (options.oxc?.minify) {
    // skip the original file if minifying
    codeOutputFile.skip = true;

    const minifyResult = minify(
      srcPath,
      codeOutputFile.contents || sourceText,
      options.oxc?.minify === true ? {} : options.oxc?.minify,
    );

    if (minifyResult.map) {
      // Convert absolute paths in the source map to relative paths
      minifyResult.map.sources = minifyResult.map.sources.map((source) => {
        return relative(dirname(input.path), source);
      });

      output.push({
        srcPath,
        path: `${replaceExtension(input.path)}.map`,
        extension: config.extension,
        sourceMap: true,
        contents: JSON.stringify(minifyResult.map),
      });
    }

    output.push({
      srcPath,
      path: codeOutputFile.path,
      extension: config.extension,
      contents: minifyResult.code,
    });
  }

  return output;
};

function replaceExtension(path: string, target?: Extension): string {
  if (target === undefined) {
    const config = transformConfig[extname(path)];

    if (config === undefined) {
      return path;
    }

    target = config.extension;
  }

  return path.replace(KNOWN_EXT_RE, target);
}

function rewriteSpecifiers(
  filePath: string,
  code: string,
  context: TransformerContext,
  options: ExternalOxcParserOptions,
): string {
  const parsed = oxcParser.parseSync(filePath, code, options);

  if (parsed.errors.length > 0) {
    throw new Error(`Errors while parsing ${filePath}:`, {
      cause: parsed.errors,
    });
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
      extensions: context.options.resolve?.extensions ?? [
        ".tsx",
        ".ts",
        ".jsx",
        ".js",
        ".mjs",
        ".cjs",
        ".json",
      ],
      suffixes: context.options.resolve?.suffixes ?? ["", "/index"],
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
