import MagicString from "magic-string";
import { pathToFileURL } from "node:url";
import { basename, dirname, extname, join, relative } from "pathe";
import { sourceConfig } from "./config.ts";
import { resolveModulePath } from "exsolve";
import { parseSync as oxcParse } from "oxc-parser";
import { SourceMapConsumer, SourceMapGenerator } from "source-map-js";

import type { ResolveOptions as ExsolveOptions } from "exsolve";
import type { ParserOptions as OxcParserOptions } from "oxc-parser";
import type {
  MinifiedSourceMapFile,
  ProcessableFile,
  SourceMapFile,
  TransformedSourceMapFile,
} from "./types.ts";

export function replaceExtension(
  path: string,
  targetExtension?: string,
): string {
  const sourceExtension = extname(path);

  if (targetExtension === undefined) {
    const config = sourceConfig[sourceExtension];

    if (config?.extension === undefined) {
      return path;
    }

    targetExtension = config.extension;
  }

  return join(dirname(path), basename(path, sourceExtension)) + targetExtension;
}

export function rewriteSpecifiers(
  file: Readonly<ProcessableFile>,
  options?: {
    parser?: OxcParserOptions;
    resolve?: ExsolveOptions;
  },
): ProcessableFile {
  const { srcPath } = file;

  if (srcPath === undefined) {
    // Skip rewriting if srcPath is not available
    return { ...file };
  }

  const parsed = oxcParse(file.path, file.contents, options?.parser);

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

export function mergeSourceMapFiles(
  transformedSourceMapFile: Readonly<TransformedSourceMapFile> | undefined,
  minifiedSourceMapFile: Readonly<MinifiedSourceMapFile> | undefined,
): SourceMapFile | undefined {
  if (!transformedSourceMapFile) {
    return minifiedSourceMapFile;
  }

  if (!minifiedSourceMapFile) {
    return transformedSourceMapFile;
  }

  // The source map is based on the minified code
  const generator = SourceMapGenerator.fromSourceMap(
    new SourceMapConsumer(minifiedSourceMapFile.map),
  );

  // Apply the transformed source map to the minified map
  generator.applySourceMap(new SourceMapConsumer(transformedSourceMapFile.map));

  return {
    ...transformedSourceMapFile,
    map: {
      ...generator.toJSON(),
      file: basename(replaceExtension(minifiedSourceMapFile.path)),
    },
  };
}
