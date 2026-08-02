import assert from 'node:assert/strict';
import { AssertionError } from 'node:assert';
import { test } from 'node:test';
import { isRecoverableSocketError } from '../src/crash-guard.js';

test('识别 undici HTTP 解析器的断言崩溃', () => {
  const error = new AssertionError({ message: 'false == true', actual: false, expected: true, operator: '==' });
  error.stack = [
    'AssertionError [ERR_ASSERTION]: false == true',
    '    at Parser.finish (node:internal/deps/undici/undici:7388:9)',
    '    at Socket.onHttpSocketEnd (node:internal/deps/undici/undici:7827:34)',
  ].join('\n');
  assert.equal(isRecoverableSocketError(error), true);
});

test('识别常见的连接中断错误码', () => {
  for (const code of ['ECONNRESET', 'EPIPE', 'UND_ERR_SOCKET']) {
    assert.equal(isRecoverableSocketError(Object.assign(new Error(code), { code })), true, code);
  }
});

test('普通业务错误不会被吞掉', () => {
  assert.equal(isRecoverableSocketError(new TypeError('boom')), false);
  const assertion = new AssertionError({ message: 'nope', actual: 1, expected: 2, operator: '==' });
  assertion.stack = 'AssertionError [ERR_ASSERTION]: nope\n    at Object.<anonymous> (/app/src/drafts.ts:12:3)';
  assert.equal(isRecoverableSocketError(assertion), false);
  assert.equal(isRecoverableSocketError(null), false);
  assert.equal(isRecoverableSocketError('ECONNRESET'), false);
});
