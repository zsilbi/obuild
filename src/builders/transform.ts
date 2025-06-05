import path from "pathe";
import { promises as fsp } from "node:fs";
import { defu } from "defu";
import { consola } from "consola";
import { glob } from "tinyglobby";
import { fmtPath } from "../utils.ts";
import { colors as c } from "consola/utils";
import { readTSConfig, type TSConfig } from "pkg-types";
import { createTransformer } from "../transformers/index.ts";
import { getVueDeclarations } from "./declarations/vue-dts.ts";

import type { OutputFile, SourceMapFile } from "../transformers/types.ts";
import type { BuildContext, TransformEntry } from "../types.ts";

import {
  hasFileShebang,
  hasShebang,
  makeExecutable,
} from "./plugins/shebang.ts";

import {
  getDeclarations,
  normalizeCompilerOptions,
  type DeclarationOutput,
  type DeclarationOptions,
} from "./declarations/dts.ts";

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
    await fsp.symlink(entry.input, entry.outDir!, "junction");
    return;
  }

  const transformer = createTransformer(entry.transformers, entry);
  const inputFileNames = await glob("**/*.*", { cwd: entry.input });
  const transformPromises: Promise<OutputFile[]>[] = inputFileNames.map(
    async (inputFileName) => {
      const inputFilePath = path.join(entry.input, inputFileName);

      return transformer.transformFile({
        path: inputFileName,
        extension: path.extname(inputFilePath),
        srcPath: inputFilePath,
        getContents() {
          return fsp.readFile(inputFilePath, "utf8");
        },
      });
    },
  );

  const outputFiles = await Promise.all(transformPromises).then((results) =>
    results.flat(),
  );

  // Post transform declaration generation
  await generateDeclarations(outputFiles, entry, context);

  // Rename files to their desired extensions
  renameFiles(outputFiles);

  // Rewrite source map sources to relative paths
  serializeSourceMapFiles(outputFiles, entry, context);

  const writePromises: Promise<string>[] = outputFiles
    .filter((outputFile) => !outputFile.skip)
    .map(async (outputFile) => {
      const { path: filePath, raw, contents = "" } = outputFile;
      const outputFilePath = getOutputFilePath(outputFile, entry, context);

      await fsp.mkdir(path.dirname(outputFilePath), { recursive: true });

      let shebangFound: boolean;

      if (raw) {
        const srcPath = outputFile.srcPath || path.join(entry.input, filePath);

        [shebangFound] = await Promise.all([
          // Avoid loading possibly large raw file contents into memory
          hasFileShebang(srcPath),
          fsp.copyFile(srcPath, outputFilePath),
        ]);
      } else {
        shebangFound = hasShebang(contents);
        await fsp.writeFile(outputFilePath, contents, "utf8");
      }

      if (shebangFound) {
        await makeExecutable(outputFilePath);
      }

      return outputFilePath;
    });

  const writtenFiles = await Promise.all(writePromises);

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
 * @param entry - Transform entry
 * @param context - Build context
 * @returns A promise that resolves when declaration generation is complete.
 */
async function generateDeclarations(
  files: OutputFile[],
  entry: TransformEntry,
  context: BuildContext,
): Promise<void> {
  const declarationFiles: Array<OutputFile & { srcPath: string }> = [];

  for (const file of files) {
    if (
      file.srcPath === undefined ||
      file.skip === true ||
      file.declaration !== true
    ) {
      continue;
    }

    declarationFiles.push(file as OutputFile & { srcPath: string });

    if (file.extension !== ".d.mts") {
      continue;
    }

    // If the desired extension is `.d.mts` the input files must be `.mts`
    file.srcPath = file.srcPath.replace(/\.ts$/, ".mts");
  }

  if (declarationFiles.length === 0) {
    return;
  }

  const declarationOptions: DeclarationOptions = {
    ...entry.declaration,
    rootDir: context.pkgDir,
    typescript: await resolveTSConfig(entry),
  };

  const vfs = new Map(
    declarationFiles.map((file) => [file.srcPath, file.contents || ""]),
  );

  const declarations: DeclarationOutput = Object.create(null);
  for (const dtsGenerator of [getVueDeclarations, getDeclarations]) {
    Object.assign(declarations, await dtsGenerator(vfs, declarationOptions));
  }

  for (const declarationFile of declarationFiles) {
    const result = declarations[declarationFile.srcPath];

    declarationFile.type = "declaration";
    declarationFile.contents = result?.contents || "";

    if (result?.errors) {
      declarationFile.skip = true;
    }
  }
}

/**
 * Rename output files to their desired extensions.
 *
 * @param files - The output files to process.
 */
function renameFiles(files: OutputFile[]): void {
  for (const file of files) {
    if (file.extension === undefined) {
      continue;
    }

    const originalExtension = path.extname(file.path);

    if (originalExtension === file.extension) {
      continue;
    }

    file.path = path.join(
      path.dirname(file.path),
      path.basename(file.path, originalExtension) + file.extension,
    );
  }
}

/**
 * Rewrite source map sources and file paths to relative paths and serialize them.
 *
 * @param files - The files to process.
 * @param entry - The transform entry containing the output directory.
 */
function serializeSourceMapFiles(
  files: OutputFile[],
  entry: TransformEntry,
  context: BuildContext,
): void {
  const mapDir = resolveMapDir(entry, context);
  const sourceMapFiles = files.filter(
    (file): file is SourceMapFile => file.type === "source-map",
  );

  // Rewrite source maps to relative paths and serialize them
  for (const sourceMapFile of sourceMapFiles) {
    const { map } = sourceMapFile;

    map.sources = map.sources.map((source) => {
      return path.relative(
        path.dirname(path.join(mapDir, source)),
        path.join(entry.input, source),
      );
    });

    if (map.file !== undefined) {
      map.file = path.relative(
        path.dirname(path.join(mapDir, sourceMapFile.path)),
        path.join(entry.outDir!, map.file),
      );
    }

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

/**
 * Get the output path for a given output file in a transform entry.
 *
 * @param outputFile - Output file to resolve the path for
 * @param entry - Transform entry
 * @param context - Build context
 * @returns - The absolute path to the output file.
 */
function getOutputFilePath(
  outputFile: OutputFile,
  entry: TransformEntry,
  context: BuildContext,
): string {
  if (outputFile.type === "source-map") {
    return path.join(resolveMapDir(entry, context), outputFile.path);
  }

  return path.join(entry.outDir!, outputFile.path);
}

/**
 * Resolve the absolute path to store the source maps.
 *
 * @param entry - Transform entry
 * @param context - Build context
 * @returns The absolute path to the source map directory.
 */
function resolveMapDir(entry: TransformEntry, context: BuildContext): string {
  if (entry.mapDir === undefined) {
    return entry.outDir!;
  }

  if (path.isAbsolute(entry.mapDir)) {
    return entry.mapDir;
  }

  return path.resolve(context.pkgDir, entry.mapDir);
}
