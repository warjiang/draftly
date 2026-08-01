import assert from "node:assert/strict";
import { test } from "node:test";
import { buildDesignPreviewStyle, designPreviewName } from "../src/lib/design-preview.js";

test("maps DESIGN.md metadata to isolated preview variables", () => {
  const style = buildDesignPreviewStyle({
    colors: { primary: "#ffffff", background: "#101010" },
    typography: { fontFamily: "Example Sans", scale: { h1: "64px" } },
    radius: { md: "4px" },
  });

  assert.equal(style["--design-primary"], "#ffffff");
  assert.equal(style["--design-on-primary"], "#18181b");
  assert.equal(style["--design-background"], "#101010");
  assert.equal(style["--design-font"], "Example Sans");
  assert.equal(style["--design-h1"], "64px");
  assert.equal(style["--design-radius-md"], "4px");
});

test("uses deterministic fallbacks for incomplete metadata", () => {
  const style = buildDesignPreviewStyle({ colors: { primary: "not-a-color" } });
  assert.equal(style["--design-primary"], "#18181b");
  assert.equal(style["--design-body"], "16px");
  assert.equal(designPreviewName({}, "Fallback"), "Fallback");
});

test("repairs quoted font families produced by the YAML subset parser", () => {
  const style = buildDesignPreviewStyle({
    typography: { fontFamily: 'Geist Variable", sans-serif' },
  });
  assert.equal(style["--design-font"], '"Geist Variable", sans-serif');
});
