// -----------------------------------------------------------------------------
// Value translation between ESPHome and Gladys, in both directions.
//
//   readState()  : an ESPHome state event -> the number Gladys stores
//   writeCommand(): a Gladys value        -> the ESPHome command payload
//
// The two are deliberately in one module: they are the same contract read from
// opposite ends, and a change to one that is not mirrored in the other is a
// bug (a light set to 50% that reads back 127 being the classic symptom).
//
// Scale conventions that motivate most of the code here:
//   - ESPHome brightness / cover position are floats in 0..1;
//     Gladys stores percentages in 0..100.
//   - ESPHome RGB is three floats in 0..1; Gladys stores one 0xRRGGBB integer.
//   - ESPHome booleans are real booleans; Gladys stores 0 / 1.
// -----------------------------------------------------------------------------

import { DEVICE_FEATURE_CATEGORIES } from '@gladysassistant/integration-sdk';

// Gladys shutter/curtain state values (server/utils/constants.js).
export const COVER_STATE = {
  CLOSING: -1,
  STOP: 0,
  OPENING: 1,
  OPEN: 2,
  CLOSED: 3,
};

// ESPHome CoverOperation enum (esphome/components/cover/cover.h).
const COVER_OPERATION = {
  IDLE: 0,
  IS_OPENING: 1,
  IS_CLOSING: 2,
};

// ESPHome LockState / LockCommand enums.
const LOCK_STATE_LOCKED = 1;
const LOCK_COMMAND = { UNLOCK: 0, LOCK: 1 };

/**
 * Clamp a number into a range. ESPHome floats occasionally overshoot by a
 * rounding epsilon (a 100% cover reporting 1.0000001), and Gladys rejects a
 * state outside the feature's declared min/max.
 * @param {number} value - The value to clamp.
 * @param {number} min - Lower bound.
 * @param {number} max - Upper bound.
 * @returns {number} The clamped value.
 * @example
 * clamp(101, 0, 100); // 100
 */
function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

/**
 * Convert an ESPHome 0..1 ratio into a Gladys 0..100 percentage.
 * @param {number} ratio - The ESPHome ratio.
 * @returns {number} The rounded percentage.
 * @example
 * ratioToPercent(0.5); // 50
 */
export function ratioToPercent(ratio) {
  return clamp(Math.round(Number(ratio) * 100), 0, 100);
}

/**
 * Convert a Gladys 0..100 percentage into an ESPHome 0..1 ratio.
 * @param {number} percent - The Gladys percentage.
 * @returns {number} The ratio.
 * @example
 * percentToRatio(50); // 0.5
 */
export function percentToRatio(percent) {
  return clamp(Number(percent) / 100, 0, 1);
}

/**
 * Pack three ESPHome 0..1 color components into the single 0xRRGGBB integer
 * Gladys stores.
 * @param {number} red - Red component (0..1).
 * @param {number} green - Green component (0..1).
 * @param {number} blue - Blue component (0..1).
 * @returns {number} The packed color.
 * @example
 * packColor(1, 0, 0); // 16711680
 */
export function packColor(red, green, blue) {
  const to255 = (component) => clamp(Math.round(Number(component || 0) * 255), 0, 255);
  return (to255(red) << 16) | (to255(green) << 8) | to255(blue);
}

/**
 * Unpack a Gladys 0xRRGGBB integer into ESPHome 0..1 components.
 * @param {number} color - The packed color.
 * @returns {{ red: number, green: number, blue: number }} The components.
 * @example
 * unpackColor(16711680); // { red: 1, green: 0, blue: 0 }
 */
export function unpackColor(color) {
  const value = clamp(Math.round(Number(color) || 0), 0, 0xffffff);
  return {
    red: ((value >> 16) & 0xff) / 255,
    green: ((value >> 8) & 0xff) / 255,
    blue: (value & 0xff) / 255,
  };
}

/**
 * Translate an ESPHome state event into the value Gladys stores for one
 * feature. Returns undefined when the event carries nothing for that feature —
 * a light event, for instance, feeds several features but never all at once.
 * @param {object} feature - The Gladys feature (its `key` drives the read).
 * @param {object} event - The ESPHome state event.
 * @returns {number|object|undefined} The Gladys state, or undefined to skip.
 * @example
 * readState({ key: 'brightness' }, { state: true, brightness: 0.5 }); // 50
 */
export function readState(feature, event) {
  switch (feature.key) {
    case 'state':
      return readMainState(feature, event);

    case 'brightness':
      return event.brightness === undefined ? undefined : ratioToPercent(event.brightness);

    case 'color':
      return event.red === undefined ? undefined : packColor(event.red, event.green, event.blue);

    case 'temperature':
      return event.colorTemperature === undefined ? undefined : Math.round(event.colorTemperature);

    case 'position':
      return event.position === undefined ? undefined : ratioToPercent(event.position);

    case 'speed':
      // ESPHome reports a discrete level; the feature is declared in percent,
      // so scale it against the count of levels the firmware advertises.
      if (event.speedLevel === undefined) {
        return undefined;
      }
      return ratioToPercent(Number(event.speedLevel) / (feature.speedCount || 100));

    case 'target_temperature':
      return event.targetTemperature === undefined ? undefined : Number(event.targetTemperature);

    case 'current_temperature':
      return event.currentTemperature === undefined ? undefined : Number(event.currentTemperature);

    case 'press':
      // A button has no state to read: ESPHome only notifies the press itself.
      return event.pressed ? 1 : undefined;

    default:
      return undefined;
  }
}

/**
 * Read the main state of an entity, whose meaning depends on the feature's
 * category (a cover state is not a boolean).
 * @param {object} feature - The Gladys feature.
 * @param {object} event - The ESPHome state event.
 * @returns {number|object|undefined} The Gladys state.
 */
function readMainState(feature, event) {
  // A sensor whose reading is unavailable (a disconnected probe) sets
  // `missingState`; publishing 0 there would fabricate a measurement.
  if (event.missingState) {
    return undefined;
  }

  if (feature.category === DEVICE_FEATURE_CATEGORIES.TEXT) {
    // Gladys stores text states through a dedicated `{ text }` shape.
    return event.state === undefined ? undefined : { text: String(event.state) };
  }

  if (
    feature.category === DEVICE_FEATURE_CATEGORIES.SHUTTER ||
    feature.category === DEVICE_FEATURE_CATEGORIES.CURTAIN
  ) {
    return readCoverState(event);
  }

  if (feature.category === DEVICE_FEATURE_CATEGORIES.LOCK) {
    if (event.state === undefined) {
      return undefined;
    }
    return Number(event.state) === LOCK_STATE_LOCKED ? 1 : 0;
  }

  if (event.state === undefined) {
    return undefined;
  }

  // Numeric sensors report a float; everything else reports a boolean.
  if (typeof event.state === 'boolean') {
    return event.state ? 1 : 0;
  }

  // A firmware reports "no reading" as a non-finite float, not through
  // `missingState`: an mmWave node publishes `nan` on the angle and distance of
  // every target slot it is not currently tracking. `Number()` propagates that
  // as NaN, JSON.stringify turns it into `null`, and the core then rejects the
  // whole batch with `must have a numeric "state"` — on repeat, since the node
  // keeps republishing it. It is the same "measurement that never happened" as
  // missingState above, so it gets the same answer: publish nothing.
  //
  // `null` and `''` are coerced to 0 by Number(), which would fabricate a
  // reading just as surely; they are rejected here rather than recorded.
  if (event.state === null || event.state === '') {
    return undefined;
  }
  const numeric = Number(event.state);
  return Number.isFinite(numeric) ? numeric : undefined;
}

/**
 * Translate an ESPHome cover state into the Gladys shutter state. ESPHome
 * reports the MOVEMENT (`currentOperation`) and the position separately, while
 * Gladys expects a single value covering both, so a resting cover is resolved
 * through its position.
 * @param {object} event - The ESPHome cover state event.
 * @returns {number|undefined} The Gladys shutter state.
 * @example
 * readCoverState({ currentOperation: 1 }); // 1 (opening)
 */
export function readCoverState(event) {
  if (event.currentOperation === COVER_OPERATION.IS_OPENING) {
    return COVER_STATE.OPENING;
  }
  if (event.currentOperation === COVER_OPERATION.IS_CLOSING) {
    return COVER_STATE.CLOSING;
  }
  if (event.position === undefined) {
    return undefined;
  }
  // Idle: the position tells whether it ended up open or closed. ESPHome's
  // convention is 1 = fully open, 0 = fully closed.
  const position = Number(event.position);
  if (position <= 0) {
    return COVER_STATE.CLOSED;
  }
  if (position >= 1) {
    return COVER_STATE.OPEN;
  }
  // Partially open and not moving: Gladys has no "half-open" state, and OPEN is
  // the truthful one — the cover does let light through.
  return COVER_STATE.OPEN;
}

/**
 * Build the ESPHome command payload applying a Gladys value to a feature.
 * @param {object} feature - The Gladys feature (its `key` drives the write).
 * @param {number|string} value - The value Gladys asks for (a string for a text feature).
 * @returns {object|null} The command payload, or null if not commandable.
 * @example
 * writeCommand({ key: 'brightness' }, 50); // { state: true, brightness: 0.5 }
 * @example
 * writeCommand({ key: 'state', category: 'text' }, 'Hello'); // { state: 'Hello' }
 */
export function writeCommand(feature, value) {
  // A text feature is the one case Gladys commands with a STRING, not a number
  // (see the SDK's onSetValue contract). Coercing it through Number() below
  // would turn "Poubelles demain" into NaN, so it is resolved before that.
  if (feature.category === DEVICE_FEATURE_CATEGORIES.TEXT && feature.key === 'state') {
    return { state: value === undefined || value === null ? '' : String(value) };
  }

  const numeric = Number(value);

  switch (feature.key) {
    case 'state':
      return writeMainState(feature, numeric);

    case 'brightness':
      // Setting a brightness on a light that is off must turn it on, otherwise
      // the slider moves and nothing happens.
      return { state: numeric > 0, brightness: percentToRatio(numeric) };

    case 'color': {
      const { red, green, blue } = unpackColor(numeric);
      return { state: true, red, green, blue };
    }

    case 'temperature':
      return { state: true, colorTemperature: numeric };

    case 'position':
      return { position: percentToRatio(numeric) };

    case 'speed':
      return {
        state: numeric > 0,
        speedLevel: Math.round((numeric / 100) * (feature.speedCount || 100)),
      };

    case 'target_temperature':
      return { targetTemperature: numeric };

    case 'press':
      // A button command carries no field: sending the message IS the press.
      return {};

    default:
      return null;
  }
}

/**
 * Build the command for the main state of an entity.
 * @param {object} feature - The Gladys feature.
 * @param {number} value - The Gladys value.
 * @returns {object|null} The ESPHome command payload.
 */
function writeMainState(feature, value) {
  if (
    feature.category === DEVICE_FEATURE_CATEGORIES.SHUTTER ||
    feature.category === DEVICE_FEATURE_CATEGORIES.CURTAIN
  ) {
    // ESPHome drives a cover by target position, with an explicit stop flag.
    switch (value) {
      case COVER_STATE.OPENING:
      case COVER_STATE.OPEN:
        return { position: 1 };
      case COVER_STATE.CLOSING:
      case COVER_STATE.CLOSED:
        return { position: 0 };
      case COVER_STATE.STOP:
        return { stop: true };
      default:
        return null;
    }
  }

  if (feature.category === DEVICE_FEATURE_CATEGORIES.LOCK) {
    return { command: value === 1 ? LOCK_COMMAND.LOCK : LOCK_COMMAND.UNLOCK };
  }

  if (feature.category === DEVICE_FEATURE_CATEGORIES.DURATION) {
    // A `number` entity (mapped to duration/decimal, the writable numeric pair
    // Gladys renders): the value is passed through, not turned into a boolean.
    return { state: value };
  }

  return { state: value === 1 };
}
