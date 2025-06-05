import { basename } from "pathe";
import { replaceExtension } from "./utils.ts";
import { SourceMapConsumer, SourceMapGenerator } from "source-map-js";
import { minify as oxcMinify } from "oxc-minify";

import type { MinifyOptions as OxcMinifyOptions } from "oxc-minify";
import type { MinifiedFile, SourceMapFile, ProcessableFile } from "./types.ts";

export async function minify(
  input: Readonly<ProcessableFile>,
  options?: OxcMinifyOptions,
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
