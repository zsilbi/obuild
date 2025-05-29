import consola from "consola";
import type { InputFile, Transformer, TransformerContext } from "./index.ts";

let cachedVueTransformer: Transformer | undefined;

export const vueTransformer: Transformer = async (
  file: InputFile,
  ctx: TransformerContext,
) => {
  if (!cachedVueTransformer) {
    cachedVueTransformer = await import("vue-sfc-transformer/mkdist").then(
      (r) => r.vueLoader,
      (error) => {
        consola.error(
          `Failed to transform "${file.path}" because vue-sfc-transformer is not installed.`,
        );

        throw error;
      },
    );
  }
  return cachedVueTransformer!(file, ctx);
};
