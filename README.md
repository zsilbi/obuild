# 📦 obuild 😯

✅ Zero-config ESM/TS package builder.

Powered by [**oxc**](https://oxc.rs/), [**rolldown**](https://rolldown.rs/) and [**rolldown-plugin-dts**](https://github.com/sxzz/rolldown-plugin-dts).

The **obuild** project aims to be the next-generation successor to the current [unbuild](https://github.com/unjs/unbuild).

- 👌 Focus on ESM compatibility.
- 🌱 Fresh rewrite with cleanups and removal of legacy features.
- 🚀 Using [**oxc**](https://oxc.rs/) (for transform) and [**rolldown**](https://rolldown.rs/) (for bundle) for much faster builds!

Some differences are not easy to adopt. Developing as a standalone project allows for faster progress and dogfooding in real projects.

## Proof of concept

> [!IMPORTANT]
>
> This is a proof-of-concept project.
>
> Features are incomplete, and API and output behavior may change between 0.x versions.
>
> Feedback and contributions are very welcome! If you'd like to make changes with more than a few lines of code, please open an issue first to discuss.

## Currently used by

- [📦 obuild](https://github.com/unjs/obuild/)
- [🌳 rou3](https://github.com/h3js/rou3/)
- [💥 srvx](https://github.com/h3js/srvx)
- [🕊️ unenv](https://github.com/unjs/unenv)
- [🕰️ omnichron](https://github.com/oritwoen/omnichron)
- [...add yours...]

## Usage

### CLI

```sh
# bundle
npx obuild ./src/index.ts

# transform
npx obuild ./src/runtime/:./dist/runtime
```

You can use `--dir` to set the working directory.

If paths end with `/`, obuild uses transpile mode using [oxc-transform](https://www.npmjs.com/package/oxc-transform) instead of bundle mode with [rolldown](https://rolldown.rs/).

### Programmatic

```js
import { build } from "obuild";

await build({
  cwd: ".",
  entries: ["./src/index.ts"],
});
```

## Config

You can use `build.config.mjs` (or `.ts`) or pass config to `build()` function.

```js
import { defineBuildConfig } from "obuild";

export default defineBuildConfig({
  entries: [
    {
      type: "bundle",
      input: ["./src/index.ts", "./src/cli.ts"],
      // outDir: "./dist",
      // minify: false,
      // stub: false,
      // rolldown: {}, // https://rolldown.rs/reference/config-options
      // dts: {}, // https://github.com/sxzz/rolldown-plugin-dts#options
    },
    {
      type: "transform",
      input: "./src/runtime",
      outDir: "./dist/runtime",
      // stub: false,
      // oxc: {},
      // transformers: []
    },
  ],
  hooks: {
    // start: (ctx) => {},
    // end: (ctx) => {},
    // entries: (entries, ctx) => {},
    // rolldownConfig: (config, ctx) => {},
    // rolldownOutput: (output, res, ctx) => {},
  },
});
```

## Transformers

For transform entries, you can use the `transformers` option to specify custom transformers or modify the order of the default transformers.

```ts
import { defineBuildConfig } from "obuild";
import type {
  InputFile,
  OutputFile,
  TransformerContext,
} from "obuild/transformers";

export default defineBuildConfig({
  entries: [
    {
      type: "transform",
      input: "./src/runtime",
      outDir: "./dist/runtime",
      transformers: [
        "vue", // Prepend the default built-in Vue transformer before your custom transformer.
        {
          type: "transform",
          input: "./src/transformers/index.ts",
          transformers: [
            (input: InputFile, context: TransformerContext): OutputFile[] => {
              if (!input.path.endsWith(".foo")) {
                // Do not process non-foo files
                return undefined;
              }

              const output: OutputFile[] = [];
              // ...do your transformation logic here and and them to the output array
              return output;
            },
          ],
        },
        // The default transformers will be invoked after after "vue" and your custom transformer.
      ],
    },
  ],
});
```

### Composing a custom transformer

You can create a custom transformer by implementing the `Transformer` interface. Here's an example of how to create a custom transformer that processes files with a specific extension and adds a custom option to the transformer context options:

```ts
// src/transformers/foo.ts
import type {
  InputFile,
  OutputFile,
  Transformer,
  TransformerContext,
  TransformerOptions,
} from "obuild/transformers";

declare module "obuild/transformers" {
  export interface TransformerOptions {
    foo?: {
      customFooExtension?: string; // Custom option for your transformer
    };
  }
}

export const fooTransformer: Transformer = async (
  inputFile: InputFile,
  context: TransformerContext,
) => {
  const { customFooExtension = ".foo" } = context.options;

  if (!input.path.endsWith(customFooExtension)) {
    // Do not process non-foo files
    return undefined;
  }

  const output: OutputFile[] = [];
  // ...do your transformation logic here and and them to the output array
  return output;
};
```

Then you can use it in your build config:

```ts
import { defineBuildConfig } from "obuild";
import { fooTransformer } from "./src/transformers/foo.ts"; // Import your custom transformer

export default defineBuildConfig({
  entries: [
    {
      type: "transform",
      input: "./src/runtime",
      outDir: "./dist/runtime",
      transformers: [fooTransformer],
      foo: {
        customFooExtension: ".custom-foo", // Custom option for your transformer
      },
    },
  ],
});
```

## Stub Mode

When working on a package locally, it can be tedious to rebuild or run the watch command every time.

You can use `stub: true` (per entry config) or the `--stub` CLI flag. In this mode, obuild skips the actual build and instead links the expected dist paths to the source files.

- For bundle entries, `.mjs` and `.d.mts` files re-export the source file.
- For transpile entries, src dir is symlinked to dist.

**Caveats:**

- You need a runtime that natively supports TypeScript. Deno, Bun, Vite, and Node.js (1)
- For transpile mode, you need to configure your bundler to resolve either `.ts` or `.mjs` extensions.
- For bundle mode, if you add a new entry or add/remove a `default` export, you need to run the stub build again.

(1) For Node.js, you have several options:

- Using `node --experimental-strip-types` (Available in [22.6](https://nodejs.org/en/blog/release/v22.6.0))
- Using [jiti](https://github.com/unjs/jiti) (`node --import jiti/register`)
- Using [oxc-node](https://github.com/oxc-project/oxc-node) (`node --import @oxc-node/core/register`)
- Using [unloader](https://github.com/sxzz/unloader) (`node --import unloader/register`)

## Prior Arts

- [unbuild](https://github.com/unjs/unbuild): Stable solution based on rollup and [mkdist](https://github.com/unjs/mkdist).
- [tsdown](https://tsdown.dev/): Alternative bundler based on rolldown.

## License

💛 Released under the [MIT](./LICENSE) license.
