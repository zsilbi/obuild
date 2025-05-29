import { consola } from "consola";
import { oxcTransformer, type OxcTransformerOptions } from "./oxc.ts";
import { vueTransformer, type VueTransformerOptions } from "./vue.ts";

type MaybePromise<T> = T | Promise<T>;

const transformers: Record<TransformerName, Transformer> = {
  oxc: oxcTransformer,
  vue: vueTransformer,
};

const defaultTransformers: Transformer[] = [oxcTransformer, vueTransformer];

export type TransformerName = "oxc" | "vue" | (string & {});

export interface TransformerOptions
  extends OxcTransformerOptions,
    VueTransformerOptions {}

export interface TransformerContext {
  transformFile: TransformFile;

  /**
   * Options passed to the transformer, such as `resolve` options for module resolution.
   */
  options: TransformerOptions;
}

/**
 * Function type for a transformer that processes an input file and returns an array of output files.
 *
 * @param input - The input file to transform.
 * @param context - The context for the transformation, including options and methods to transform files.
 * @return A promise that resolves to an array of output files or undefined if the transformation is not applicable.
 */
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
   * Set to `true` to skip writing this file to the output directory.
   */
  skip?: boolean;

  /**
   * The file is a declaration file (e.g. `.d.mts`)
   *
   * If `"generate"` is set, the transformer will generate a declaration file from the source file.
   */
  declaration?: boolean | "generate";

  /**
   * The file is a source map (e.g. `.js.map`)
   */
  sourceMap?: boolean;

  /**
   * Whether the file is raw (not modified from the input)
   */
  raw?: boolean;
}

export type TransformResult = OutputFile[] | undefined;

/**
 * Function to transform a file using the provided transformers.
 *
 * @param input - The input file to transform.
 * @returns A promise that resolves to an array of output files.
 */
export type TransformFile = (input: InputFile) => MaybePromise<OutputFile[]>;

function resolveTransformer(
  transformer: TransformerName | Transformer,
): Transformer | undefined {
  if (typeof transformer === "string") {
    return transformers[transformer];
  }

  return transformer;
}

function resolveTransformers(
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

/**
 *
 * @param transformers - List of transformers to use. Can be a list of transformer names (e.g. "oxc", "vue") or transformer functions.
 * @param options - Options to pass to the transformers, such as `resolve` options for module resolution.
 * @returns An object with a `transformFile` method to transform files.
 */
export function createTransformer(
  transformers?: Array<TransformerName | Transformer>,
  options: TransformerOptions = {},
): {
  transformFile: TransformFile;
} {
  const resolvedTransformers = resolveTransformers([
    // Provided transformers have higher priority
    ...(transformers || []),
    ...defaultTransformers,
  ]);

  const transformFile = async function (
    input: InputFile,
  ): Promise<OutputFile[]> {
    const context: TransformerContext = {
      transformFile,
      options,
    };

    for (const transformer of resolvedTransformers) {
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
  };
}

export { mkdistLoader } from "./mkdist.ts";
