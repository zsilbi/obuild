import type { BuildEntry, BuildContext, BuildConfig } from "./types.ts";

import { fileURLToPath } from "node:url";
import { isAbsolute, join, resolve } from "node:path";
import { rm } from "node:fs/promises";
import { consola } from "consola";
import { rolldownBuild } from "./builders/bundle.ts";
import { transformDir } from "./builders/transform.ts";
import { fmtPath } from "./utils.ts";

/**
 * Build dist/ from src/
 */
export async function build(
  _cwd: string | URL,
  _entries: BuildEntry[],
  { hooks = {} }: Omit<BuildConfig, "entries"> = {},
): Promise<void> {
  const start = Date.now();

  const pkgDir = normalizePath(_cwd);
  const pkg = await readJSON(join(pkgDir, "package.json")).catch(() => ({}));
  const ctx: BuildContext = { pkg, pkgDir };

  consola.log(
    `📦 Building \`${ctx.pkg.name || "<no name>"}\` (\`${ctx.pkgDir}\`)`,
  );

  await hooks.start?.(ctx);

  const entries = _entries.map((entry) => {
    if (!entry.input) {
      throw new Error(
        `Build entry missing \`input\`: ${JSON.stringify(entry, null, 2)}`,
      );
    }
    entry = { ...entry };
    entry.outDir = normalizePath(entry.outDir || "dist", pkgDir);
    entry.input = Array.isArray(entry.input)
      ? entry.input.map((p) => normalizePath(p, pkgDir))
      : normalizePath(entry.input, pkgDir);
    return entry;
  });

  await hooks.entries?.(entries, ctx);

  const outDirs: Array<string> = [];
  for (const outDir of entries.map((e) => e.outDir).sort() as string[]) {
    if (!outDirs.some((dir) => outDir.startsWith(dir))) {
      outDirs.push(outDir);
    }
  }
  for (const outDir of outDirs) {
    consola.log(`🧻 Cleaning up \`${fmtPath(outDir)}\``);
    await rm(outDir, { recursive: true, force: true });
  }

  for (const entry of entries) {
    await (entry.type === "bundle"
      ? rolldownBuild(ctx, entry, hooks)
      : transformDir(ctx, entry));
  }

  await hooks.end?.(ctx);

  consola.log(`\n✅ obuild finished in ${Date.now() - start}ms`);
}

// --- utils ---

function normalizePath(path: string | URL | undefined, resolveFrom?: string) {
  return typeof path === "string" && isAbsolute(path)
    ? path
    : path instanceof URL
      ? fileURLToPath(path)
      : resolve(resolveFrom || ".", path || ".");
}

function readJSON(specifier: string) {
  return import(specifier, {
    with: { type: "json" },
  }).then((r) => r.default);
}
