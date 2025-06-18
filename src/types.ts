import type {
  InputOptions,
  MinifyOptions,
  OutputOptions,
  RolldownBuild,
  RolldownPluginOption,
} from "rolldown";

import type { ResolveOptions } from "exsolve";
import type { Plugins } from "./builders/transform/plugins.ts";
import type { Options as DtsOptions } from "rolldown-plugin-dts";
import type { TsConfigJsonResolved as TSConfig } from "get-tsconfig";

export interface BuildContext {
  pkgDir: string;
  pkg: { name: string } & Record<string, unknown>;
}

export interface _BuildEntry {
  /**
   * Output directory relative to project root.
   *
   * Defaults to `dist/` if not provided.
   */
  outDir?: string;

  /**
   * Avoid actual build but instead link to the source files.
   */
  stub?: boolean;
}

export interface BundleEntry extends _BuildEntry {
  type: "bundle";

  /**
   * Entry point(s) to bundle relative to the project root.
   * */
  input: string | string[];

  /**
   * Minify the output using rolldown.
   *
   * Defaults to `false` if not provided.
   */
  minify?: boolean | "dce-only" | MinifyOptions;

  /**
   * Options passed to rolldown.
   *
   * See [rolldown config options](https://rolldown.rs/reference/config-options) for more details.
   */
  rolldown?: InputOptions & { plugins?: RolldownPluginOption[] };

  /**
   * Declaration generation options.
   * Options are inferred from the `tsconfig.json` file if available.
   *
   * See [rolldown-plugin-dts](https://github.com/sxzz/rolldown-plugin-dts) for more details.
   *
   * Set to `false` to disable.
   */
  dts?: boolean | DtsOptions;
}

export interface TransformEntry extends _BuildEntry {
  type: "transform";

  /**
   * Directory to transform relative to the project root.
   */
  input: string;

  /**
   * List of pluginss to use for the transformation.
   * The plugins will be applied in the order they are defined.
   */
  plugins?: Plugins;

  /**
   * Source map directory relative to project root.
   *
   * Defaults to `outDir` if not provided.
   */
  mapDir?: string;

  /**
   * Options for resolving module paths using exsolve.
   *
   * See [exsolve](https://github.com/unjs/exsolve) for more details.
   */
  resolve?: Omit<ResolveOptions, "from">;

  /**
   * TypeScript configuration for the entry.
   * Options are inferred from the `tsconfig.json` file if available.
   *
   * See [tsconfig.json](https://www.typescriptlang.org/tsconfig) for more details.
   */
  tsConfig?: TSConfig;
}

export type BuildEntry = BundleEntry | TransformEntry;

export interface BuildHooks {
  start?: (ctx: BuildContext) => void | Promise<void>;
  end?: (ctx: BuildContext) => void | Promise<void>;
  entries?: (entries: BuildEntry[], ctx: BuildContext) => void | Promise<void>;
  rolldownConfig?: (
    cfg: InputOptions,
    ctx: BuildContext,
  ) => void | Promise<void>;
  rolldownOutput?: (
    cfg: OutputOptions,
    res: RolldownBuild,
    ctx: BuildContext,
  ) => void | Promise<void>;
}

export interface BuildConfig {
  cwd?: string | URL;
  entries?: (BuildEntry | string)[];
  hooks?: BuildHooks;
}
