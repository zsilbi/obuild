import { createRequire } from "node:module";
import {
  augmentWithDiagnostics,
  extractDeclarations,
  type DeclarationOutput,
  type DeclarationOptions,
} from "./dts.ts";
import type { CreateProgramOptions } from "typescript";
import { readPackageJSON } from "pkg-types";
import consola from "consola";

const SFC_EXT_RE = /\.vue\.m?[jt]s$/;

export async function getVueDeclarations(
  vfs: Map<string, string>,
  opts: DeclarationOptions,
): Promise<DeclarationOutput | undefined> {
  const fileMapping = getFileMapping(vfs);
  const sourceFiles = Object.keys(fileMapping);
  const originFiles = Object.values(fileMapping);

  if (originFiles.length === 0) {
    return;
  }

  const pkgInfo = await readPackageJSON("vue-tsc").catch(() => {});

  if (!pkgInfo?.version) {
    consola.warn("Please install `vue-tsc` to generate Vue SFC declarations.");
    return;
  }

  const { resolve: resolveModule } = await import("mlly");
  const ts: typeof import("typescript") = await import("typescript").then(
    (r) => r.default || r,
  );
  const requireFromVueTsc = createRequire(await resolveModule("vue-tsc"));
  const vueLanguageCore: typeof import("@vue/language-core") =
    requireFromVueTsc("@vue/language-core");
  const volarTs: typeof import("@volar/typescript") =
    requireFromVueTsc("@volar/typescript");

  const compilerOptions = {
    ...opts?.typescript?.compilerOptions,
    isolatedDeclarations: false, // Not supported
  };

  const tsHost = ts.createCompilerHost(compilerOptions);
  tsHost.writeFile = (filename, content) => {
    vfs.set(filename, content);
  };
  const _tsReadFile = tsHost.readFile.bind(tsHost);
  tsHost.readFile = (filename) => {
    if (vfs.has(filename)) {
      return vfs.get(filename);
    }
    return _tsReadFile(filename);
  };
  const _tsFileExist = tsHost.fileExists.bind(tsHost);
  tsHost.fileExists = (filename) => {
    return vfs.has(filename) || _tsFileExist(filename);
  };

  const programOptions: CreateProgramOptions = {
    rootNames: sourceFiles,
    options: compilerOptions,
    host: tsHost,
  };

  const createProgram = volarTs.proxyCreateProgram(
    ts,
    ts.createProgram,
    (ts, options) => {
      const vueLanguagePlugin = vueLanguageCore.createVueLanguagePlugin<string>(
        ts,
        options.options,
        vueLanguageCore.createParsedCommandLineByJson(
          ts,
          ts.sys,
          opts?.rootDir,
          {},
          undefined,
          true,
        ).vueOptions,
        (id) => id,
      );
      return [vueLanguagePlugin];
    },
  );

  const program = createProgram(programOptions);
  const result = program.emit();
  const output = await extractDeclarations(vfs, originFiles, opts);

  augmentWithDiagnostics(result, output, tsHost, ts);

  return output;
}

function getFileMapping(vfs: Map<string, string>): Record<string, string> {
  const files: Record<string, string> = Object.create(null);
  for (const [srcPath] of vfs) {
    if (SFC_EXT_RE.test(srcPath)) {
      files[srcPath.replace(SFC_EXT_RE, ".vue")] = srcPath;
    }
  }
  return files;
}
