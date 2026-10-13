// -----------------------------------------------------------------------------
// Structure non-regression: what users of 1.1.0 already created must keep its
// meaning.
//
// The discovery "Update" button of Gladys compares the forever fields of each
// feature (external_id, category, type, unit, min, max); a change there forces
// the user to delete and recreate a device, losing its history and its scenes.
//
// test/fixtures/discovery.baseline.json was generated from the v1.1.0 code,
// before any change of this version, by building ONE node that exposes every
// entity shape the mapping handles (test/fixtures/discovery.entities.json).
// test/fixtures/manifest.baseline.json holds the configuration and action keys
// of 1.1.0. A difference is a breaking change: it needs an entry in
// ALLOWED_CHANGES with its migration, in the changelog, the docs and the forum
// message.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildDevice } from '../src/devices.js';
import { fakeGladys } from './helpers/fakeGladys.js';

const read = (path) => JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'));
const entities = read('test/fixtures/discovery.entities.json');
const baseline = read('test/fixtures/discovery.baseline.json');
const manifestBaseline = read('test/fixtures/manifest.baseline.json');
const manifest = read('gladys-assistant-integration.json');

// No allowed change in this version.
const ALLOWED_CHANGES = [];

const FOREVER_FEATURE_FIELDS = [
  'external_id',
  'category',
  'type',
  'unit',
  'min',
  'max',
  'read_only',
  'has_feedback',
];

/**
 * Build the device of the baseline node with the current code.
 * @returns {object} The device, as discovery publishes it.
 */
function currentDevice() {
  const gladys = fakeGladys({ selector: 'ext-esphome' });
  return buildDevice(gladys, { name: 'salon', host: '192.168.1.42', port: 6053 }, entities, {
    friendlyName: 'Salon',
    esphomeVersion: '2026.9.0',
  });
}

test('the device external id and params of 1.1.0 are kept', () => {
  const [before] = baseline.devices;
  const now = currentDevice();
  assert.equal(now.external_id, before.external_id);
  assert.deepEqual(
    now.params.map((param) => param.name),
    before.params.map((param) => param.name),
  );
  assert.deepEqual(ALLOWED_CHANGES, []);
});

test('every feature of 1.1.0 is still discovered with the same forever fields', () => {
  const [before] = baseline.devices;
  const now = new Map(currentDevice().features.map((feature) => [feature.external_id, feature]));
  for (const feature of before.features) {
    const current = now.get(feature.external_id);
    assert.ok(current, `feature ${feature.external_id} disappeared`);
    for (const field of FOREVER_FEATURE_FIELDS) {
      assert.deepEqual(current[field], feature[field], `${feature.external_id}.${field}`);
    }
  }
});

test('no feature id is published twice on one device', () => {
  const ids = currentDevice().features.map((feature) => feature.external_id);
  assert.equal(new Set(ids).size, ids.length);
});

test('the configuration and action keys of 1.1.0 are kept, with their types', () => {
  const current = new Map(manifest.config_schema.map((field) => [field.key, field]));
  for (const field of manifestBaseline.config_schema) {
    const now = current.get(field.key);
    assert.ok(now, `config_schema.${field.key} was removed`);
    assert.equal(now.type, field.type, `config_schema.${field.key}.type`);
    assert.equal(now.required ?? false, field.required, `config_schema.${field.key}.required`);
    assert.equal(now.default, field.default, `config_schema.${field.key}.default`);
  }
  const oldKeys = new Set(manifestBaseline.config_schema.map((field) => field.key));
  for (const field of manifest.config_schema.filter((entry) => !oldKeys.has(entry.key))) {
    // A new required field without a default would block every existing user.
    assert.ok(!field.required || field.default !== undefined, `new required ${field.key}`);
  }
  const actionKeys = manifest.actions.map((action) => action.key);
  for (const key of manifestBaseline.actions) {
    assert.ok(actionKeys.includes(key), `action ${key}`);
  }
});

test('the type, the transport and the mDNS capture of 1.1.0 are kept', () => {
  assert.equal(manifest.type, manifestBaseline.type);
  assert.deepEqual(manifest.transports, manifestBaseline.transports);
  assert.deepEqual(manifest.network_discovery, manifestBaseline.network_discovery);
});
