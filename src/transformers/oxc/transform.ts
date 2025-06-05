import { writeFile } from "node:fs/promises";
import { replaceExtension } from "./utils.ts";
import { transform as oxcTransform } from "oxc-transform";

import type {
  DeclarationFile,
  ProcessableFile,
  ProcessOptions,
  TransformedSourceMapFile,
} from "./types.ts";

/**
 * Transforms the given input file using oxc-transform.
 *
 * @param input - The input file to transform.
 * @param options - Optional transformation options.
 * @returns An array containing the transformed file, and optionally a declaration file and a source map file.
 */
export async function transform(
  input: Readonly<ProcessableFile>,
  options?: ProcessOptions["transform"],
): Promise<
  | [ProcessableFile]
  | [ProcessableFile, DeclarationFile]
  | [ProcessableFile, DeclarationFile, TransformedSourceMapFile]
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

  const sourceMapFile: TransformedSourceMapFile = {
    srcPath: input.srcPath,
    path: input.path,
    extension: `${input.extension}.map`,
    type: "source-map",
    origin: "transformed",
    map: {
      ...sourceMap,
      file: replaceExtension(input.path, input.extension),
      version: String(sourceMap.version),
    },
  };

  return [transformedFile, declarationFile, sourceMapFile];
}
