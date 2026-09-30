/**
 * The settings page is shipped as data and never type-checked.
 *
 * A regex in config.schema.json is written as a JSON string, so every
 * backslash has to survive one level of escaping on the way in — and a
 * pattern that is wrong only shows as a field the Homebridge UI refuses.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { MATTER_LOG_LEVELS, parsePairingCode } from '../src/config.ts';
import { PLATFORM_NAME } from '../src/settings.ts';

const schema = JSON.parse(readFileSync(new URL('../config.schema.json', import.meta.url), 'utf8'));
const device = schema.schema.properties.devices.items.properties;
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

test('the schema belongs to this platform', () => {
  assert.equal(schema.pluginAlias, PLATFORM_NAME);
});

test('the pairing code field accepts exactly the codes the plugin can read', () => {
  const pattern = new RegExp(device.pairingCode.pattern);
  const accepted = [device.pairingCode.placeholder, '34970112332', '3497 011 2332', 'MT:Y.K90-Q000KA0648G00'];
  for (const code of accepted) {
    assert.match(code, pattern, code);
    assert.notEqual(parsePairingCode(code), undefined, code);
  }
  for (const code of ['3497011233', 'hello', 'MT:']) {
    assert.doesNotMatch(code, pattern, code);
  }
});

test('the log levels offered are the ones the plugin understands', () => {
  const offered = schema.schema.properties.matterLogLevel.oneOf.map((option: { enum: string[] }) => option.enum[0]);
  assert.deepEqual([...offered].sort(), [...MATTER_LOG_LEVELS].sort());
});

test('the package is a Homebridge platform plugin', () => {
  assert.ok(pkg.keywords.includes('homebridge-plugin'));
  assert.equal(pkg.name, 'homebridge-outlet-monitor');
});
