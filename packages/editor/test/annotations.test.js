import { test } from "node:test";
import assert from "node:assert/strict";
import {
  annotationKey,
  buildStyleEditPayload,
  countStyleEdits,
  hasStyleEdits,
  normalizeStyleEdits,
  normalizeStyleValue,
  sameAnnotation,
  selectionHasComments,
  selectionHasStyleEdits,
} from "../src/lib/annotations.js";

test("normalizeStyleValue appends px to bare numbers except unitless keys", () => {
  assert.equal(normalizeStyleValue("fontSize", "18"), "18px");
  assert.equal(normalizeStyleValue("padding", " 12 "), "12px");
  assert.equal(normalizeStyleValue("fontWeight", "600"), "600");
  assert.equal(normalizeStyleValue("display", "flex"), "flex");
  assert.equal(normalizeStyleValue("color", "#fff"), "#fff");
  assert.equal(normalizeStyleValue("margin", ""), "");
});

test("normalizeStyleEdits drops unknown keys and empty values", () => {
  const result = normalizeStyleEdits({
    color: "red",
    fontSize: "16",
    position: "absolute",
    margin: "  ",
  });
  assert.deepEqual(result, { color: "red", fontSize: "16px" });
});

test("hasStyleEdits and countStyleEdits reflect normalized edits", () => {
  assert.equal(hasStyleEdits({ styleEdits: { color: "red" } }), true);
  assert.equal(hasStyleEdits({ styleEdits: { color: "  " } }), false);
  assert.equal(hasStyleEdits({}), false);
  assert.equal(countStyleEdits({ styleEdits: { color: "red", fontSize: "16" } }), 2);
});

test("selection-level predicates aggregate correctly", () => {
  const selected = [
    { file: "a", line: 1, column: 0, comment: "", styleEdits: {} },
    { file: "b", line: 2, column: 0, comment: " make bold ", styleEdits: {} },
    { file: "c", line: 3, column: 0, comment: "", styleEdits: { color: "red" } },
  ];
  assert.equal(selectionHasComments(selected), true);
  assert.equal(selectionHasStyleEdits(selected), true);
  assert.equal(selectionHasComments([]), false);
  assert.equal(selectionHasStyleEdits([{ styleEdits: {} }]), false);
});

test("buildStyleEditPayload keeps only located edits with styles", () => {
  const selected = [
    { file: "src/App.tsx", line: 10, column: 4, styleEdits: { fontSize: "20" } },
    { file: "src/App.tsx", line: 20, column: 2, styleEdits: {} },
  ];
  assert.deepEqual(buildStyleEditPayload(selected), [
    { file: "src/App.tsx", line: 10, column: 4, styles: { fontSize: "20px" } },
  ]);
});

test("annotation identity helpers", () => {
  const a = { file: "src/App.tsx", line: 5, column: 2 };
  const b = { file: "src/App.tsx", line: 5, column: 2 };
  const c = { file: "src/App.tsx", line: 6, column: 2 };
  assert.equal(annotationKey(a), "src/App.tsx:5:2");
  assert.equal(sameAnnotation(a, b), true);
  assert.equal(sameAnnotation(a, c), false);
  assert.equal(sameAnnotation(a, null), false);
});
