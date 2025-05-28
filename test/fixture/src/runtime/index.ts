export { test } from "./test.ts"; // Explicitly import the test file with .ts extension

// Module resolution test imports, using no extensions
export { tsModule } from "./ts-module";
export { TsxComponent } from "./tsx-component";
// @ts-expect-error - JS test file
export { jsModule } from "./js-module";
// @ts-expect-error - JSX test file
export { JsxComponent } from "./jsx-component";

export default "default export";
