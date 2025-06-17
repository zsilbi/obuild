import consola from "consola";

import type { Plugin } from "@obuild/plugin";

export type PluginName =
  | "oxc-transform"
  | "oxc-minify"
  | "oxc-dts"
  | "tsc-dts"
  | "tsgo-dts"
  | "vue-sfc-transformer"
  | "vue-tsc-dts"
  | "sass"
  | "postcss"
  | (string & {});

export type Plugins = Array<PluginName | Plugin<any>>;

type PluginPackageName = string;
type PluginDirectory = Record<PluginName, PluginPackageName | undefined>;

// prettier-ignore
const pluginDirectory: PluginDirectory = {
  "oxc-transform":       "@obuild/plugin-oxc-transform",
  "oxc-minify":          "@obuild/plugin-oxc-minify",
  "oxc-dts":             "@obuild/plugin-oxc-dts",
  "sass":                "@obuild/plugin-sass",
  "postcss":             "@obuild/plugin-postcss",
  "tsc-dts":             "@obuild/plugin-tsc-dts",
  "tsgo-dts":            "@obuild/plugin-tsgo-dts",
  "vue-sfc-transformer": "@obuild/plugin-vue-sfc-transformer",
  "vue-tsc-dts":         "@obuild/plugin-vue-tsc-dts",
};

export const defaultPlugins: PluginName[] = ["oxc-transform", "oxc-dts"];

async function resolvePlugin(
  plugin: PluginName | Plugin,
): Promise<Plugin | undefined> {
  if (typeof plugin !== "string") {
    return plugin;
  }

  if (plugin in pluginDirectory) {
    const packageName = pluginDirectory[plugin];

    if (!packageName) {
      consola.warn(`Unknown plugin: "${plugin}".`);
      return undefined;
    }

    try {
      const pluginPackage = await import(packageName);

      return pluginPackage.default() || pluginPackage();
    } catch (error) {
      consola.warn(
        `Failed to load plugin "${plugin}". Please install the "${packageName}" package.: \n${error}`,
      );

      return undefined;
    }
  }
}

export async function resolvePlugins(
  plugins: Array<PluginName | Plugin>,
): Promise<Plugin[]> {
  const resolvedPlugins = await Promise.all(
    plugins.map((plugin) => resolvePlugin(plugin)),
  );

  return resolvedPlugins.filter((plugin) => plugin !== undefined);
}
