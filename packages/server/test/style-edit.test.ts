import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  ALLOWED_STYLE_PROPERTIES,
  applyStyleEditsToSource,
  sanitizeStyleMap,
} from '../src/style-edit.js';

test('inserts a style attribute when the element has none', () => {
  const source = 'export const A = () => <button className="btn">Go</button>;\n';
  const next = applyStyleEditsToSource(source, [
    { line: 1, column: 24, styles: { color: 'red', fontSize: '18px' } },
  ]);
  assert.match(next, /<button style=\{\{ color: 'red', fontSize: '18px' \}\} className="btn">/);
});

test('merges into an existing inline style object, overriding matches', () => {
  const source =
    'export const A = () => <div style={{ color: "black", padding: "4px" }}>x</div>;\n';
  const next = applyStyleEditsToSource(source, [
    { line: 1, column: 24, styles: { color: 'white', margin: '8px' } },
  ]);
  // color overridden in place
  assert.match(next, /color: 'white'/);
  assert.doesNotMatch(next, /color: "black"/);
  // untouched property preserved
  assert.match(next, /padding: "4px"/);
  // new property appended
  assert.match(next, /margin: '8px'/);
});

test('applies edits to multiple elements in one file back-to-front', () => {
  const source = [
    'export const A = () => (',
    '  <section>',
    '    <h1>Title</h1>',
    '    <p>Body</p>',
    '  </section>',
    ');',
    '',
  ].join('\n');
  const next = applyStyleEditsToSource(source, [
    { line: 3, column: 5, styles: { fontSize: '32px' } },
    { line: 4, column: 5, styles: { color: 'gray' } },
  ]);
  assert.match(next, /<h1 style=\{\{ fontSize: '32px' \}\}>Title<\/h1>/);
  assert.match(next, /<p style=\{\{ color: 'gray' \}\}>Body<\/p>/);
});

test('preserves a non-object style value via spread', () => {
  const source = 'export const A = ({ s }) => <div style={s}>x</div>;\n';
  const next = applyStyleEditsToSource(source, [
    { line: 1, column: 28, styles: { color: 'red' } },
  ]);
  assert.match(next, /style=\{\{ \.\.\.\(s\), color: 'red' \}\}/);
});

test('sanitizeStyleMap rejects unknown properties', () => {
  assert.throws(() => sanitizeStyleMap({ position: 'absolute' }), /unsupported style property/);
});

test('sanitizeStyleMap rejects values that could break out of the literal', () => {
  assert.throws(() => sanitizeStyleMap({ color: "red'}}<script>" }), /invalid style value/);
});

test('sanitizeStyleMap drops empty values and keeps valid ones', () => {
  const clean = sanitizeStyleMap({ color: '  #fff ', fontSize: '' });
  assert.deepEqual(clean, { color: '#fff' });
});

test('every allowed property is a valid JS identifier', () => {
  for (const key of ALLOWED_STYLE_PROPERTIES) {
    assert.match(key, /^[a-zA-Z][a-zA-Z0-9]*$/);
  }
});
