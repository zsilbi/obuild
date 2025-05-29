import consola from "consola";
import { mkdistLoader } from "./mkdist.ts";

import type { InputFile, Transformer, TransformerContext } from "./types.ts";

export interface VueTransformerOptions {
  vue?: {
    /**
     * Declaration generation.
     *
     * Set to `false` to disable.
     */
    dts?: boolean;
  };
}

let cachedVueTransformer: Transformer | undefined;

export const vueTransformer: Transformer = async (
  inputFile: InputFile,
  context: TransformerContext,
) => {
  if (!cachedVueTransformer) {
    cachedVueTransformer = await import("vue-sfc-transformer/mkdist").then(
      (r) =>
        mkdistLoader(r.vueLoader, {
          declaration: context.options.vue?.dts,
        }),
      (error) => {
        consola.error(
          `Failed to transform "${inputFile.path}" because vue-sfc-transformer is not installed.`,
        );

        throw error;
      },
    );
  }
  return cachedVueTransformer!(inputFile, context);
};
