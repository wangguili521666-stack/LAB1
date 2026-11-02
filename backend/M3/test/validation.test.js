import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { id, text, role, pool } from '../src/common.js';
after(() => pool.end());
test('ID and text validation reject malformed input', () => {
 assert.equal(id('123'), '123');
 for (const value of [0, '', '0', '-1', '1.2']) assert.throws(() => id(value), { status: 400 });
 assert.equal(text(' hello '), 'hello');
 for (const value of ['', ' ', null]) assert.throws(() => text(value), { status: 400 });
 assert.throws(() => text('abcd', 3), { status: 400 });
});
test('role gate rejects unauthorized roles', () => {
 assert.doesNotThrow(() => role({ roles: ['WORKER'] }, 'WORKER'));
 assert.throws(() => role({ roles: ['STUDENT'] }, 'WORKER'), { status: 403 });
});
