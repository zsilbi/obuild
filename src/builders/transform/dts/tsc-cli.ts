import { spawn } from "node:child_process";
import { promises as fsp } from "node:fs";
import { createRequire } from "node:module";
import path from "pathe";
import consola from "consola";
import { defu } from "defu";
import { extractDeclarations } from "./common.ts";
import { rewriteTSConfigPaths } from "../ts-config.ts";

import type { TSConfig } from "pkg-types";
import type { DeclarationOptions, DeclarationOutput, VFS } from "./common.ts";

type Compiler = "tsc" | "tsgo";
type Distribution = { pkgName: string; exe: string };

/**
 * Represents the project structure for generating TypeScript declarations.
 * Contains absolute paths to the directories used during the process.
 */
type Project = {
  /**
   * The directory where the package is located.
   */
  pkgDir: string;

  /**
   * The TypeScript `rootDir` for the project.
   *
   * Defaults to:
   *  - path of the `tsconfig.json` file if it exists,
   *  - or the package directory if no `tsconfig.json` is found.
   */
  rootDir: string;

  /**
   * The input directory containing the source files for the entry.
   */
  inputDir: string;

  /**
   * The temporary directory where the project files will be created.
   */
  tempDir: string;

  /**
   * The source directory within the temporary directory where source files are placed.
   */
  srcDir: string;

  /**
   * The directory where the compiled output will be placed within the temporary directory.
   */
  distDir: string;

  /**
   * Runs the TypeScript compiler CLI to generate declarations.
   *
   * @param compiler - The TypeScript compiler to use, either "tsc" or "tsgo".
   * @returns The declaration output or undefined if no files were processed.
   */
  run: (compiler: Compiler) => Promise<DeclarationOutput | undefined>;

  /**
   * Clears the entire temporary directory.
   */
  clear: () => Promise<void>;
};

const DEFAULT_COMPILER: Compiler = "tsgo";

const DIST_DIR_NAME = "dist";
const TMP_DIR_NAME = ".obuild";
const TMP_PREFIX = "dts-";

const KNOWN_EXT_RE = /(?<!\.d)\.(m)?[tj]sx?$/;
const DECLARATION_RE = /\.d\.m?ts$/;

const distributions: Record<Compiler, Distribution> = {
  tsc: {
    pkgName: "typescript",
    exe: "tsc",
  },
  tsgo: {
    pkgName: "@typescript/native-preview",
    exe: "tsgo.js",
  },
};

/**
 * Generates TypeScript declarations using the executable CLI tools `tsc` or `tsgo`.
 *
 * This function creates a temporary project on disk, runs the CLI to generate
 * declaration files, reads the output back into the virtual file system,
 * and then cleans up the temporary directory.
 *
 * @param vfs - A Map representing a virtual file system (filePath -> content).
 * @param options - Options for declaration generation.
 * @param compiler - The TypeScript compiler to use, either "tsc" or "tsgo".
 * @returns The declaration output, or undefined if there are no files.
 */
export async function getTscCliDeclarations(
  vfs: VFS,
  options: DeclarationOptions,
  compiler: Compiler = DEFAULT_COMPILER,
): Promise<DeclarationOutput | undefined> {
  if (
    vfs.size === 0 ||
    vfs.keys().some((filePath) => KNOWN_EXT_RE.test(filePath)) === false
  ) {
    return undefined;
  }

  const project = await createProject(vfs, options);

  return project.run(compiler).finally(() => {
    project.clear();
  });
}

/**
 * Sets up a temporary directory with the project source files and configuration.
 *
 * @param vfs - The virtual file system containing source files.
 * @param options - The declaration options.
 * @return A project object containing paths.
 */
async function createProject(
  vfs: VFS,
  options: DeclarationOptions,
): Promise<Project> {
  const { inputDir, pkg, pkgDir } = options;
  const inputName = path.relative(pkgDir, inputDir).replace(/[\\/]/g, "-");
  const tempDir = path.join(
    pkgDir,
    // @todo Switch to store within node_modules whenever `tsgo` supports it
    // "node_modules",
    // ".cache",
    TMP_DIR_NAME,
    `${TMP_PREFIX}${inputName}`,
  );
  const srcDir = path.join(tempDir, path.relative(pkgDir, inputDir));
  const distDir = path.join(tempDir, DIST_DIR_NAME);
  const rootDir = options.typescript?.compilerOptions?.rootDir || pkgDir;

  const project: Project = {
    inputDir,
    tempDir,
    srcDir,
    distDir,
    pkgDir,
    rootDir,
    run: async (compiler: Compiler) => {
      const inputFiles = [...vfs.keys()];

      await runTscCli(compiler, tempDir);
      await updateVFSWithDeclarations(vfs, inputFiles, project);

      return extractDeclarations(vfs, inputFiles, options);
    },
    clear: async () => {
      return fsp.rm(tempDir, { recursive: true, force: true });
    },
  };

  await project.clear();

  await Promise.all([
    fsp.mkdir(srcDir, { recursive: true }),
    fsp.mkdir(distDir, { recursive: true }),
  ]);

  await Promise.all([
    linkNodeModules(project),
    fsp.writeFile(
      path.join(tempDir, "package.json"),
      JSON.stringify(pkg, null, 2),
    ),
    fsp.writeFile(
      path.join(tempDir, "tsconfig.json"),
      JSON.stringify(createTSConfig(project, options), null, 2),
    ),
    // Write the virtual file system contents to the source directory
    ...[...vfs.entries()].map(async ([filePath, content]) => {
      const outFilePath = path.join(srcDir, path.relative(inputDir, filePath));

      await fsp.mkdir(path.dirname(outFilePath), { recursive: true });
      await fsp.writeFile(outFilePath, content);
    }),
  ]);

  return project;
}

/**
 * Runs the TypeScript compiler CLI (`tsc` or `tsgo`) to generate declarations.
 *
 * @param compiler - The TypeScript compiler to use, either "tsc" or "tsgo".
 * @param cwd - The current working directory where the command should be executed.
 */
async function runTscCli(compiler: Compiler, cwd: string): Promise<void> {
  const { pkgName, exe } = distributions[compiler];

  const exePath = path.join(
    path.dirname(
      createRequire(import.meta.url).resolve(
        path.join(pkgName, "package.json"),
      ),
    ),
    "bin",
    exe,
  );

  return await new Promise<void>((resolve, reject) => {
    const process = spawn(exePath, [], {
      cwd,
      stdio: "inherit",
    });

    process.on("close", () => {
      resolve();
    });

    process.on("exit", (code) => {
      if (code !== 0) {
        reject(new Error(`Process exited with code ${code}`));
      }

      resolve();
    });

    process.on("error", (error) => {
      reject(new Error(`Failed to start process: ${error.message}`));
    });
  }).catch((error) => {
    fsp
      .readFile(path.join(cwd, "tsconfig.json"), "utf8")
      .then((tsconfigContent) => {
        // Show `tsconfig.json` for debugging
        consola.info("tsconfig.json:\n");
        console.dir(JSON.parse(tsconfigContent), {
          depth: 5,
        });
      })
      .finally(() => {
        consola.error(
          `Error while generating declarations with ${compiler}: ${error.message}`,
        );
      });
  });
}

/**
 * Reads the generated declaration files from the dist directory and updates the VFS.
 *
 * @param vfs - The virtual file system to update.
 * @param inputFiles - The list of input files to process.
 * @param project - The project object containing paths.
 */
async function updateVFSWithDeclarations(
  vfs: VFS,
  inputFiles: string[],
  project: Project,
): Promise<void> {
  const { distDir, inputDir, srcDir, rootDir } = project;

  await Promise.all(
    inputFiles
      .filter((inputFilePath) => !DECLARATION_RE.test(inputFilePath))
      .map(async (inputFilePath) => {
        const dtsFileName = inputFilePath.replace(KNOWN_EXT_RE, ".d.$1ts");
        const dtsPath = path.join(
          distDir,
          path.relative(rootDir, srcDir),
          path.relative(inputDir, dtsFileName),
        );

        try {
          vfs.set(dtsFileName, await fsp.readFile(dtsPath, "utf8"));
        } catch (error: any) {
          consola.warn(
            `Could not read declaration file for "${inputFilePath}" at "${dtsPath}": ${error.message}`,
          );
        }
      }),
  );
}

/**
 * Creates the and serializes tsconfig.json to the temporary directory.
 *
 * @param project - The project object containing paths.
 * @param options - The declaration options.
 * @return The tsconfig.json object.
 */
function createTSConfig(
  project: Project,
  options: DeclarationOptions,
): TSConfig {
  const { tempDir, srcDir, rootDir } = project;
  const tsConfig: TSConfig = {
    compilerOptions: defu(
      {
        verbatimModuleSyntax: false,
        emitDeclarationOnly: true,
        declaration: true,
        outDir: `./${DIST_DIR_NAME}`,
        noEmit: false,
        noCheck: true,
      },
      options.typescript?.compilerOptions,
    ),
    include: [path.relative(tempDir, srcDir)],
  };

  return rewriteTSConfigPaths(tsConfig, (p) => path.relative(rootDir, p));
}

/**
 * Links the nearest `node_modules` directory to the temporary project directory.
 *
 * @param project - The project object containing paths.
 */
async function linkNodeModules(project: Project): Promise<void> {
  const { inputDir, tempDir } = project;
  const nodeModulesPath = await findNearestNodeModules(inputDir);

  if (!nodeModulesPath) {
    consola.warn(
      `No node_modules found in "${inputDir}" or its parent directories.`,
    );
    return;
  }

  const tempNodeModulesPath = path.join(tempDir, "node_modules");

  try {
    await fsp.symlink(nodeModulesPath, tempNodeModulesPath, "dir");
  } catch (error: any) {
    consola.error(`Failed to link node_modules: ${error.message}`);
  }
}

/**
 * Finds the nearest `node_modules` directory starting from the given directory.
 *
 * @param startDir - The directory to start searching from.
 * @returns The path to the nearest `node_modules` directory, or null if not found.
 */
async function findNearestNodeModules(
  startDir: string,
): Promise<string | null> {
  let currentDir = path.resolve(startDir);

  while (true) {
    const candidate = path.join(currentDir, "node_modules");

    try {
      await fsp.access(candidate);

      return candidate;
    } catch {
      const parentDir = path.dirname(currentDir);

      if (parentDir === currentDir) {
        return null;
      }

      currentDir = parentDir;
    }
  }
}
