import { dirname } from "pathe";

import type { InputFile, TransformerContext } from "../types.ts";
import type { ProcessSourceConfig, ProcessOptions } from "./types.ts";
import type { ResolveOptions as ExsolveOptions } from "exsolve";
import type { TransformOptions as OxcTransformOptions } from "oxc-transform";
import type { ParserOptions as OxcParserOptions } from "oxc-parser";
import type { MinifyOptions as OxcMinifyOptions } from "oxc-minify";

const DECLARATION_RE: RegExp = /\.d\.[cm]?ts$/;

const sourceConfig: Record<string, ProcessSourceConfig | undefined> = {
  ".ts": {
    transform: "ts",
    extension: ".mjs",
  },
  ".mts": {
    transform: "ts",
    extension: ".mjs",
  },
  ".tsx": {
    transform: "tsx",
    extension: ".mjs",
  },
  ".jsx": {
    transform: "jsx",
    extension: ".mjs",
  },
  ".js": {},
  ".mjs": {},
  ".cjs": {},
};

export function getTargetExtension(
  sourceExtension: string,
): string | undefined {
  return sourceConfig[sourceExtension]?.extension;
}

/**
 * @param input - The input file to process.
 * @param context - Transformer context
 * @returns ProcessOptions or undefined if the input file should not be processed.
 */
export function resolveProcessOptions(
  input: InputFile,
  context: TransformerContext,
): ProcessOptions | undefined {
  const processSourceConfig = sourceConfig[input.extension];

  if (processSourceConfig === undefined || DECLARATION_RE.test(input.path)) {
    return;
  }

  const { oxc: options } = context.options;

  const resolve: ExsolveOptions = {
    ...options?.resolve,
    extensions: options?.resolve?.extensions ?? [
      ".tsx",
      ".ts",
      ".jsx",
      ".js",
      ".mjs",
      ".cjs",
      ".json",
    ],
    suffixes: options?.resolve?.suffixes ?? ["", "/index"],
  };

  const parser: OxcParserOptions = {
    lang: processSourceConfig.transform,
    sourceType: "module",
  };

  // Enable source map for both transform and minify if it's enabled in any of them
  const sourcemap: boolean | undefined =
    (typeof options?.minify === "object" && options.minify.sourcemap) ||
    options?.transform?.sourcemap;

  const transform: OxcTransformOptions = {
    ...options?.transform,
    ...parser,
    cwd: input.srcPath ? dirname(input.srcPath) : undefined,
    typescript: {
      declaration: {
        // @todo - Should we make this also the default for the bundler?
        stripInternal: true,
      },
      ...options?.transform?.typescript,
    },
    sourcemap,
  };

  const minify: OxcMinifyOptions | undefined =
    options?.minify === true
      ? { sourcemap }
      : options?.minify
        ? { ...options?.minify, sourcemap }
        : undefined;

  return {
    resolve,
    parser,
    transform,
    minify,
    sourceConfig: processSourceConfig,
  };
}
