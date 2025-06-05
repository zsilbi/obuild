import {
  copyFile,
  mkdir,
  readFile,
  symlink,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, extname, join, relative } from "pathe";
import { defu } from "defu";
import { consola } from "consola";
import { glob } from "tinyglobby";
import { colors as c } from "consola/utils";
import { readTSConfig, type TSConfig } from "pkg-types";
import { createTransformer } from "../transformers/index.ts";
import { getVueDeclarations } from "./utils/vue-dts.ts";
import { fmtPath } from "../utils.ts";
import { getDeclarations, normalizeCompilerOptions } from "./utils/dts.ts";
import {
  hasFileShebang,
  hasShebang,
  makeExecutable,
} from "./plugins/shebang.ts";

import type { OutputFile, SourceMapFile } from "../transformers/types.ts";
import type { BuildContext, TransformEntry } from "../types.ts";
import type { DeclarationOptions, DeclarationOutput } from "./utils/dts.ts";

/**
 * Transform a directory of files using the specified transformers in the entry.
 *
 * @param context - Build context
 * @param entry - Transform entry
 */
export async function transformDir(
  context: BuildContext,
  entry: TransformEntry,
): Promise<void> {
  if (entry.stub) {
    consola.log(
      `${c.magenta("[stub transform]   ")} ${c.underline(fmtPath(entry.outDir!) + "/")}`,
    );
    await symlink(entry.input, entry.outDir!, "junction");
    return;
  }

  const transformer = createTransformer(entry.transformers, entry);
  const inputFileNames = await glob("**/*.*", { cwd: entry.input });
  const transformPromises: Promise<OutputFile[]>[] = inputFileNames.map(
    async (inputFileName) => {
      const inputFilePath = join(entry.input, inputFileName);

      return transformer.transformFile({
        path: inputFileName,
        extension: extname(inputFilePath),
        srcPath: inputFilePath,
        getContents() {
          return readFile(inputFilePath, "utf8");
        },
      });
    },
  );

  const outputFiles = await Promise.all(transformPromises).then((results) =>
    results.flat(),
  );

  // Post transform declaration generation
  await generateDeclarations(outputFiles, context, entry);

  // Rename files to their desired extensions
  renameFiles(outputFiles);

  // Rewrite source map sources to relative paths
  rewriteSourceMapSources(outputFiles, entry);

  const outputPromises: Promise<string>[] = outputFiles
    .filter((outputFile) => !outputFile.skip)
    .map(async (outputFile) => {
      const { path, raw, contents = "" } = outputFile;
      const outPath = join(entry.outDir!, path);

      await mkdir(dirname(outPath), { recursive: true });

      let shebangFound: boolean;

      if (raw) {
        const srcPath = outputFile.srcPath || join(entry.input, path);

        [shebangFound] = await Promise.all([
          // Avoid loading possibly large raw file contents into memory
          hasFileShebang(srcPath),
          copyFile(srcPath, outPath),
        ]);
      } else {
        shebangFound = hasShebang(contents);
        await writeFile(outPath, contents, "utf8");
      }

      if (shebangFound) {
        await makeExecutable(outPath);
      }

      return outPath;
    });

  const writtenFiles = await Promise.all(outputPromises);

  consola.log(
    `\n${c.magenta("[transform] ")}${c.underline(fmtPath(entry.outDir!) + "/")}\n${writtenFiles
      .map((f) => c.dim(fmtPath(f)))
      .join("\n\n")}`,
  );
}

/**
 * Post-process output files to generate declarations.
 * Files marked with `declaration: true` will be processed.
 *
 * @param files - The output files to check. Files marked with `skip` or without a `srcPath` will be ignored.
 * @param context - Build context
 * @param entry - Transform entry
 * @returns A promise that resolves when declaration generation is complete.
 */
async function generateDeclarations(
  files: OutputFile[],
  context: BuildContext,
  entry: TransformEntry,
): Promise<void> {
  const dtsOutputFiles = files.filter(
    (output) =>
      output.srcPath !== undefined &&
      !output.skip &&
      output.declaration === true,
  ) as Array<OutputFile & { srcPath: string }>;

  if (dtsOutputFiles.length === 0) {
    return;
  }

  for (const output of dtsOutputFiles) {
    if (output.extension !== ".d.mts") {
      continue;
    }

    // If the desired extension is `.d.mts` the input files must be `.mts`
    output.srcPath = output.srcPath.replace(/\.ts$/, ".mts");
  }

  const declarationOptions: DeclarationOptions = {
    ...entry.declaration,
    rootDir: context.pkgDir,
    typescript: await resolveTSConfig(entry),
  };

  const vfs = new Map(dtsOutputFiles.map((o) => [o.srcPath, o.contents || ""]));

  const declarations: DeclarationOutput = Object.create(null);
  for (const dtsGenerator of [getVueDeclarations, getDeclarations]) {
    Object.assign(declarations, await dtsGenerator(vfs, declarationOptions));
  }

  for (const output of dtsOutputFiles) {
    const result = declarations[output.srcPath];

    output.type = "declaration";
    output.contents = result?.contents || "";

    if (result?.errors) {
      output.skip = true;
    }
  }
}

/**
 * Rename output files to their desired extensions.
 *
 * @param files - The output files to process.
 */
function renameFiles(files: OutputFile[]): void {
  for (const output of files.filter((output) => output.extension)) {
    const originalExtension = extname(output.path);

    if (originalExtension === output.extension) {
      continue;
    }

    output.path = join(
      dirname(output.path),
      basename(output.path, originalExtension) + output.extension,
    );
  }
}

/**
 * Rewrite source map sources to relative paths.
 *
 * @param files - The files to process.
 * @param entry - The transform entry containing the output directory.
 */
function rewriteSourceMapSources(
  files: OutputFile[],
  entry: TransformEntry,
): void {
  const sourceMapFiles = files.filter(
    (file): file is SourceMapFile => file.type === "source-map",
  );

  // Rewrite source maps to relative paths and serialize them
  for (const sourceMapFile of sourceMapFiles) {
    sourceMapFile.map.sources = sourceMapFile.map.sources.map((source) => {
      return relative(join(entry.outDir!, source), join(entry.input, source));
    });
    sourceMapFile.contents = JSON.stringify(sourceMapFile.map);
  }
}

/**
 * Resolve the TypeScript configuration for a transform entry.
 *
 * @param entry - The transform entry containing the declaration options.
 * @returns The TypeScript configuration.
 */
async function resolveTSConfig(entry: TransformEntry): Promise<TSConfig> {
  // Read the TypeScript configuration from tsconfig.json
  const packageTsConfig = await readTSConfig();

  // Override the TypeScript configuration with the entry's declaration options
  const tsConfig: TSConfig = defu(
    entry.declaration?.typescript || {},
    packageTsConfig,
  );

  if (tsConfig.compilerOptions) {
    tsConfig.compilerOptions = await normalizeCompilerOptions(
      tsConfig.compilerOptions,
    );
  }

  // Ensure the TypeScript configuration has the necessary defaults
  tsConfig.compilerOptions = defu(
    {
      noEmit: false,
    } satisfies TSConfig["compilerOptions"],
    tsConfig.compilerOptions,
    {
      allowJs: true,
      declaration: true,
      skipLibCheck: true,
      strictNullChecks: true,
      emitDeclarationOnly: true,
      allowImportingTsExtensions: true,
      allowNonTsExtensions: true,
    } satisfies TSConfig["compilerOptions"],
  );

  return tsConfig;
}
