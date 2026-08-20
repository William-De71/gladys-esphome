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

test('a missing state publishes nothing instead of a fabricated zero', () => {
  // A disconnected probe sets `missingState`; publishing 0 would record a
  // measurement that never happened.
  const value = readState(
    { key: 'state', category: DEVICE_FEATURE_CATEGORIES.TEMPERATURE_SENSOR },
    { state: 0, missingState: true },
  );
  assert.equal(value, undefined);
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
