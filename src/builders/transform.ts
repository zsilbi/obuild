import type { BuildContext, TransformEntry } from "../types.ts";

import { consola } from "consola";
import { colors as c } from "consola/utils";
import { mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { dirname, extname, join } from "node:path";
import { glob } from "tinyglobby";
import { fmtPath } from "../utils.ts";
import { makeExecutable, SHEBANG_RE } from "./plugins/shebang.ts";
import { createTransformer, type InputFile } from "./transformers/index.ts";

/**
 * Transform all files in a directory using oxc-transform.
 */
export async function transformDir(
  ctx: BuildContext,
  entry: TransformEntry,
): Promise<void> {
  if (entry.stub) {
    consola.log(
      `${c.magenta("[stub transform]   ")} ${c.underline(fmtPath(entry.outDir!) + "/")}`,
    );
    await symlink(entry.input, entry.outDir!, "junction");
    return;
  }

  const transformer = createTransformer({
    build: ctx,
    ...entry,
  });
  const entryNames = await glob("**/*.*", { cwd: entry.input });

  const entryPromises: Promise<string[]>[] = entryNames.map(
    async (entryName) => {
      const entryPath = join(entry.input, entryName);
      const ext = extname(entryPath);

      const inputFile: InputFile = {
        path: entryName,
        extension: ext,
        srcPath: entryPath,
        getContents() {
          return readFile(entryPath, "utf8");
        },
      };

      const outputFiles = await transformer.transformFile(inputFile);

      if (outputFiles.length === 0) {
        throw new Error("Unexpected empty output from transformer");
      }

      const outputPromises: Promise<string>[] = outputFiles
        .filter((outputFile) => !outputFile.skip)
        .map(async (outputFile) => {
          let code = outputFile.contents || "";
          const outputFilePath = join(entry.outDir!, outputFile.path);

          await mkdir(dirname(outputFilePath), { recursive: true });

          if (outputFile.raw) {
            if (outputFile.srcPath === undefined) {
              throw new TypeError("Raw output files must have a `srcPath`");
            }

            code = await readFile(outputFile.srcPath, "utf8");
          }

          await writeFile(outputFilePath, code, "utf8");

          if (SHEBANG_RE.test(code)) {
            await makeExecutable(outputFilePath);
          }

          return outputFilePath;
        });

      return await Promise.all(outputPromises);
    },
  );

  const writtenFiles = (await Promise.all(entryPromises)).flat();

  consola.log(
    `\n${c.magenta("[transform] ")}${c.underline(fmtPath(entry.outDir!) + "/")}\n${writtenFiles
      .map((f) => c.dim(fmtPath(f)))
      .join("\n\n")}`,
  );
}
