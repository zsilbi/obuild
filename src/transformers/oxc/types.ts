import type { OutputFile } from "../types.ts";
import type { ResolveOptions as ExsolveOptions } from "exsolve";
import type { TransformOptions as OxcTransformOptions } from "oxc-transform";
import type { ParserOptions as OxcParserOptions } from "oxc-parser";
import type { MinifyOptions as OxcMinifyOptions } from "oxc-minify";

export type { SourceMapFile } from "../types.ts";

export type ProcessableFile = OutputFile & {
  contents: string;
  extension: string;
};

export type DeclarationFile = ProcessableFile & {
  type: "declaration";
};

export type MinifiedFile = ProcessableFile & {
  type: "minified";
};

export type ProcessSourceConfig = {
  transform?: OxcParserOptions["lang"];
  extension?: `.${string}`;
};

export type ProcessOptions = {
  resolve: ExsolveOptions;
  parser: OxcParserOptions;
  transform: OxcTransformOptions;
  minify: OxcMinifyOptions | false | undefined;
  sourceConfig: ProcessSourceConfig;
};
