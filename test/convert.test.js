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
  COVER_STATE,
} from '../src/esphome/convert.js';

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

test('a numeric sensor with no state keeps publishing nothing', () => {
  // The absent-field default is specific to binary_sensor, whose state is a
  // required bool. An absent float really is a missing measurement.
  const value = readState(
    { key: 'state', category: DEVICE_FEATURE_CATEGORIES.TEMPERATURE_SENSOR },
    { type: 'sensor', key: 7 },
  );
  assert.equal(value, undefined);
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

test('a moving cover reports its direction, a resting one its position', () => {
  assert.equal(readCoverState({ currentOperation: 1 }), COVER_STATE.OPENING);
  assert.equal(readCoverState({ currentOperation: 2 }), COVER_STATE.CLOSING);
  assert.equal(readCoverState({ currentOperation: 0, position: 0 }), COVER_STATE.CLOSED);
  assert.equal(readCoverState({ currentOperation: 0, position: 1 }), COVER_STATE.OPEN);
});

test('a cover with no position at all publishes nothing', () => {
  assert.equal(readCoverState({ currentOperation: 0 }), undefined);
});

test('setting a brightness turns the light on, so the slider does something', () => {
  assert.deepEqual(writeCommand({ key: 'brightness' }, 50), { state: true, brightness: 0.5 });
  assert.deepEqual(writeCommand({ key: 'brightness' }, 0), { state: false, brightness: 0 });
});

test('a cover command becomes the target position ESPHome expects', () => {
  const cover = { key: 'state', category: DEVICE_FEATURE_CATEGORIES.SHUTTER };
  assert.deepEqual(writeCommand(cover, COVER_STATE.OPENING), { position: 1 });
  assert.deepEqual(writeCommand(cover, COVER_STATE.CLOSED), { position: 0 });
  assert.deepEqual(writeCommand(cover, COVER_STATE.STOP), { stop: true });
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
