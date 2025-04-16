#!/usr/bin/env node

import type { BuildEntry } from "./types.ts";

import { consola } from "consola";
import { build } from "./build.ts";

const [dir, ...rawEntries] = process.argv.slice(2);

if (!dir || rawEntries.length === 0) {
  consola.error("Usage: obuild <dir> <entry1>...");
  process.exit(1);
}

const entries: BuildEntry[] = rawEntries.map((entry) => {
  const [input, outDir] = entry.split(":") as [string, string | undefined];
  return input.endsWith("/")
    ? { type: "transform", input, outDir }
    : { type: "bundle", input, outDir };
});

await build(dir, entries);
