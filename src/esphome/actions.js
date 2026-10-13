// -----------------------------------------------------------------------------
// User-defined ESPHome actions (`api: actions:` in the YAML, called "services"
// on the wire).
//
// A node declares each action with typed arguments; the native API only takes
// a value of the declared type for each one, in the declared order. A Gladys
// scene, on the other hand, writes its arguments as text: a JSON object whose
// keys are the argument names. This module bridges the two, refusing anything
// it would have to guess (a missing argument, a word where a number is due) so
// the scene reports the mistake instead of the node running with a wrong value.
//
// Pure module: no client, no SDK instance, no I/O.
// -----------------------------------------------------------------------------

import { ServiceArgType } from 'esphome-client';

/**
 * Parse the arguments a scene wrote for an action.
 * @param {unknown} raw - A JSON object as text, an object, or empty.
 * @returns {Record<string, unknown>} The arguments by name.
 * @example
 * parseActionArguments('{"message": "Hello"}'); // { message: 'Hello' }
 */
export function parseActionArguments(raw) {
  if (raw === undefined || raw === null || raw === '') {
    return {};
  }
  if (typeof raw === 'object' && !Array.isArray(raw)) {
    return raw;
  }
  let parsed;
  try {
    parsed = JSON.parse(String(raw));
  } catch {
    throw new Error('the arguments must be a JSON object, e.g. {"message": "Hello"}');
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('the arguments must be a JSON object, e.g. {"message": "Hello"}');
  }
  return parsed;
}

/**
 * Read a boolean the way a scene author writes one.
 * @param {unknown} value - The value.
 * @param {string} name - The argument name, for the error.
 * @returns {boolean} The boolean.
 */
function toBool(value, name) {
  if (typeof value === 'boolean') {
    return value;
  }
  const text = String(value).trim().toLowerCase();
  if (['true', '1', 'on', 'yes'].includes(text)) {
    return true;
  }
  if (['false', '0', 'off', 'no'].includes(text)) {
    return false;
  }
  throw new Error(`argument "${name}" must be true or false`);
}

/**
 * Read a number, refusing what is not one (an empty string would otherwise
 * become 0 and run the action with a value nobody wrote).
 * @param {unknown} value - The value.
 * @param {string} name - The argument name, for the error.
 * @param {boolean} integer - Whether the node declared an integer.
 * @returns {number} The number.
 */
function toNumber(value, name, integer) {
  const number = typeof value === 'number' ? value : Number(String(value).trim());
  if (String(value).trim() === '' || !Number.isFinite(number)) {
    throw new Error(`argument "${name}" must be a number`);
  }
  if (integer && !Number.isInteger(number)) {
    throw new Error(`argument "${name}" must be a whole number`);
  }
  return number;
}

/**
 * Read a list: a JSON array, or a comma-separated text (what a scene variable
 * substituted inside a string produces).
 * @param {unknown} value - The value.
 * @param {string} name - The argument name, for the error.
 * @returns {unknown[]} The items.
 */
function toList(value, name) {
  if (Array.isArray(value)) {
    return value;
  }
  if (typeof value === 'string') {
    return value.trim() === '' ? [] : value.split(',').map((item) => item.trim());
  }
  throw new Error(`argument "${name}" must be a list`);
}

/**
 * Convert the arguments of a scene into the typed values the node expects, in
 * the order it declared them.
 * @param {{ name: string, args: Array<{ name: string, type: number }> }} action - The action the node declared.
 * @param {Record<string, unknown>} values - The arguments by name.
 * @returns {object[]} One `ExecuteServiceArgumentValue` per declared argument.
 * @example
 * encodeActionArguments({ name: 'say', args: [{ name: 'text', type: 3 }] }, { text: 'Hi' });
 */
export function encodeActionArguments(action, values) {
  const declared = action.args || [];
  const known = new Set(declared.map((arg) => arg.name));
  const unknown = Object.keys(values).filter((name) => !known.has(name));
  if (unknown.length > 0) {
    throw new Error(
      `action "${action.name}" has no argument ${unknown.map((n) => `"${n}"`).join(', ')}` +
        ` (declared: ${declared.map((arg) => arg.name).join(', ') || 'none'})`,
    );
  }

  return declared.map(({ name, type }) => {
    if (!(name in values)) {
      throw new Error(`argument "${name}" of action "${action.name}" is missing`);
    }
    const value = values[name];
    switch (type) {
      case ServiceArgType.BOOL:
        return { boolValue: toBool(value, name) };
      case ServiceArgType.INT:
        return { intValue: toNumber(value, name, true) };
      case ServiceArgType.FLOAT:
        return { floatValue: toNumber(value, name, false) };
      case ServiceArgType.STRING:
        return { stringValue: typeof value === 'string' ? value : JSON.stringify(value) };
      case ServiceArgType.BOOL_ARRAY:
        return { boolArray: toList(value, name).map((item) => toBool(item, name)) };
      case ServiceArgType.INT_ARRAY:
        return { intArray: toList(value, name).map((item) => toNumber(item, name, true)) };
      case ServiceArgType.FLOAT_ARRAY:
        return { floatArray: toList(value, name).map((item) => toNumber(item, name, false)) };
      case ServiceArgType.STRING_ARRAY:
        return { stringArray: toList(value, name).map(String) };
      default:
        throw new Error(`argument "${name}" has a type this integration does not know (${type})`);
    }
  });
}
