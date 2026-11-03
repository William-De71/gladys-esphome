import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeEntity } from '../src/esphome/mapping.js';
import { readState } from '../src/esphome/convert.js';
import { buildDevice, setDeviceValue, flushStates } from '../src/devices.js';
import { EsphomeManager } from '../src/esphome/EsphomeManager.js';
import { fakeGladys } from './helpers/fakeGladys.js';

// The Fujitsu Halcyon component (esphome-fujitsu-halcyon), as its traits
// declare it: its "Auto" is HEAT_COOL, one setpoint, five fan modes and both
// swing axes.
const HALCYON = {
  key: 7,
  type: 'climate',
  objectId: 'clim',
  id: 'climate-clim',
  name: 'Clim',
  supportsCurrentTemperature: true,
  visualMinTemperature: 16,
  visualMaxTemperature: 30,
  supportedModes: [0, 1, 3, 4, 5, 2],
  supportedFanModes: [9, 3, 4, 5, 2],
  supportedSwingModes: [0, 3, 2, 1],
};

const byKey = (entity) => new Map(describeEntity(entity).map((f) => [f.key, f]));
const read = (key, event) =>
  readState({ key, entityType: 'climate' }, { type: 'climate', ...event });

test('an air conditioner gets power, mode, fan and swing next to its 1.1.0 features', () => {
  const features = byKey(HALCYON);
  assert.deepEqual(
    [...features.keys()],
    [
      'target_temperature',
      'current_temperature',
      'power',
      'mode',
      'fan_mode',
      'swing_vertical',
      'swing_horizontal',
    ],
  );
  // The setpoint keeps its thermostat pair: devices created before keep it.
  assert.equal(features.get('target_temperature').category, 'thermostat');
  assert.equal(features.get('power').category, 'air-conditioning');
  assert.equal(features.get('power').type, 'binary');
  assert.equal(features.get('mode').type, 'mode');
  assert.equal(features.get('fan_mode').type, 'fan-speed');
  assert.equal(features.get('swing_vertical').type, 'swing-vertical');
  assert.equal(features.get('swing_horizontal').type, 'swing-horizontal');
});

test('the mode and fan choices are narrowed to what the unit supports', () => {
  const features = byKey(HALCYON);
  // The ranges cover the whole Gladys enums, whatever the unit.
  assert.deepEqual([features.get('mode').min, features.get('mode').max], [0, 4]);
  assert.deepEqual([features.get('fan_mode').min, features.get('fan_mode').max], [0, 7]);
  const values = (key) => features.get(key).supportedOptions.map((option) => option.value);
  assert.deepEqual(values('mode'), [0, 1, 2, 3, 4]);
  // Auto, quiet, low, medium, high: no low-mid, mid-high nor turbo.
  assert.deepEqual(values('fan_mode'), [0, 6, 1, 3, 5]);

  const coolOnly = byKey({ ...HALCYON, supportedModes: [0, 2, 4], supportedFanModes: [] });
  assert.deepEqual(
    coolOnly.get('mode').supportedOptions.map((option) => option.value),
    [1, 4],
  );
  assert.equal(coolOnly.has('fan_mode'), false);
});

test('the supported options reach the published feature', () => {
  const gladys = fakeGladys({ selector: 'ext-esphome' });
  const device = buildDevice(gladys, { name: 'salon', host: '192.168.1.42' }, [HALCYON]);
  const mode = device.features.find((f) => f.external_id.endsWith(':climate-clim:mode'));
  assert.equal(mode.name, 'Clim - mode');
  assert.deepEqual(mode.supported_options[1], { value: 1, label: 'Cool', sort_order: 1 });
  const power = device.features.find((f) => f.external_id.endsWith(':climate-clim:power'));
  assert.equal(power.supported_options, undefined);
});

test('a climate without modes, or one that cannot be turned off, keeps its 1.1.0 features', () => {
  assert.deepEqual(
    [...byKey({ type: 'climate', supportsCurrentTemperature: true }).keys()],
    ['target_temperature', 'current_temperature'],
  );
  // Heat only, never off: neither a power nor a single-choice mode.
  assert.deepEqual(
    [...byKey({ type: 'climate', supportedModes: [3] }).keys()],
    ['target_temperature'],
  );
  // A heating thermostat that turns off: a power, no mode to choose.
  assert.deepEqual(
    [...byKey({ type: 'climate', supportedModes: [0, 3] }).keys()],
    ['target_temperature', 'power'],
  );
});

test('the climate state is read into each air-conditioning feature', () => {
  // OFF: protobuf leaves `mode` out, the wire defaults put it back.
  assert.equal(read('power', {}), 0);
  assert.equal(read('mode', {}), undefined);
  assert.equal(read('power', { mode: 2 }), 1);
  assert.equal(read('mode', { mode: 2 }), 1);
  assert.equal(read('mode', { mode: 1 }), 0);
  assert.equal(read('mode', { mode: 6 }), 0);
  assert.equal(read('mode', { mode: 5 }), 3);
  assert.equal(read('fan_mode', { fanMode: 9 }), 6);
  assert.equal(read('fan_mode', { fanMode: 4 }), 3);
  // FOCUS has no Gladys speed, nor has a custom fan mode.
  assert.equal(read('fan_mode', { fanMode: 7 }), undefined);
  assert.equal(read('fan_mode', { fanMode: 2, customFanMode: 'Turbo' }), undefined);
  assert.equal(read('swing_vertical', {}), 0);
  assert.equal(read('swing_vertical', { swingMode: 1 }), 1);
  assert.equal(read('swing_horizontal', { swingMode: 1 }), 1);
  assert.equal(read('swing_vertical', { swingMode: 3 }), 0);
  assert.equal(read('swing_horizontal', { swingMode: 3 }), 1);
  // The 1.1.0 readings are untouched.
  assert.equal(read('target_temperature', { targetTemperature: 21.5 }), 21.5);
});

/**
 * A manager holding the Halcyon node, its commands recorded.
 * @param {object} [state] - The last climate state the node reported.
 * @returns {EsphomeManager} The manager.
 */
function managerWith(state) {
  const manager = new EsphomeManager();
  manager.sent = [];
  manager.getClient = () => ({});
  manager.listEntities = () => [HALCYON];
  manager.command = (node, type, objectId, command) =>
    manager.sent.push({ type, objectId, command });
  if (state) {
    manager.remember('salon', HALCYON, { key: 7, type: 'climate', ...state });
  }
  return manager;
}

const gladys = fakeGladys({ selector: 'ext-esphome' });
const feature = (key) => ({
  external_id: `ext:ext-esphome:esphome:salon:climate-clim:${key}`,
  category: 'air-conditioning',
});
const set = (manager, key, value) => setDeviceValue(gladys, manager, {}, feature(key), value);

test('power off sends OFF, power on resumes the last mode the unit ran in', async () => {
  const manager = managerWith({ mode: 3 });
  await set(manager, 'power', 0);
  manager.remember('salon', HALCYON, { key: 7, type: 'climate' });
  await set(manager, 'power', 1);
  assert.deepEqual(
    manager.sent.map((sent) => sent.command),
    [{ mode: 0 }, { mode: 3 }],
  );
  assert.equal(manager.sent[0].type, 'climate');
  assert.equal(manager.sent[0].objectId, 'clim');
});

test('the resume mode survives a reconnection, and defaults to the unit auto', async () => {
  const manager = managerWith({ mode: 2 });
  await manager.disconnect('salon');
  await set(manager, 'power', 1);
  assert.deepEqual(manager.sent.pop().command, { mode: 2 });

  // Never seen on: its "auto", HEAT_COOL on this unit.
  const fresh = managerWith({});
  await set(fresh, 'power', 1);
  assert.deepEqual(fresh.sent.pop().command, { mode: 1 });
});

test('choosing a mode drives a running unit, and only presets one that is off', async () => {
  const running = managerWith({ mode: 3 });
  await set(running, 'mode', 1);
  assert.deepEqual(running.sent.pop().command, { mode: 2 });

  const off = managerWith({});
  gladys.published.states.length = 0;
  await set(off, 'mode', 3);
  assert.equal(off.sent.length, 0);
  await flushStates(gladys);
  assert.deepEqual(gladys.published.states, [
    { device_feature_external_id: feature('mode').external_id, state: 3 },
  ]);
  await set(off, 'power', 1);
  assert.deepEqual(off.sent.pop().command, { mode: 5 });
});

test('fan speeds map to the ESPHome fan modes, unsupported ones are refused', async () => {
  const manager = managerWith({ mode: 2 });
  await set(manager, 'fan_mode', 6);
  assert.deepEqual(manager.sent.pop().command, { fanMode: 9 });
  await assert.rejects(set(manager, 'fan_mode', 7), /not supported/);
  await assert.rejects(set(manager, 'mode', 9), /not supported/);
});

test('one swing axis is changed without touching the other', async () => {
  const manager = managerWith({ mode: 2, swingMode: 3 });
  await set(manager, 'swing_vertical', 1);
  assert.deepEqual(manager.sent.pop().command, { swingMode: 1 });

  const both = managerWith({ mode: 2, swingMode: 1 });
  await set(both, 'swing_horizontal', 0);
  assert.deepEqual(both.sent.pop().command, { swingMode: 2 });

  // Without BOTH, the axis just asked for wins.
  const single = managerWith({ mode: 2, swingMode: 3 });
  single.listEntities = () => [{ ...HALCYON, supportedSwingModes: [0, 2, 3] }];
  await set(single, 'swing_vertical', 1);
  assert.deepEqual(single.sent.pop().command, { swingMode: 2 });
});
