/**
 * Requests from the settings page to the running plugin, and its answers.
 */
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { addRequest, answer, dropRequest, takeAnswer, takeRequests } from '../src/requests.ts';

const folder = () => mkdtempSync(join(tmpdir(), 'requests-'));

test('requests are taken once, oldest first', () => {
  const dir = folder();
  assert.deepEqual(takeRequests(dir), [], 'none yet, and no folder');
  addRequest(dir, { id: 'a1', name: 'Trockner', action: 'forget' });
  addRequest(dir, { id: 'b2', name: 'Trockner', action: 'learn', from: 1, to: 2 });
  assert.deepEqual(takeRequests(dir).map(({ id }) => id), ['a1', 'b2']);
  assert.deepEqual(takeRequests(dir), [], 'taken means gone');
});

test('an answer is read once, by its id', () => {
  const dir = folder();
  assert.equal(takeAnswer(dir, 'a1'), undefined);
  answer(dir, 'a1', { ok: true, message: 'Forgotten.' });
  assert.deepEqual(takeAnswer(dir, 'a1'), { ok: true, message: 'Forgotten.' });
  assert.equal(takeAnswer(dir, 'a1'), undefined);
});

test('a request nobody took can be withdrawn', () => {
  const dir = folder();
  addRequest(dir, { id: 'a1', name: 'Trockner', action: 'forget' });
  dropRequest(dir, 'a1');
  assert.deepEqual(takeRequests(dir), []);
});

test('an id that could reach outside the folder is refused', () => {
  const dir = folder();
  assert.throws(() => addRequest(dir, { id: '../x', name: 'Trockner', action: 'forget' }));
  assert.equal(takeAnswer(dir, '../x'), undefined);
});
