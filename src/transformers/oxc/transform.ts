import { writeFile } from "node:fs/promises";
import { basename } from "pathe";
import { replaceExtension } from "./utils.ts";
import { transform as oxcTransform } from "oxc-transform";

import type { TransformOptions as OxcTransformOptions } from "oxc-transform";
import type {
  DeclarationFile,
  ProcessableFile,
  TransformSourceMapFile,
} from "./types.ts";

export async function transform(
  input: Readonly<ProcessableFile>,
  options?: OxcTransformOptions,
): Promise<
  | [ProcessableFile]
  | [ProcessableFile, DeclarationFile]
  | [ProcessableFile, DeclarationFile, TransformSourceMapFile]
> {
  const {
    code: transformedCode,
    declaration,
    map: sourceMap,
    errors: transformErrors,
  } = oxcTransform(input.path, input.contents, options);

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

  const sourceMapFile: TransformSourceMapFile = {
    srcPath: input.srcPath,
    path: input.path,
    extension: `${input.extension}.map`,
    type: "source-map",
    origin: "transformed",
    map: {
      ...sourceMap,
      file: replaceExtension(basename(input.path), input.extension),
      version: String(sourceMap.version),
    },
  };

  return [transformedFile, declarationFile, sourceMapFile];
}
