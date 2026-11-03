// -----------------------------------------------------------------------------
// ESPHome `climate` <-> Gladys air conditioning.
//
// An ESPHome climate carries its on/off, its mode, its fan mode and its swing
// in ONE state message, where Gladys has one feature per dimension of the
// air-conditioning category:
//
//   power            air-conditioning/binary            mode !== OFF
//   mode             air-conditioning/mode              AC_MODE
//   fan_mode         air-conditioning/fan-speed         AC_FAN_SPEED
//   swing_vertical   air-conditioning/swing-vertical    OFF / SWING
//   swing_horizontal air-conditioning/swing-horizontal  OFF / SWING
//
// Two shapes do not line up and drive most of this module:
//
//   - ESPHome has no "on": a climate is on when its mode is not OFF. Turning
//     it on means sending a mode, so the last mode the node reported while on
//     is kept (`resumeMode`) and sent back. Choosing a mode while the unit is
//     off only changes that resume mode: the mode selector never powers the
//     unit on by itself, the power feature does.
//   - ESPHome has ONE swing field (OFF, VERTICAL, HORIZONTAL, BOTH) where
//     Gladys has one feature per axis, so a write on one axis combines with
//     what the other axis currently does.
//
// The values sent are the protocol numbers, which the client passes through
// untouched (it only maps string aliases).
// -----------------------------------------------------------------------------

// ESPHome enums (api.proto ClimateMode, ClimateFanMode, ClimateSwingMode).
export const CLIMATE_MODE = {
  OFF: 0,
  HEAT_COOL: 1,
  COOL: 2,
  HEAT: 3,
  FAN_ONLY: 4,
  DRY: 5,
  AUTO: 6,
};
const FAN_MODE = { AUTO: 2, LOW: 3, MEDIUM: 4, HIGH: 5, MIDDLE: 6, QUIET: 9 };
const SWING_MODE = { OFF: 0, BOTH: 1, VERTICAL: 2, HORIZONTAL: 3 };

// Gladys enums (server/utils/constants.js AC_MODE, AC_FAN_SPEED, AC_SWING_*).
export const AC_MODE = { AUTO: 0, COOLING: 1, HEATING: 2, DRYING: 3, FAN: 4 };
export const AC_FAN_SPEED = {
  AUTO: 0,
  LOW: 1,
  LOW_MID: 2,
  MID: 3,
  MID_HIGH: 4,
  HIGH: 5,
  QUIET: 6,
  TURBO: 7,
};
export const AC_SWING = { OFF: 0, SWING: 1 };

// Gladys mode -> the ESPHome modes that mean it, in order of preference. Gladys
// has a single "auto", ESPHome two: HEAT_COOL (heat or cool to reach the
// setpoint, what an AC remote calls "auto" — the Fujitsu Halcyon component maps
// its Auto there) and AUTO (the unit or a schedule decides). Both read as auto.
const MODES = [
  { gladys: AC_MODE.AUTO, esphome: [CLIMATE_MODE.HEAT_COOL, CLIMATE_MODE.AUTO], label: 'Auto' },
  { gladys: AC_MODE.COOLING, esphome: [CLIMATE_MODE.COOL], label: 'Cool' },
  { gladys: AC_MODE.HEATING, esphome: [CLIMATE_MODE.HEAT], label: 'Heat' },
  { gladys: AC_MODE.DRYING, esphome: [CLIMATE_MODE.DRY], label: 'Dry' },
  { gladys: AC_MODE.FAN, esphome: [CLIMATE_MODE.FAN_ONLY], label: 'Fan' },
];

// ESPHome fan mode -> Gladys fan speed. MEDIUM is the middle speed; MIDDLE, a
// second in-between value a few components declare, takes the low-mid slot so
// the two stay distinct. ON, OFF, FOCUS and DIFFUSE (airflow shapes, not
// speeds) have no Gladys value and are left out.
const FAN_SPEEDS = [
  { gladys: AC_FAN_SPEED.AUTO, esphome: FAN_MODE.AUTO, label: 'Auto' },
  { gladys: AC_FAN_SPEED.QUIET, esphome: FAN_MODE.QUIET, label: 'Quiet' },
  { gladys: AC_FAN_SPEED.LOW, esphome: FAN_MODE.LOW, label: 'Low' },
  { gladys: AC_FAN_SPEED.LOW_MID, esphome: FAN_MODE.MIDDLE, label: 'Middle' },
  { gladys: AC_FAN_SPEED.MID, esphome: FAN_MODE.MEDIUM, label: 'Medium' },
  { gladys: AC_FAN_SPEED.HIGH, esphome: FAN_MODE.HIGH, label: 'High' },
];

const SWING_OPTIONS = [
  { value: AC_SWING.OFF, label: 'Off', sort_order: 0 },
  { value: AC_SWING.SWING, label: 'Swing', sort_order: 1 },
];

/**
 * The supported ESPHome values of a climate list, as numbers.
 * @param {unknown} list - `supportedModes`, `supportedFanModes`…
 * @returns {number[]} The values.
 */
function supported(list) {
  return Array.isArray(list) ? list.map(Number) : [];
}

/**
 * The Gladys modes a climate supports, with the ESPHome mode each one sends.
 * @param {object} entity - The ESPHome climate entity.
 * @returns {Array<{ gladys: number, esphome: number, label: string }>} The modes.
 */
function modesOf(entity) {
  const modes = supported(entity.supportedModes);
  return MODES.map((mode) => ({
    ...mode,
    esphome: mode.esphome.find((m) => modes.includes(m)),
  })).filter((mode) => mode.esphome !== undefined);
}

/**
 * The Gladys fan speeds a climate supports.
 * @param {object} entity - The ESPHome climate entity.
 * @returns {Array<{ gladys: number, esphome: number, label: string }>} The speeds.
 */
function fanSpeedsOf(entity) {
  const fanModes = supported(entity.supportedFanModes);
  return FAN_SPEEDS.filter((speed) => fanModes.includes(speed.esphome));
}

/**
 * The swing axes a climate supports.
 * @param {object} entity - The ESPHome climate entity.
 * @returns {{ vertical: boolean, horizontal: boolean }} The axes.
 */
function swingAxesOf(entity) {
  const swings = supported(entity.supportedSwingModes);
  return {
    vertical: swings.includes(SWING_MODE.VERTICAL) || swings.includes(SWING_MODE.BOTH),
    horizontal: swings.includes(SWING_MODE.HORIZONTAL) || swings.includes(SWING_MODE.BOTH),
  };
}

/**
 * Turn a `{ gladys, label }` list into the feature's supported_options.
 * @param {Array<{ gladys: number, label: string }>} entries - The entries.
 * @returns {object[]} The supported_options.
 */
function toOptions(entries) {
  return entries.map((entry, index) => ({
    value: entry.gladys,
    label: entry.label,
    sort_order: index,
  }));
}

/**
 * The air-conditioning features of an ESPHome climate, each one only when the
 * firmware supports it. The ranges cover the whole Gladys enum (they are
 * forever fields); `supportedOptions` narrows the choices to what this unit
 * accepts.
 * @param {object} entity - The ESPHome climate entity.
 * @param {string} category - The air-conditioning category.
 * @param {object} types - The air-conditioning feature types.
 * @returns {object[]} The feature descriptors.
 * @example
 * describeClimateControls({ supportedModes: [0, 2, 3] }, 'air-conditioning', types);
 */
export function describeClimateControls(entity, category, types) {
  const features = [];
  const control = (key, type, min, max, supportedOptions) =>
    features.push({
      key,
      readOnly: false,
      keepHistory: true,
      category,
      type,
      min,
      max,
      ...(supportedOptions ? { supportedOptions } : {}),
    });

  const modes = modesOf(entity);
  // A climate that cannot be turned off has no power to show, and one that
  // only knows one mode has nothing to choose.
  if (supported(entity.supportedModes).includes(CLIMATE_MODE.OFF) && modes.length > 0) {
    control('power', types.BINARY, 0, 1);
  }
  if (modes.length > 1) {
    control('mode', types.MODE, AC_MODE.AUTO, AC_MODE.FAN, toOptions(modes));
  }
  const speeds = fanSpeedsOf(entity);
  if (speeds.length > 1) {
    control('fan_mode', types.FAN_SPEED, AC_FAN_SPEED.AUTO, AC_FAN_SPEED.TURBO, toOptions(speeds));
  }
  const axes = swingAxesOf(entity);
  if (axes.vertical) {
    control('swing_vertical', types.SWING_VERTICAL, AC_SWING.OFF, AC_SWING.SWING, SWING_OPTIONS);
  }
  if (axes.horizontal) {
    control(
      'swing_horizontal',
      types.SWING_HORIZONTAL,
      AC_SWING.OFF,
      AC_SWING.SWING,
      SWING_OPTIONS,
    );
  }
  return features;
}

/**
 * Whether a swing mode moves the given axis.
 * @param {number} swingMode - The ESPHome swing mode.
 * @param {'vertical'|'horizontal'} axis - The axis.
 * @returns {boolean} True when that axis swings.
 */
function swings(swingMode, axis) {
  return swingMode === SWING_MODE.BOTH || swingMode === SWING_MODE[axis.toUpperCase()];
}

/**
 * Read one air-conditioning feature from a climate state (completed with its
 * wire defaults).
 * @param {string} key - The feature key.
 * @param {object} event - The ESPHome climate state.
 * @returns {number|undefined} The Gladys value, or undefined to publish nothing.
 * @example
 * readClimateControl('power', { mode: 2 }); // 1
 */
export function readClimateControl(key, event) {
  const mode = Number(event.mode);
  switch (key) {
    case 'power':
      return mode === CLIMATE_MODE.OFF ? 0 : 1;
    case 'mode':
      // OFF is the power feature's business: the mode keeps showing the one
      // the unit will resume in.
      return MODES.find((entry) => entry.esphome.includes(mode))?.gladys;
    case 'fan_mode':
      // A custom fan mode (a free string) has no Gladys value.
      if (event.customFanMode) {
        return undefined;
      }
      return FAN_SPEEDS.find((entry) => entry.esphome === Number(event.fanMode))?.gladys;
    case 'swing_vertical':
      return swings(Number(event.swingMode), 'vertical') ? AC_SWING.SWING : AC_SWING.OFF;
    case 'swing_horizontal':
      return swings(Number(event.swingMode), 'horizontal') ? AC_SWING.SWING : AC_SWING.OFF;
    default:
      return undefined;
  }
}

/**
 * The mode a climate turns on in: the last one it ran in, else its "auto",
 * else the first mode it supports.
 * @param {object} entity - The ESPHome climate entity.
 * @param {number|undefined} resumeMode - The last ESPHome mode seen while on.
 * @returns {number|undefined} The ESPHome mode.
 */
function powerOnMode(entity, resumeMode) {
  const modes = supported(entity.supportedModes);
  if (resumeMode !== undefined && modes.includes(resumeMode)) {
    return resumeMode;
  }
  return modesOf(entity)[0]?.esphome;
}

/**
 * Build what applying a Gladys value to an air-conditioning feature means:
 * a command for the node, or only a new resume mode when the unit is off.
 * @param {string} key - The feature key.
 * @param {number} value - The Gladys value.
 * @param {object} context - What the write depends on.
 * @param {object} context.entity - The ESPHome climate entity.
 * @param {object} [context.state] - Its last state (wire defaults completed).
 * @param {number} [context.resumeMode] - The last ESPHome mode seen while on.
 * @returns {{ command?: object, resumeMode?: number }|null} null when the
 * value cannot be applied to this unit.
 * @example
 * writeClimateControl('power', 0, { entity }); // { command: { mode: 0 } }
 */
export function writeClimateControl(key, value, { entity, state, resumeMode }) {
  const isOn = state !== undefined && Number(state.mode) !== CLIMATE_MODE.OFF;
  switch (key) {
    case 'power': {
      if (value !== 1) {
        return { command: { mode: CLIMATE_MODE.OFF } };
      }
      const mode = isOn ? Number(state.mode) : powerOnMode(entity, resumeMode);
      return mode === undefined ? null : { command: { mode } };
    }
    case 'mode': {
      const mode = modesOf(entity).find((entry) => entry.gladys === value)?.esphome;
      if (mode === undefined) {
        return null;
      }
      return isOn ? { command: { mode } } : { resumeMode: mode };
    }
    case 'fan_mode': {
      const fanMode = fanSpeedsOf(entity).find((entry) => entry.gladys === value)?.esphome;
      return fanMode === undefined ? null : { command: { fanMode } };
    }
    case 'swing_vertical':
    case 'swing_horizontal': {
      const axis = key === 'swing_vertical' ? 'vertical' : 'horizontal';
      const other = axis === 'vertical' ? 'horizontal' : 'vertical';
      const current = state === undefined ? SWING_MODE.OFF : Number(state.swingMode);
      const want = { [axis]: value === AC_SWING.SWING, [other]: swings(current, other) };
      let swingMode = SWING_MODE.OFF;
      if (want.vertical && want.horizontal) {
        swingMode = SWING_MODE.BOTH;
      } else if (want.vertical || want.horizontal) {
        swingMode = SWING_MODE[(want.vertical ? 'vertical' : 'horizontal').toUpperCase()];
      }
      // A unit without BOTH swings one axis at a time: the one just asked for.
      if (!supported(entity.supportedSwingModes).includes(swingMode)) {
        swingMode = want[axis] ? SWING_MODE[axis.toUpperCase()] : SWING_MODE.OFF;
      }
      return { command: { swingMode } };
    }
    default:
      return null;
  }
}
