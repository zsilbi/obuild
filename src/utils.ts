import { resolve } from "node:path";

export function fmtPath(path: string): string {
  return resolve(path).replace(process.cwd(), ".");
}
