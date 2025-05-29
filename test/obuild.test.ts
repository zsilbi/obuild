import { describe, test, expect, beforeAll } from "vitest";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "../src/build.ts";
import { readdir, readFile, rm, stat } from "node:fs/promises";

const fixtureDir = new URL("fixture/", import.meta.url);
const distDir = new URL("dist/", fixtureDir);

describe("obuild", () => {
  beforeAll(async () => {
    await rm(distDir, { recursive: true, force: true });
  });

  test("build fixture", async () => {
    await build({
      cwd: fixtureDir,
      entries: [
        { type: "bundle", input: ["src/index", "src/cli"] },
        "src/utils.ts",
        {
          type: "transform",
          input: "src/runtime",
          outDir: "dist/runtime",
        },
        {
          type: "transform",
          input: "src/min",
          outDir: "dist/min",
          oxc: {
            minify: {
              sourcemap: true,
            },
          },
        },
      ],
    });
  });

  test("dist files match expected", async () => {
    const distFiles = await readdir(distDir, {
      recursive: true,
      withFileTypes: true,
    }).then((entries) =>
      entries
        .filter((entry) => entry.isFile())
        .map((entry) =>
          relative(fileURLToPath(distDir), join(entry.parentPath, entry.name)),
        )
        .sort(),
    );

    expect(distFiles).toMatchInlineSnapshot(`
      [
        "cli.d.mts",
        "cli.mjs",
        "index.d.mts",
        "index.mjs",
        "min/test.mjs",
        "min/test.mjs.map",
        "runtime/components/jsx.jsx",
        "runtime/components/tsx.d.mts",
        "runtime/components/tsx.jsx",
        "runtime/components/vue.vue",
        "runtime/index.d.mts",
        "runtime/index.mjs",
        "runtime/modules/js-module.js",
        "runtime/modules/mjs-module.mjs",
        "runtime/modules/ts-module.d.mts",
        "runtime/modules/ts-module.mjs",
        "runtime/test.d.mts",
        "runtime/test.mjs",
        "utils.d.mts",
        "utils.mjs",
      ]
    `);
  });

  test("validate dist entries", async () => {
    const distIndex = await import(new URL("index.mjs", distDir).href);
    expect(distIndex.test).instanceOf(Function);

    const distRuntimeIndex = await import(new URL("index.mjs", distDir).href);
    expect(distRuntimeIndex.test).instanceOf(Function);

    const distUtils = await import(new URL("utils.mjs", distDir).href);
    expect(distUtils.test).instanceOf(Function);
  });

  test("runtime .dts files use .mjs extension", async () => {
    const runtimeIndexMts = await readFile(
      new URL("runtime/index.d.mts", distDir),
      "utf8",
    );
    expect(runtimeIndexMts).contain("./test.mjs");
  });

  test("cli shebang is executable", async () => {
    const cliPath = new URL("cli.mjs", distDir);
    const stats = await stat(cliPath);
    expect(stats.mode & 0o111).toBe(0o111); // Check if executable
  });
});
