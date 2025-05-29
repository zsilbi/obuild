import { consola } from "consola";
import { oxcTransformer, type OxcTransformerOptions } from "./oxc.ts";
import type { BuildContext } from "../../types.ts";
import type { ResolveOptions } from "exsolve";
import { vueTransformer } from "./vue.ts";

type MaybePromise<T> = T | Promise<T>;

const transformers: Record<TransformerName, Transformer> = {
  oxc: oxcTransformer,
  vue: vueTransformer,
};

const defaultTransformers: Transformer[] = [oxcTransformer, vueTransformer];

export type TransformerName = "oxc" | "vue" | (string & {});

export interface TransformerOptions extends OxcTransformerOptions {
  build: BuildContext;
  resolve?: Omit<ResolveOptions, "from">;
}

export interface CreateTransformerOptions extends TransformerOptions {
  transformers?: Array<TransformerName | Transformer>;
}

export interface TransformerContext {
  transformFile: TransformFile;
  /**
   * For compatibility with `mkdist` loaders
   *
   * @deprecated Use `transformFile()` instead
   */
  loadFile: TransformFile;
  options: TransformerOptions;
}

export type Transformer = (
  input: InputFile,
  context: TransformerContext,
) => MaybePromise<TransformResult>;

export interface InputFile {
  /**
   * Relative path to `outDir`
   */
  path: string;
  /**
   * File extension, e.g. `.ts`, `.mjs`, `.jsx`, `.d.mts`
   */
  extension: string;
  /**
   * Absolute source path of the file
   */
  srcPath?: string;
  /**
   * Loads the raw contents of the file
   */
  getContents: () => MaybePromise<string>;
}

export interface OutputFile {
  /**
   * Relative path to `outDir`
   */
  path: string;
  /**
   * File extension, e.g. `.js`, `.mjs`, `.jsx`, `.d.mts`
   */
  extension?: string;
  /**
   * Absolute source path of the file
   */
  srcPath?: string;
  /**
   * Contents of the file, if available
   */
  contents?: string;
  /**
   * The output file is a declaration file (e.g. `.d.mts`)
   */
  declaration?: boolean;
  /**
   * The output file is a source map (e.g. `.js.map`)
   */
  sourceMap?: boolean;
  /**
   * Whether the file is raw (not modified from the input)
   */
  raw?: boolean;
  /**
   * Set to `true` to skip writing this file to the output directory.
   */
  skip?: boolean;
}

export type TransformResult = OutputFile[] | undefined;

export type TransformFile = (input: InputFile) => MaybePromise<OutputFile[]>;

export function resolveTransformer(
  transformer: TransformerName | Transformer,
): Transformer | undefined {
  if (typeof transformer === "string") {
    return transformers[transformer];
  }

  return transformer;
}

export function resolveTransformers(
  transformers: Array<TransformerName | Transformer>,
): Transformer[] {
  return transformers
    .map((transformerOrName) => {
      const transformer = resolveTransformer(transformerOrName);

      if (!transformer) {
        consola.warn("Unknown transformer:", transformerOrName);
      }

      return transformer;
    })
    .filter((transformer) => transformer !== undefined);
}

export function createTransformer(options: CreateTransformerOptions): {
  transformFile: TransformFile;
  loadFile: TransformFile;
} {
  const transformers = resolveTransformers([
    // Provided transformers have higher priority
    ...(options.transformers || []),
    ...defaultTransformers,
  ]);

  const transformFile = async function (
    input: InputFile,
  ): Promise<OutputFile[]> {
    const context: TransformerContext = {
      transformFile,
      loadFile: transformFile,
      options,
    };

    for (const transformer of transformers) {
      const outputs = await transformer(input, context);

      if (outputs?.length) {
        return outputs;
      }
    }

    return [
      {
        path: input.path,
        srcPath: input.srcPath,
        raw: true,
      },
    ];
  };

  return {
    transformFile,
    loadFile: transformFile,
  };
}
