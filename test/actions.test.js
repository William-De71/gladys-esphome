import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeActionArguments, parseActionArguments } from '../src/esphome/actions.js';

// ServiceArgType of the native API: BOOL 0, INT 1, FLOAT 2, STRING 3, then the
// four array variants 4 to 7.
const ACTION = {
  name: 'notify',
  args: [
    { name: 'message', type: 3 },
    { name: 'times', type: 1 },
    { name: 'volume', type: 2 },
    { name: 'urgent', type: 0 },
  ],
};

test('arguments are written as a JSON object, or left empty', () => {
  assert.deepEqual(parseActionArguments(''), {});
  assert.deepEqual(parseActionArguments(undefined), {});
  assert.deepEqual(parseActionArguments('{"a": 1}'), { a: 1 });
  assert.throws(() => parseActionArguments('a=1'), /JSON object/);
  assert.throws(() => parseActionArguments('[1, 2]'), /JSON object/);
});

test('each argument gets the type the node declared, in the declared order', () => {
  assert.deepEqual(
    encodeActionArguments(ACTION, { urgent: 'true', volume: '0.5', times: '3', message: 'Hi' }),
    [{ stringValue: 'Hi' }, { intValue: 3 }, { floatValue: 0.5 }, { boolValue: true }],
  );
});

test('a scene variable substituted as text still reaches the node with its type', () => {
  assert.deepEqual(
    encodeActionArguments(
      {
        name: 'levels',
        args: [
          { name: 'values', type: 5 },
          { name: 'flags', type: 4 },
        ],
      },
      { values: '1, 2,3', flags: [true, 'off'] },
    ),
    [{ intArray: [1, 2, 3] }, { boolArray: [true, false] }],
  );
});

test('nothing is guessed: missing, unknown or mistyped arguments are refused', () => {
  assert.throws(
    () => encodeActionArguments(ACTION, { message: 'Hi', times: 1, volume: 1 }),
    /"urgent" of action "notify" is missing/,
  );
  assert.throws(
    () => encodeActionArguments(ACTION, { message: 'Hi', times: 1, volume: 1, urgent: true, x: 1 }),
    /no argument "x"/,
  );
  assert.throws(
    () => encodeActionArguments(ACTION, { message: 'Hi', times: 1.5, volume: 1, urgent: true }),
    /"times" must be a whole number/,
  );
  assert.throws(
    () => encodeActionArguments(ACTION, { message: 'Hi', times: '', volume: 1, urgent: true }),
    /"times" must be a number/,
  );
  assert.throws(
    () => encodeActionArguments(ACTION, { message: 'Hi', times: 1, volume: 1, urgent: 'maybe' }),
    /"urgent" must be true or false/,
  );
});

test('an action without variables takes no argument', () => {
  assert.deepEqual(encodeActionArguments({ name: 'beep', args: [] }, {}), []);
});
