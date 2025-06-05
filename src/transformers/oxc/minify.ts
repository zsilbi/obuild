import { basename } from "pathe";
import { replaceExtension } from "./utils.ts";
import { minify as oxcMinify } from "oxc-minify";

import type { MinifyOptions as OxcMinifyOptions } from "oxc-minify";
import type {
  MinifiedFile,
  ProcessableFile,
  MinifiedSourceMapFile,
} from "./types.ts";

export async function minify(
  input: Readonly<ProcessableFile>,
  options?: OxcMinifyOptions,
): Promise<[MinifiedFile] | [MinifiedFile, MinifiedSourceMapFile]> {
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

  const sourceMapFile: MinifiedSourceMapFile = {
    srcPath: input.srcPath,
    path: input.path,
    extension: `${input.extension}.map`,
    type: "source-map",
    origin: "minified",
    map: {
      ...sourceMap,
      file: basename(replaceExtension(input.path)),
      version: String(sourceMap.version),
    },
  };

  return [minifiedFile, sourceMapFile];
}
