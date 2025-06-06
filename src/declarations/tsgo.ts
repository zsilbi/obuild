import { spawn } from "node:child_process";
import { promises as fsp } from "node:fs";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import os from "node:os";
import path from "pathe";
import { defu } from "defu";
import consola from "consola";

import {
  extractDeclarations,
  type DeclarationOptions,
  type DeclarationOutput,
} from "./common.ts";

const SRC_DIR_NAME = "src";
const DIST_DIR_NAME = "dist";
const CACHE_PREFIX = "obuild-tsgo-";
const KNOWN_EXT_RE = /\.(m)?[tj]sx?$/;

/**
 * Generates TypeScript declarations using the native `tsgo` compiler.
 *
 * This function creates a temporary project on disk, runs `tsgo` to generate
 * declaration files, reads the output back into the virtual file system,
 * and then cleans up the temporary directory.
 *
 * @param vfs A Map representing a virtual file system (filePath -> content).
 * @param options Options for declaration generation.
 * @returns A promise that resolves to the declaration output, or undefined if there are no files.
 */
export async function getTsgoDeclarations(
  vfs: Map<string, string>,
  options: DeclarationOptions,
): Promise<DeclarationOutput | undefined> {
  if (vfs.size === 0) {
    return undefined;
  }

  console.log("WTF?");

  const { tempDir, distDir } = await setupTemporaryProject(vfs, options);

  try {
    await runTsGo(tempDir);

    const inputFiles = [...vfs.keys()];
    await updateVfsWithDeclarations(vfs, inputFiles, distDir, options.inputDir);

    return await extractDeclarations(vfs, inputFiles, options);
  } finally {
    await fsp.rm(tempDir, { recursive: true, force: true });
  }
}

/**
 * Sets up a temporary directory with the project source files and configuration.
 *
 * @param vfs - The virtual file system containing source files.
 * @param options - The declaration options.
 * @return An object containing the temporary directory, source directory, and distribution directory.
 */
async function setupTemporaryProject(
  vfs: Map<string, string>,
  options: DeclarationOptions,
) {
  const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), CACHE_PREFIX));
  const srcDir = path.join(tempDir, SRC_DIR_NAME);
  const distDir = path.join(tempDir, DIST_DIR_NAME);

  // Create source and distribution directories
  await Promise.all([fsp.mkdir(srcDir), fsp.mkdir(distDir)]);

  // Write the virtual file system contents to the source directory
  await Promise.all(
    [...vfs.entries()].map(async ([filePath, content]) => {
      const outFilePath = path.join(
        srcDir,
        path.relative(options.inputDir, filePath),
      );

      await fsp.mkdir(path.dirname(outFilePath), { recursive: true });
      await fsp.writeFile(outFilePath, content);
    }),
  );

  // Create tsconfig.json and package.json in the temporary directory
  await Promise.all([
    fsp.writeFile(
      path.join(tempDir, "tsconfig.json"),
      JSON.stringify(createTsConfig(options, distDir, srcDir), null, 2),
    ),
    fsp.writeFile(
      path.join(tempDir, "package.json"),
      JSON.stringify({ type: "module" }, null, 2),
    ),
  ]);

  return { tempDir, srcDir, distDir };
}

/**
 * Reads the generated declaration files from the dist directory and updates the VFS.
 *
 * @param vfs - The virtual file system to update.
 * @param inputFiles - The list of input files to process.
 * @param distDir - The directory where declaration files are generated.
 * @param inputDir - The root directory of the source files.
 * @returns A promise that resolves when all declaration files have been read and added to the VFS.
 */
async function updateVfsWithDeclarations(
  vfs: Map<string, string>,
  inputFiles: string[],
  distDir: string,
  inputDir: string,
): Promise<void> {
  await Promise.all(
    inputFiles.map(async (filePath) => {
      const dtsFileName = filePath.replace(KNOWN_EXT_RE, ".d.$1ts");
      const dtsPath = path.join(distDir, path.relative(inputDir, dtsFileName));

      try {
        vfs.set(dtsFileName, await fsp.readFile(dtsPath, "utf8"));
      } catch (error: any) {
        consola.warn(
          `Could not read declaration file for "${filePath}" at "${dtsPath}": ${error.message}`,
        );
      }
    }),
  );
}

/**
 * Creates the tsconfig.json object.
 *
 * @param options - The declaration options.
 * @param distDir - The output directory for compiled declaration files.
 * @param srcDir - The source directory containing TypeScript files.
 * @return The tsconfig.json object.
 */
function createTsConfig(
  options: DeclarationOptions,
  distDir: string,
  srcDir: string,
) {
  return {
    ...defu(
      {
        compilerOptions: {
          verbatimModuleSyntax: false,
          emitDeclarationOnly: true,
          declaration: true,
          removeComments: true,
          outDir: distDir,
          rootDir: srcDir,
          noEmit: false,
        },
      },
      options?.typescript || {},
    ),
    include: [SRC_DIR_NAME],
  };
}

/**
 * Locates the `tsgo` executable and runs it in the specified directory.
 *
 * @param cwd - The working directory to run the compiler in.
 * @returns A promise that resolves on success or rejects on failure.
 */
async function runTsGo(cwd: string): Promise<void> {
  const require = createRequire(import.meta.url);
  const packageJsonPath = require.resolve(
    "@typescript/native-preview/package.json",
  );
  const getExePath = path.join(
    path.dirname(packageJsonPath),
    "lib/getExePath.js",
  );

  const { default: tsgo } = await import(pathToFileURL(getExePath).href);

  // This must return a promise to be awaited
  return new Promise<void>((resolve, reject) => {
    const process = spawn(tsgo(), [], {
      cwd,
      stdio: "inherit",
    });

    process.on("close", () => {
      resolve();
    });

    process.on("error", (error) => {
      reject(new Error(`Failed to start tsgo process: ${error.message}`));
    });
  });
}
