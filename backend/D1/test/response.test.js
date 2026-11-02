import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ok, fail } from '../src/utils/response.js';
test('response envelopes preserve payload and unique request IDs', () => {
 const a = ok({ id: '9223372036854775807' });
 assert.equal(a.code, 'OK'); assert.equal(a.data.id, '9223372036854775807');
 const b = fail('FORBIDDEN', '拒绝');
 assert.equal(b.code, 'FORBIDDEN'); assert.equal(b.data, null);
 assert.match(a.request_id, /^[0-9a-f-]{36}$/); assert.notEqual(a.request_id, b.request_id);
});
