import consola from "consola";
import type { InputFile, Transformer, TransformerContext } from "./index.ts";

export interface VueTransformerOptions {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  vue?: {};
}

let cachedVueTransformer: Transformer | undefined;

export const vueTransformer: Transformer = async (
  inputFile: InputFile,
  context: TransformerContext,
) => {
  if (!cachedVueTransformer) {
    cachedVueTransformer = await import("vue-sfc-transformer/mkdist").then(
      (r) => r.vueLoader,
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
