import type { BuildContext, TransformEntry } from "../types.ts";

import { pathToFileURL } from "node:url";
import { dirname, extname, join, relative } from "node:path";
import { mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { consola } from "consola";
import { colors as c } from "consola/utils";
import { resolveModulePath, type ResolveOptions } from "exsolve";
import MagicString from "magic-string";
import oxcTransform from "oxc-transform";
import oxcParser, { ParserOptions } from "oxc-parser";
import { fmtPath } from "../utils.ts";
import { glob } from "tinyglobby";
import { minify } from "oxc-minify";
import { makeExecutable, SHEBANG_RE } from "./plugins/shebang.ts";

const KNOWN_EXT_RE = /\.(c|m)?[jt]sx?$/;

type TransformConfig = Record<
  string,
  {
    declaration?: string;
    language?: ParserOptions["lang"];
    extension?: string;
  }
>;

const transformConfig: Partial<TransformConfig> = {
  ".ts": {
    language: "ts",
    extension: ".mjs",
    declaration: ".d.mts",
  },
  ".tsx": {
    language: "tsx",
    extension: ".jsx",
    declaration: ".d.mts",
  },
  ".jsx": {
    language: "jsx",
  },
  // ".js": {
  //   extension: ".mjs",
  // },
};

function transformPath(srcPath: string): string {
  const config = transformConfig[extname(srcPath)];

  if (config?.extension === undefined) {
    return srcPath;
  }

  return srcPath.replace(KNOWN_EXT_RE, config.extension);
}

/**
 * Transform all .ts modules in a directory using oxc-transform.
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

  const promises: Promise<string>[] = [];

  for await (const entryName of await glob("**/*.*", { cwd: entry.input })) {
    promises.push(
      (async () => {
        const entrySrcPath = join(entry.input, entryName);
        const entryDistPath = join(entry.outDir!, transformPath(entryName));

        await mkdir(dirname(entryDistPath), { recursive: true });

        const ext = extname(entrySrcPath);
        const config = transformConfig[ext];

        let code: string;

        if (config?.language) {
          const result = await transformModule(
            entrySrcPath,
            entry,
            config.language,
          );

          code = result.code;

          if (config.declaration && result.declaration) {
            await writeFile(
              entryDistPath.replace(KNOWN_EXT_RE, config.declaration),
              result.declaration,
              "utf8",
            );
          }
        } else {
          code = await readFile(entrySrcPath, "utf8");
        }

        await writeFile(entryDistPath, code, "utf8");

        if (SHEBANG_RE.test(code)) {
          await makeExecutable(entryDistPath);
        }

        return entryDistPath;
      })(),
    );
  }

  const writtenFiles = await Promise.all(promises);

  consola.log(
    `\n${c.magenta("[transform] ")}${c.underline(fmtPath(entry.outDir!) + "/")}\n${writtenFiles
      .map((f) => c.dim(fmtPath(f)))
      .join("\n\n")}`,
  );
}

/**
 * Transform a .ts module using oxc-transform.
 */
async function transformModule(
  entryPath: string,
  entry: TransformEntry,
  language: ParserOptions["lang"] = "ts",
) {
  let sourceText = await readFile(entryPath, "utf8");

  const sourceOptions: ParserOptions = {
    lang: language,
    sourceType: "module",
  };

  const parsed = oxcParser.parseSync(entryPath, sourceText, sourceOptions);

  if (parsed.errors.length > 0) {
    throw new Error(`Errors while parsing ${entryPath}:`, {
      cause: parsed.errors,
    });
  }

  const resolveOptions: ResolveOptions = {
    from: pathToFileURL(entryPath),
    ...entry.resolve,
    extensions: entry.resolve?.extensions ?? [
      ".tsx",
      ".ts",
      ".jsx",
      ".js",
      ".mjs",
      ".cjs",
      ".json",
    ],
    suffixes: entry.resolve?.suffixes ?? ["", "/index"],
  };

  const magicString = new MagicString(sourceText);

  // Rewrite relative imports
  const updatedStarts = new Set<number>();
  const rewriteSpecifier = (req: {
    value: string;
    start: number;
    end: number;
  }) => {
    const moduleId = req.value;
    if (!moduleId.startsWith(".")) {
      return;
    }
    if (updatedStarts.has(req.start)) {
      return; // prevent double rewritings
    }
    updatedStarts.add(req.start);
    const resolvedAbsolute = resolveModulePath(moduleId, resolveOptions);
    const newId = relative(dirname(entryPath), transformPath(resolvedAbsolute));
    magicString.remove(req.start, req.end);
    magicString.prependLeft(
      req.start,
      JSON.stringify(newId.startsWith(".") ? newId : `./${newId}`),
    );
  };

  for (const staticImport of parsed.module.staticImports) {
    rewriteSpecifier(staticImport.moduleRequest);
  }

  for (const staticExport of parsed.module.staticExports) {
    for (const staticExportEntry of staticExport.entries) {
      if (staticExportEntry.moduleRequest) {
        rewriteSpecifier(staticExportEntry.moduleRequest);
      }
    }
  }

  sourceText = magicString.toString();

  const transformed = oxcTransform.transform(entryPath, sourceText, {
    ...entry.oxc,
    ...sourceOptions,
    cwd: dirname(entryPath),
    typescript: {
      declaration: { stripInternal: true },
      ...entry.oxc?.typescript,
    },
  });

  const transformErrors = transformed.errors.filter(
    (err) => !err.message.includes("--isolatedDeclarations"),
  );

  if (transformErrors.length > 0) {
    // console.log(sourceText);
    await writeFile(
      "build-dump.ts",
      `/** Error dump for ${entryPath} */\n\n` + sourceText,
      "utf8",
    );
    throw new Error(
      `Errors while transforming ${entryPath}: (hint: check build-dump.ts)`,
      {
        cause: transformErrors,
      },
    );
  }

  if (entry.minify) {
    const res = minify(
      entryPath,
      transformed.code,
      entry.minify === true ? {} : entry.minify,
    );
    transformed.code = res.code;
    transformed.map = res.map;
  }

  return transformed;
}
