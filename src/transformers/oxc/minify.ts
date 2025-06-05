import { basename } from "pathe";
import { replaceExtension } from "./utils.ts";
import { minify as oxcMinify } from "oxc-minify";

import type { MinifyOptions as OxcMinifyOptions } from "oxc-minify";
import type { MinifiedFile, SourceMapFile, ProcessableFile } from "./types.ts";

export async function minify(
  input: Readonly<ProcessableFile>,
  options?: OxcMinifyOptions,
): Promise<[MinifiedFile] | [MinifiedFile, SourceMapFile]> {
  const { code: minifedCode, map: sourceMap } = oxcMinify(
    input.path,
    input.contents,
    {
      ...options,
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

  const sourceMapFile: SourceMapFile = {
    srcPath: input.srcPath,
    path: input.path,
    extension: `${input.extension}.map`,
    type: "source-map",
    map: {
      ...sourceMap,
      file: basename(replaceExtension(input.path)),
      version: String(sourceMap.version),
    },
  };

  return [minifiedFile, sourceMapFile];
}
