import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildSourceTree,
  defaultSourceFile,
  filterSourceTree,
  formatSourceSize,
  sourceLanguage,
  sourceParentPaths,
} from "../src/lib/source-workspace.js";

const files = [
  { path: "package.json", name: "package.json", size: 500 },
  { path: "src/components/Button.tsx", name: "Button.tsx", size: 2048 },
  { path: "src/App.tsx", name: "App.tsx", size: 1024 },
  { path: "src/index.css", name: "index.css", size: 256 },
];

test("builds a directory-first source tree with stable file sorting", () => {
  const tree = buildSourceTree(files);
  assert.deepEqual(tree.map((node) => node.path), ["src", "package.json"]);
  assert.deepEqual(tree[0].children.map((node) => node.path), [
    "src/components",
    "src/App.tsx",
    "src/index.css",
  ]);
});

test("filters by full path while preserving matching ancestors", () => {
  const tree = buildSourceTree(files);
  const result = filterSourceTree(tree, "button");
  assert.equal(result.length, 1);
  assert.equal(result[0].path, "src");
  assert.equal(result[0].children[0].children[0].path, "src/components/Button.tsx");
  assert.equal(filterSourceTree(tree, "src").length, 1);
  assert.equal(filterSourceTree(tree, "missing").length, 0);
});

test("selects preferred source, then App.tsx, then the first file", () => {
  assert.equal(defaultSourceFile(files, "src/index.css"), "src/index.css");
  assert.equal(defaultSourceFile(files, "missing.ts"), "src/App.tsx");
  assert.equal(defaultSourceFile([{ path: "index.html" }]), "index.html");
  assert.equal(defaultSourceFile([]), null);
});

test("maps source languages, parent paths, and readable file sizes", () => {
  assert.equal(sourceLanguage("src/App.tsx"), "typescript");
  assert.equal(sourceLanguage("public/icon.svg"), "html");
  assert.equal(sourceLanguage(".gitignore"), "plaintext");
  assert.deepEqual(sourceParentPaths("src/components/ui/button.tsx"), [
    "src",
    "src/components",
    "src/components/ui",
  ]);
  assert.equal(formatSourceSize(500), "500 B");
  assert.equal(formatSourceSize(2048), "2 KB");
});
