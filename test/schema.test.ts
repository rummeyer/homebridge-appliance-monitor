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

import { DEFAULT_RESET_MINUTES, MATTER_LOG_LEVELS, MIN_POLL_SECONDS, parsePairingCode, RESET_MODES } from '../src/config.ts';
import { LEARNING_DEFAULTS } from '../src/monitor.ts';
import { DEFAULT_HOLD_SECONDS, DEFAULT_MIN_SECONDS } from '../src/phases.ts';
import { DEFAULT_RECORD_DAYS } from '../src/recorder.ts';
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
  assert.equal(pkg.name, 'homebridge-appliance-monitor');
});

test('the resets offered are the ones the plugin understands, with the same default', () => {
  const offered = device.finishedReset.oneOf.map((option: { enum: string[] }) => option.enum[0]);
  assert.deepEqual([...offered].sort(), [...RESET_MODES].sort());
  assert.equal(device.finishedReset.default, 'off-level');
  assert.equal(device.finishedResetMinutes.default, DEFAULT_RESET_MINUTES);
});

test('every threshold the plugin uses can be fixed on the settings page, and no other', () => {
  assert.deepEqual(Object.keys(device.thresholds.properties).sort(), Object.keys(LEARNING_DEFAULTS).sort());
  assert.equal(Number(device.thresholds.properties.startSeconds.placeholder), LEARNING_DEFAULTS.startSeconds);
});

test('the custom settings page is where the schema says, and is published', () => {
  assert.equal(schema.customUi, true);
  const page = new URL(`../${schema.customUiPath.replace(/^\.\//, '')}/`, import.meta.url);
  assert.ok(readFileSync(new URL('server.js', page), 'utf8').includes('/statistics'));
  assert.ok(readFileSync(new URL('public/index.html', page), 'utf8').includes("'/statistics'"));
  assert.ok(pkg.files.includes('homebridge-ui'), 'shipped in the package');
  assert.ok(pkg.dependencies['@homebridge/plugin-ui-utils'], 'and what it needs is installed with it');
});

test('a phase on the settings page shows the defaults the plugin falls back to', () => {
  const phase = device.phases.items.properties;
  // Placeholders, not defaults: a default would fill the empty phase the page
  // offers under every plug, and it would no longer be empty.
  assert.equal(Number(phase.minSeconds.placeholder), DEFAULT_MIN_SECONDS);
  assert.equal(Number(phase.holdSeconds.placeholder), DEFAULT_HOLD_SECONDS);
  assert.equal(phase.minSeconds.default, undefined);
  assert.equal(phase.holdSeconds.default, undefined);
  assert.equal(phase.sensor.default, true);
  assert.equal(schema.schema.properties.recordDays.default, DEFAULT_RECORD_DAYS);
});

test('a plug starts with no phases on the settings page, only the button to add one', () => {
  // The Homebridge UI's form offers one empty entry in every list unless told
  // otherwise, and it would show under every plug.
  assert.equal(device.phases.listItems, 0);
});

test('the shortest poll the settings page allows is the one the plugin accepts', () => {
  assert.equal(device.pollSeconds.minimum, MIN_POLL_SECONDS);
  assert.equal(device.pollSeconds.default, undefined, 'off unless asked for');
});
