export { test } from "./test.ts";

// Module resolution test imports, using no extensions
export { tsModule } from "./ts-module";
export { TsxComponent } from "./tsx-component";
// @ts-expect-error - JS test file
export { jsModule } from "./js-module";
// @ts-expect-error - JSX test file
export { JsxComponent } from "./jsx-component";

export default "default export";
