import assert from "node:assert/strict";
import { it } from "node:test";
import { appPalette } from "../src/theme.ts";

it("reads app mode and every palette color, including surface-only edits, without consulting OS preferences", () => {
  const names = ["document", "getComputedStyle", "matchMedia"] as const;
  const originals = names.map(name => Object.getOwnPropertyDescriptor(globalThis, name));
  let mode = "dark";
  const values = new Map<string, string>();
  try {
    Object.defineProperties(globalThis, {
      document: { configurable: true, value: { documentElement: { classList: { contains: (name: string) => name === mode } } } },
      getComputedStyle: { configurable: true, value: () => ({ getPropertyValue: (name: string) => values.get(name) ?? "" }) },
      matchMedia: { configurable: true, value: () => { throw new Error("OS preferences must not select Drawing Pad ink"); } },
    });
    assert.equal(appPalette().mode, "dark"); let before = appPalette().key;
    mode = "light"; assert.equal(appPalette().mode, "light"); assert.notEqual(appPalette().key, before);
    for (const name of ["--background", "--foreground", "--card", "--border", "--muted-foreground", "--ow-accent",
      "--ow-ink-strong", "--ow-ink-italic", "--ow-ink-code", "--ow-error", "--ow-success", "--ow-warning"]) {
      before = appPalette().key; values.set(name, "#abcdef"); assert.notEqual(appPalette().key, before, name);
    }
  } finally {
    names.forEach((name, index) => {
      const descriptor = originals[index];
      if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name);
    });
  }
});
