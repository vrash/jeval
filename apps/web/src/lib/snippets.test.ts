import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { SDK_EXAMPLE } from "./snippets";

describe("site snippets", () => {
  it("SDK example on the site matches examples/sdk-example.ts and the README", () => {
    const root = resolve(__dirname, "../../../..");
    const example = readFileSync(resolve(root, "examples/sdk-example.ts"), "utf8");
    expect(example.trim()).toBe(SDK_EXAMPLE.trim());
    const readme = readFileSync(resolve(root, "README.md"), "utf8");
    expect(readme).toContain(SDK_EXAMPLE.trim());
  });
});
