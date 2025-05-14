import { builtinModules } from "node:module";
import { dirname, relative, join, basename, extname, resolve } from "node:path";
import { consola } from "consola";
import { rolldown } from "rolldown";
import { dts } from "rolldown-plugin-dts";
import { fmtPath } from "../utils.ts";
import { resolveModulePath } from "exsolve";

import type { Plugin } from "rolldown";
import type { BuildContext, BuildHooks, BundleEntry } from "../types.ts";
import type { InputOptions, OutputOptions } from "rolldown";

export async function rolldownBuild(
  ctx: BuildContext,
  entry: BundleEntry,
  hooks: BuildHooks,
): Promise<void> {
  const start = Date.now();

  const inputs: Record<string, string> = {};

  for (let src of Array.isArray(entry.input) ? entry.input : [entry.input]) {
    src = resolveModulePath(src, {
      from: ctx.pkgDir,
      extensions: [".ts", ".mjs", ".js"],
    });
    let relativeSrc = relative(join(ctx.pkgDir, "src"), src);
    if (relativeSrc.startsWith("..")) {
      relativeSrc = relative(join(ctx.pkgDir), src);
    }
    if (relativeSrc.startsWith("..")) {
      throw new Error(
        `Source should be within the package directory (${ctx.pkgDir}): ${src}`,
      );
    }

    const distName = join(
      dirname(relativeSrc),
      basename(relativeSrc, extname(relativeSrc)),
    );
    if (inputs[distName]) {
      throw new Error(
        `Rename one of the entries to avoid a conflict in the dist name "${distName}":\n - ${src}\n - ${inputs[distName]}`,
      );
    }
    inputs[distName] = src;
  }

  const rolldownConfig = {
    cwd: ctx.pkgDir,
    input: inputs,
    plugins: [] as Plugin[],
    external: [
      ...builtinModules,
      ...builtinModules.map((m) => `node:${m}`),
      ...[
        ...Object.keys(ctx.pkg.dependencies || {}),
        ...Object.keys(ctx.pkg.peerDependencies || {}),
      ].flatMap((p) => [p, new RegExp(`^${p}/`)]),
    ],
  } satisfies InputOptions;

  if (entry.declaration !== false) {
    rolldownConfig.plugins!.push(
      ...dts({ isolatedDeclarations: entry.declaration }),
    );
  }

  await hooks.rolldownConfig?.(rolldownConfig, ctx);

  const res = await rolldown(rolldownConfig);

  const outConfig: OutputOptions = {
    dir: entry.outDir,
    entryFileNames: "[name].mjs",
    chunkFileNames: "_chunks/[name]-[hash].mjs",
    minify: entry.minify,
  };

  await hooks.rolldownOutput?.(outConfig, res, ctx);

  const { output } = await res.write(outConfig);

  await res.close();

  consola.log(
    `📦 Bundled in ${Date.now() - start}ms:\n${output
      .filter(
        (o) => o.type === "chunk" && o.isEntry && o.fileName.endsWith("js"),
      )
      .map(
        (o) =>
          ` - ${fmtPath(resolve(ctx.pkgDir, entry.outDir || "dist", o.fileName))}`,
      )
      .join("\n")} `,
  );
}
