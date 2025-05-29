import type {
  InputFile,
  OutputFile,
  Transformer,
  TransformerContext,
} from "./index.ts";

type MaybePromise<T> = T | Promise<T>;

type MkdistOutputFile = Omit<OutputFile, "declaration"> & {
  errors?: Error[];
  declaration?: boolean;
};

type MkdistLoaderContext = Omit<TransformerContext, "transformFile"> & {
  loadFile: (input: InputFile) => MaybePromise<MkdistOutputFile[]>;
};

type MkdistLoader = (
  input: InputFile,
  context: MkdistLoaderContext,
) => MaybePromise<MkdistOutputFile[] | undefined>;

type MkdistLoaderOptions = {
  /**
   * Declaration generation.
   *
   * Set to `false` to disable.
   */
  declaration?: boolean;
};

/**
 * Creates a transformer that uses a mkdist loader for compatibility.
 *
 * @param loader - The mkdist loader function to use.
 * @param options - Additional options for the mkdist loader.
 * @returns A transformer that can be used in the transformation process.
 */
export function mkdistLoader(
  loader: MkdistLoader,
  options: MkdistLoaderOptions,
): Transformer {
  const DECLARATION_RE = /\.d\.[cm]?ts$/;
  const CM_LETTER_RE = /(?<=\.)(c|m)(?=[jt]s$)/;
  const KNOWN_EXT_RE = /\.(c|m)?[jt]sx?$/;

  /**
   * mkdist compatible JS loader that adds declaration file output `.js` files also
   */
  const jsLoader = async (
    input: InputFile,
  ): Promise<MkdistOutputFile[] | undefined> => {
    if (
      options.declaration === false ||
      !KNOWN_EXT_RE.test(input.path) ||
      DECLARATION_RE.test(input.path) ||
      input.srcPath?.match(DECLARATION_RE)
    ) {
      return;
    }

    const cm = input.srcPath?.match(CM_LETTER_RE)?.[0] || "";

    return [
      {
        contents: await input.getContents(),
        srcPath: input.srcPath,
        path: input.path,
        extension: `.d.${cm}ts`,
        declaration: true,
      },
    ];
  };

  const fromMkdistOutputFile: (
    output: MkdistOutputFile,
  ) => Promise<OutputFile> = async (output) => {
    if (
      output.declaration === true &&
      output.skip !== true &&
      !DECLARATION_RE.test(output.path)
    ) {
      return {
        ...output,
        declaration: "generate",
      };
    }

    return output;
  };

  const toMkdistOutputFile: (output: OutputFile) => MkdistOutputFile = (
    output,
  ) => {
    return {
      ...output,
      declaration:
        output.declaration === true || output.declaration === "generate",
    };
  };

  return async (input, context: TransformerContext) => {
    const mkdistContext: MkdistLoaderContext = {
      ...context,
      loadFile: async (inputFile: InputFile): Promise<MkdistOutputFile[]> => {
        const dtsOutput = (await jsLoader(inputFile)) || [];
        const output = await context.transformFile(inputFile);

        return [...dtsOutput, ...output].map((element) =>
          toMkdistOutputFile(element),
        );
      },
    };

    const output = await loader(input, mkdistContext);

    return Promise.all(output?.map(fromMkdistOutputFile) || []);
  };
}
