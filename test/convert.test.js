import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEVICE_FEATURE_CATEGORIES } from '@gladysassistant/integration-sdk';
import {
  readState,
  writeCommand,
  readCoverState,
  packColor,
  unpackColor,
  ratioToPercent,
  percentToRatio,
  withWireDefaults,
  COVER_STATE,
  OPENING_SENSOR_STATE,
  GLADYS_LOCK_STATE,
} from '../src/esphome/convert.js';
import { describeEntity } from '../src/esphome/mapping.js';

test('a boolean state becomes the 0/1 Gladys stores', () => {
  assert.equal(
    readState({ key: 'state', category: DEVICE_FEATURE_CATEGORIES.SWITCH }, { state: true }),
    1,
  );
  assert.equal(
    readState({ key: 'state', category: DEVICE_FEATURE_CATEGORIES.SWITCH }, { state: false }),
    0,
  );
});

test('a binary_sensor reporting OFF omits `state` on the wire, and reads as 0', () => {
  // protobuf 3 does not serialize a field holding its type's default value, so
  // a binary_sensor turning OFF sends NO `state` field and the client omits it
  // from the event. Reading that as "nothing to publish" left a motion sensor
  // stuck on "detected": only the ON transitions ever reached Gladys.
  const feature = { key: 'state', category: DEVICE_FEATURE_CATEGORIES.MOTION_SENSOR };
  assert.equal(readState(feature, { type: 'binary_sensor', key: 12 }), 0);
  assert.equal(readState(feature, { type: 'binary_sensor', key: 12, state: false }), 0);
  assert.equal(readState(feature, { type: 'binary_sensor', key: 12, state: true }), 1);
});

test('an explicit missingState still wins over the binary_sensor default', () => {
  // `missingState` is the firmware's deliberate "no reading" signal; an absent
  // `state` is merely protobuf omitting a false. The first must not be read as
  // the second.
  const value = readState(
    { key: 'state', category: DEVICE_FEATURE_CATEGORIES.MOTION_SENSOR },
    { type: 'binary_sensor', key: 12, missingState: true },
  );
  assert.equal(value, undefined);
});

test('protobuf leaves out every field holding its default, for every entity type', () => {
  // A state response is a full snapshot, so an absent field is false / 0, never
  // "unknown". Reading it as "nothing to publish" is what kept a switch turned
  // off showing ON, a plug drawing 0 W showing its last wattage, and a closed
  // cover stuck on "closing".
  const sw = { key: 'state', category: DEVICE_FEATURE_CATEGORIES.SWITCH };
  assert.equal(readState(sw, { type: 'switch', key: 3 }), 0);
  assert.equal(readState(sw, { type: 'light', key: 4 }), 0);
  assert.equal(readState(sw, { type: 'fan', key: 5 }), 0);

  const power = { key: 'state', category: DEVICE_FEATURE_CATEGORIES.ENERGY_SENSOR };
  assert.equal(readState(power, { type: 'sensor', key: 7 }), 0);

  const cover = { key: 'state', category: DEVICE_FEATURE_CATEGORIES.SHUTTER };
  assert.equal(readState(cover, { type: 'cover', key: 8 }), COVER_STATE.CLOSE);
  assert.equal(readState({ key: 'position' }, { type: 'cover', key: 8 }), 0);

  // A pure blue light: red = 0 travels as an absent field.
  assert.equal(readState({ key: 'color' }, { type: 'light', key: 4, blue: 1 }), 0x0000ff);
});

test('withWireDefaults leaves an event of unknown type untouched', () => {
  const event = { type: 'not-an-esphome-type', key: 1 };
  assert.equal(withWireDefaults(event), event);
  assert.deepEqual(withWireDefaults({ type: 'switch', key: 1, state: true }), {
    type: 'switch',
    key: 1,
    state: true,
  });
});

test('only the two resting lock states have a Gladys value', () => {
  // LOCKING, JAMMED… are neither locked nor unlocked; reading them as 0 would
  // tell a scene the door is open while the bolt is moving, or stuck.
  const lock = { key: 'state', category: DEVICE_FEATURE_CATEGORIES.LOCK };
  assert.equal(readState(lock, { type: 'lock', state: 1 }), 1);
  assert.equal(readState(lock, { type: 'lock', state: 2 }), 0);
  assert.equal(readState(lock, { type: 'lock', state: 3 }), undefined);
  assert.equal(readState(lock, { type: 'lock', state: 4 }), undefined);
  assert.equal(readState(lock, { type: 'lock' }), undefined);
});

test('a valve reads open from its position and is driven by target position', () => {
  const valve = { key: 'state', category: DEVICE_FEATURE_CATEGORIES.SWITCH, entityType: 'valve' };
  assert.equal(readState(valve, { type: 'valve', position: 0.4 }), 1);
  assert.equal(readState(valve, { type: 'valve' }), 0);
  assert.deepEqual(writeCommand(valve, 1), { position: 1 });
  assert.deepEqual(writeCommand(valve, 0), { position: 0 });
});

test('a missing state publishes nothing instead of a fabricated zero', () => {
  // A disconnected probe sets `missingState`; publishing 0 would record a
  // measurement that never happened.
  const value = readState(
    { key: 'state', category: DEVICE_FEATURE_CATEGORIES.TEMPERATURE_SENSOR },
    { state: 0, missingState: true },
  );
  assert.equal(value, undefined);
});

test('a non-finite reading publishes nothing instead of a rejected NaN', () => {
  // An mmWave node reports `nan` on the angle/distance of every target slot it
  // is not tracking. Number() propagates that as NaN, JSON.stringify turns it
  // into `null`, and the core rejects the batch with `must have a numeric
  // "state"` — repeatedly, since the node keeps pushing it.
  const feature = { key: 'state', category: DEVICE_FEATURE_CATEGORIES.UNKNOWN };
  assert.equal(readState(feature, { state: NaN }), undefined);
  assert.equal(readState(feature, { state: 'nan' }), undefined);
  assert.equal(readState(feature, { state: Infinity }), undefined);
  assert.equal(readState(feature, { state: -Infinity }), undefined);
});

test('null and an empty reading do not become a fabricated zero', () => {
  // Number(null) and Number('') are both 0, which would record a measurement
  // that never happened.
  const feature = { key: 'state', category: DEVICE_FEATURE_CATEGORIES.UNKNOWN };
  assert.equal(readState(feature, { state: null }), undefined);
  assert.equal(readState(feature, { state: '' }), undefined);
});

test('a real reading still gets through, zero included', () => {
  // The guard above must not swallow legitimate values: 0 is a measurement.
  const feature = { key: 'state', category: DEVICE_FEATURE_CATEGORIES.UNKNOWN };
  assert.equal(readState(feature, { state: -11.809355735778809 }), -11.809355735778809);
  assert.equal(readState(feature, { state: 0 }), 0);
  assert.equal(readState(feature, { state: '42.5' }), 42.5);
});

test('a text state uses the dedicated Gladys text shape', () => {
  const value = readState(
    { key: 'state', category: DEVICE_FEATURE_CATEGORIES.TEXT },
    { state: 'idle' },
  );
  assert.deepEqual(value, { text: 'idle' });
});

test('a select reads and writes the option string itself', () => {
  // ESPHome SelectStateResponse.state / SelectCommandRequest.state: the option
  // string. Gladys: `{ text }` as the state, the option value as the command.
  const [feature] = describeEntity({ type: 'select', options: ['Low', 'High'] });
  assert.deepEqual(readState(feature, { type: 'select', key: 9, state: 'High' }), { text: 'High' });
  // No option chosen yet travels as '' (protobuf default): nothing to show.
  assert.equal(readState(feature, { type: 'select', key: 9 }), undefined);
  assert.equal(readState(feature, { type: 'select', key: 9, missingState: true }), undefined);
  assert.deepEqual(writeCommand(feature, 'Low'), { state: 'Low' });
});

test('the ESPHome 0..1 scale becomes the Gladys 0..100 one, and back', () => {
  assert.equal(ratioToPercent(0.5), 50);
  assert.equal(percentToRatio(50), 0.5);
  // ESPHome floats overshoot by a rounding epsilon; Gladys rejects an
  // out-of-bounds state, so clamping is not cosmetic.
  assert.equal(ratioToPercent(1.0000001), 100);
  assert.equal(percentToRatio(120), 1);
});

test('a color survives the round trip through the packed Gladys integer', () => {
  const packed = packColor(0.2, 0.6, 0.9);
  const components = unpackColor(packed);
  assert.equal(packColor(components.red, components.green, components.blue), packed);
});

test('a cover only publishes the three states Gladys knows: -1 close, 0 stop, 1 open', () => {
  // Gladys (server/utils/constants.js): COVER_STATE = { STOP: 0, OPEN: 1, CLOSE: -1 }.
  // The shutter buttons, their labels and the scene conditions know nothing
  // else: the 2 (open) and 3 (closed) published before left no button lit once
  // the cover stopped, and a "cover is open" condition never matched.
  assert.deepEqual(COVER_STATE, { STOP: 0, OPEN: 1, CLOSE: -1 });

  // ESPHome CoverOperation: 1 IS_OPENING, 2 IS_CLOSING -> the direction.
  assert.equal(readCoverState({ currentOperation: 1 }), 1);
  assert.equal(readCoverState({ currentOperation: 2 }), -1);
  // ESPHome position at rest: 1 fully open, 0 fully closed, in between stopped.
  assert.equal(readCoverState({ currentOperation: 0, position: 1 }), 1);
  assert.equal(readCoverState({ currentOperation: 0, position: 0 }), -1);
  assert.equal(readCoverState({ currentOperation: 0, position: 0.4 }), 0);
  // Every value fits the -1..3 bounds the feature has declared since 1.0.
  const [feature] = describeEntity({ type: 'cover' });
  for (const value of [-1, 0, 1]) {
    assert.ok(value >= feature.min && value <= feature.max);
  }
});

test('a resting cover with no position field is closed: 0 is the absent value', () => {
  assert.equal(readCoverState({ type: 'cover', currentOperation: 0 }), COVER_STATE.CLOSE);
});

test('a door or window sensor: ESPHome ON (open) is Gladys 0 (open)', () => {
  // ESPHome and Home Assistant (door, window, opening, garage_door): ON = open.
  // Gladys (server/utils/constants.js): OPENING_SENSOR_STATE = { OPEN: 0, CLOSE: 1 }.
  // Publishing the boolean as is showed an open window as closed, counted the
  // "open windows" chip the other way round and ran "on open" scenes on close.
  assert.deepEqual(OPENING_SENSOR_STATE, { OPEN: 0, CLOSE: 1 });
  for (const deviceClass of ['door', 'window', 'opening', 'garage_door']) {
    const [feature] = describeEntity({ type: 'binary_sensor', deviceClass });
    assert.equal(feature.category, DEVICE_FEATURE_CATEGORIES.OPENING_SENSOR);
    const open = { type: 'binary_sensor', key: 1, state: true };
    const closed = { type: 'binary_sensor', key: 1, state: false };
    assert.equal(readState(feature, open), OPENING_SENSOR_STATE.OPEN, deviceClass);
    assert.equal(readState(feature, closed), OPENING_SENSOR_STATE.CLOSE, deviceClass);
    // Closed travels as an absent field (protobuf default), still closed.
    assert.equal(readState(feature, { type: 'binary_sensor', key: 1 }), 1, deviceClass);
    assert.equal(readState(feature, { ...open, missingState: true }), undefined, deviceClass);
  }
});

test('a lock binary_sensor: ESPHome ON (unlocked) is Gladys 0 (unlocked)', () => {
  // ESPHome and Home Assistant (binary_sensor, device_class lock): ON = unlocked.
  // Gladys (server/utils/constants.js): LOCK.STATE = { UNLOCKED: 0, LOCKED: 1 }.
  // Read as the LockState enum of a `lock` entity, ON showed "locked" and OFF
  // (locked) was never published at all.
  assert.deepEqual(GLADYS_LOCK_STATE, { UNLOCKED: 0, LOCKED: 1 });
  const [feature] = describeEntity({ type: 'binary_sensor', deviceClass: 'lock' });
  assert.equal(feature.category, DEVICE_FEATURE_CATEGORIES.LOCK);
  const unlocked = { type: 'binary_sensor', key: 2, state: true };
  assert.equal(readState(feature, unlocked), GLADYS_LOCK_STATE.UNLOCKED);
  assert.equal(readState(feature, { ...unlocked, state: false }), GLADYS_LOCK_STATE.LOCKED);
  assert.equal(readState(feature, { type: 'binary_sensor', key: 2 }), GLADYS_LOCK_STATE.LOCKED);
});

test('a lock entity keeps reading the ESPHome LockState enum', () => {
  // ESPHome LockState: 1 LOCKED, 2 UNLOCKED (not a boolean): the binary_sensor
  // inversion above must not reach it.
  const [feature] = describeEntity({ type: 'lock' });
  assert.equal(readState(feature, { type: 'lock', state: 1 }), GLADYS_LOCK_STATE.LOCKED);
  assert.equal(readState(feature, { type: 'lock', state: 2 }), GLADYS_LOCK_STATE.UNLOCKED);
});

test('setting a brightness turns the light on, so the slider does something', () => {
  assert.deepEqual(writeCommand({ key: 'brightness' }, 50), { state: true, brightness: 0.5 });
  assert.deepEqual(writeCommand({ key: 'brightness' }, 0), { state: false, brightness: 0 });
});

test('a cover command becomes the target position ESPHome expects', () => {
  const cover = { key: 'state', category: DEVICE_FEATURE_CATEGORIES.SHUTTER };
  // Gladys 1 open, -1 close, 0 stop -> ESPHome target position 1 / 0, or stop.
  assert.deepEqual(writeCommand(cover, COVER_STATE.OPEN), { position: 1 });
  assert.deepEqual(writeCommand(cover, COVER_STATE.CLOSE), { position: 0 });
  assert.deepEqual(writeCommand(cover, COVER_STATE.STOP), { stop: true });
  assert.equal(writeCommand(cover, 3), null);
});

test('a lock command uses the ESPHome LockCommand enum, not a boolean', () => {
  const lock = { key: 'state', category: DEVICE_FEATURE_CATEGORIES.LOCK };
  assert.deepEqual(writeCommand(lock, 1), { command: 1 });
  assert.deepEqual(writeCommand(lock, 0), { command: 0 });
});

test('a number entity passes its value through instead of becoming a boolean', () => {
  const number = { key: 'state', category: DEVICE_FEATURE_CATEGORIES.DURATION };
  assert.deepEqual(writeCommand(number, 22.5), { state: 22.5 });
});

test('a button command is an empty payload: sending it IS the press', () => {
  assert.deepEqual(writeCommand({ key: 'press' }, 1), {});
});

test('a fan speed is scaled against the levels the firmware declares', () => {
  // ESPHome counts discrete levels; the Gladys feature is a percentage.
  assert.equal(readState({ key: 'speed', speedCount: 5 }, { speedLevel: 3 }), 60);
  assert.deepEqual(writeCommand({ key: 'speed', speedCount: 5 }, 60), {
    state: true,
    speedLevel: 3,
  });
});

test('a low fan speed never rounds down to the level 0 ESPHome rejects', () => {
  assert.deepEqual(writeCommand({ key: 'speed', speedCount: 3 }, 10), {
    state: true,
    speedLevel: 1,
  });
  assert.deepEqual(writeCommand({ key: 'speed', speedCount: 3 }, 0), { state: false });
});

test('a feature with no write mapping is reported, not silently ignored', () => {
  assert.equal(writeCommand({ key: 'current_temperature' }, 20), null);
});

test('a text command is sent as a string, not coerced to a number', () => {
  // The SDK hands a STRING for a text feature. Passing it through Number()
  // would send NaN to the node, so the text branch runs before that coercion —
  // this is the case that makes an ESPHome `display:` lambda show a message.
  const text = { key: 'state', category: DEVICE_FEATURE_CATEGORIES.TEXT };
  assert.deepEqual(writeCommand(text, 'Poubelles jaunes demain'), {
    state: 'Poubelles jaunes demain',
  });
  // A digits-only message stays a string: ESPHome expects a string field here.
  assert.deepEqual(writeCommand(text, '42'), { state: '42' });
  // Clearing the screen is a legitimate command, not a missing value.
  assert.deepEqual(writeCommand(text, ''), { state: '' });
  assert.deepEqual(writeCommand(text, null), { state: '' });
});

test('a text feature round-trips: what is written reads back identically', () => {
  const text = { key: 'state', category: DEVICE_FEATURE_CATEGORIES.TEXT };
  const message = 'Bonjour';
  const command = writeCommand(text, message);
  // The node echoes its new state back on the same `state` field.
  assert.deepEqual(readState(text, { state: command.state }), { text: message });
});
