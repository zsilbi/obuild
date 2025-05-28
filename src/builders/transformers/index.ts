import { consola } from "consola";
import { oxcTransformer, type OxcTransformerOptions } from "./oxc.ts";
import type { BuildContext } from "../../types.ts";
import type { ResolveOptions } from "exsolve";

type MaybePromise<T> = T | Promise<T>;

const transformers: Record<TransformerName, Transformer> = {
  oxc: oxcTransformer,
};

const defaultTransformers: Transformer[] = [oxcTransformer];

export type TransformerName = "oxc" | (string & {});

export interface TransformerOptions extends OxcTransformerOptions {
  build: BuildContext;
  resolve?: Omit<ResolveOptions, "from">;
}

export interface CreateTransformerOptions extends TransformerOptions {
  transformers?: Array<TransformerName | Transformer>;
}

export interface TransformerContext {
  transformFile: TransformFile;
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
  extension: string;
  srcPath?: string;
  getContents: () => MaybePromise<string>;
}

export interface OutputFile {
  /**
   * Relative path to `outDir`
   */
  path: string;
  extension?: string;
  srcPath?: string;
  contents?: string;
  declaration?: boolean;
  sourceMap?: boolean;
  raw?: boolean;
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
  transformers: Array<TransformerName | Transformer> = defaultTransformers,
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
} {
  const transformers = resolveTransformers(options.transformers);

  const transformFile = async function (
    input: InputFile,
  ): Promise<OutputFile[]> {
    const context: TransformerContext = {
      transformFile,
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
  };
}
