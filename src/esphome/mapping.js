// -----------------------------------------------------------------------------
// ESPHome entity -> Gladys feature mapping.
//
// ESPHome has no fixed device catalog: a node exposes whatever entities its
// YAML declares. The mapping therefore keys on what the firmware actually
// reports — the entity TYPE (`sensor`, `switch`, `binary_sensor`…) and, for the
// two generic types, the `device_class` the user set in their YAML:
//
//   sensor        + device_class: temperature -> temperature-sensor / decimal
//   binary_sensor + device_class: motion      -> motion-sensor / binary
//
// Without a device_class the entity still lands in Gladys, as a generic sensor
// (`sensor/decimal`) or a generic switch — it is never dropped, because a value
// shown under a plain name beats a value not shown at all.
//
// Pure module: no client, no SDK instance, no I/O. Everything here is a value
// transform, which is what makes the table testable line by line.
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES,
  DEVICE_FEATURE_TYPES,
  DEVICE_FEATURE_UNITS,
} from '@gladysassistant/integration-sdk';

const { SENSOR, SWITCH, LIGHT, SHUTTER, BUTTON, THERMOSTAT, TEXT } = DEVICE_FEATURE_TYPES;

// --- Units ------------------------------------------------------------------
// ESPHome reports `unit_of_measurement` as the free-text string from the YAML.
// Only the units Gladys knows are mapped; an unknown unit simply yields no unit
// (the value is still published, just without a suffix in the UI).
const UNITS = {
  '°C': DEVICE_FEATURE_UNITS.CELSIUS,
  '°F': DEVICE_FEATURE_UNITS.FAHRENHEIT,
  K: DEVICE_FEATURE_UNITS.KELVIN,
  '%': DEVICE_FEATURE_UNITS.PERCENT,
  Pa: DEVICE_FEATURE_UNITS.PASCAL,
  hPa: DEVICE_FEATURE_UNITS.HECTO_PASCAL,
  kPa: DEVICE_FEATURE_UNITS.KILO_PASCAL,
  bar: DEVICE_FEATURE_UNITS.BAR,
  mbar: DEVICE_FEATURE_UNITS.MILLIBAR,
  psi: DEVICE_FEATURE_UNITS.PSI,
  lx: DEVICE_FEATURE_UNITS.LUX,
  ppm: DEVICE_FEATURE_UNITS.PPM,
  ppb: DEVICE_FEATURE_UNITS.PPB,
  W: DEVICE_FEATURE_UNITS.WATT,
  kW: DEVICE_FEATURE_UNITS.KILOWATT,
  Wh: DEVICE_FEATURE_UNITS.WATT_HOUR,
  kWh: DEVICE_FEATURE_UNITS.KILOWATT_HOUR,
  V: DEVICE_FEATURE_UNITS.VOLT,
  mV: DEVICE_FEATURE_UNITS.MILLI_VOLT,
  A: DEVICE_FEATURE_UNITS.AMPERE,
  mA: DEVICE_FEATURE_UNITS.MILLI_AMPERE,
  VA: DEVICE_FEATURE_UNITS.VOLT_AMPERE,
  dB: DEVICE_FEATURE_UNITS.DECIBEL,
  dBm: DEVICE_FEATURE_UNITS.DECIBEL,
  mm: DEVICE_FEATURE_UNITS.MM,
  cm: DEVICE_FEATURE_UNITS.CM,
  m: DEVICE_FEATURE_UNITS.M,
  km: DEVICE_FEATURE_UNITS.KM,
  '°': DEVICE_FEATURE_UNITS.DEGREE,
  L: DEVICE_FEATURE_UNITS.LITER,
  mL: DEVICE_FEATURE_UNITS.MILLILITER,
  'm³': DEVICE_FEATURE_UNITS.CUBIC_METER,
  s: DEVICE_FEATURE_UNITS.SECONDS,
  ms: DEVICE_FEATURE_UNITS.MILLISECONDS,
  min: DEVICE_FEATURE_UNITS.MINUTES,
  h: DEVICE_FEATURE_UNITS.HOURS,
  'm/s': DEVICE_FEATURE_UNITS.METER_PER_SECOND,
  'km/h': DEVICE_FEATURE_UNITS.KILOMETER_PER_HOUR,
  'mm/h': DEVICE_FEATURE_UNITS.MILLIMETER_PER_HOUR,
  'µg/m³': DEVICE_FEATURE_UNITS.MICROGRAM_PER_CUBIC_METER,
  'mg/m³': DEVICE_FEATURE_UNITS.MILLIGRAM_PER_CUBIC_METER,
  B: DEVICE_FEATURE_UNITS.BYTE,
  kB: DEVICE_FEATURE_UNITS.KILOBYTE,
  MB: DEVICE_FEATURE_UNITS.MEGABYTE,
};

/**
 * Map an ESPHome `unit_of_measurement` string to a Gladys unit.
 * @param {string|undefined} unit - The raw unit reported by the firmware.
 * @returns {string|undefined} The Gladys unit, or undefined if unknown.
 * @example
 * mapUnit('°C'); // 'celsius'
 */
export function mapUnit(unit) {
  if (typeof unit !== 'string') {
    return undefined;
  }
  return UNITS[unit.trim()];
}

// --- Numeric sensors --------------------------------------------------------
// Keyed on the ESPHome `device_class` (the same vocabulary Home Assistant uses,
// which is what ESPHome documents). `max` bounds the Gladys UI gauge; it is only
// set where a natural bound exists, so a power sensor is not clamped to 100.
const SENSOR_CLASSES = {
  temperature: { category: DEVICE_FEATURE_CATEGORIES.TEMPERATURE_SENSOR, min: -100, max: 250 },
  humidity: { category: DEVICE_FEATURE_CATEGORIES.HUMIDITY_SENSOR, min: 0, max: 100 },
  pressure: { category: DEVICE_FEATURE_CATEGORIES.PRESSURE_SENSOR, min: 0, max: 2000 },
  atmospheric_pressure: { category: DEVICE_FEATURE_CATEGORIES.PRESSURE_SENSOR, min: 0, max: 2000 },
  illuminance: { category: DEVICE_FEATURE_CATEGORIES.LIGHT_SENSOR, min: 0, max: 100000 },
  // These categories declare a type of their own, which the SENSOR.DECIMAL
  // default would not satisfy.
  battery: {
    category: DEVICE_FEATURE_CATEGORIES.BATTERY,
    type: DEVICE_FEATURE_TYPES.BATTERY.INTEGER,
    min: 0,
    max: 100,
  },
  signal_strength: {
    category: DEVICE_FEATURE_CATEGORIES.SIGNAL,
    type: DEVICE_FEATURE_TYPES.SIGNAL.QUALITY,
    min: -120,
    max: 0,
  },
  carbon_dioxide: { category: DEVICE_FEATURE_CATEGORIES.CO2_SENSOR, min: 0, max: 10000 },
  // `co-sensor` only declares a BINARY type in Gladys, so a numeric CO reading
  // has no home there: it stays a generic measurement (see mapSensor).
  carbon_monoxide: null,
  pm25: { category: DEVICE_FEATURE_CATEGORIES.PM25_SENSOR, min: 0, max: 1000 },
  pm10: { category: DEVICE_FEATURE_CATEGORIES.PM10_SENSOR, min: 0, max: 1000 },
  volatile_organic_compounds: {
    category: DEVICE_FEATURE_CATEGORIES.VOC_SENSOR,
    min: 0,
    max: 10000,
  },
  volatile_organic_compounds_parts: {
    category: DEVICE_FEATURE_CATEGORIES.VOC_SENSOR,
    min: 0,
    max: 10000,
  },
  aqi: {
    category: DEVICE_FEATURE_CATEGORIES.AIRQUALITY_SENSOR,
    type: DEVICE_FEATURE_TYPES.AIRQUALITY_SENSOR.AQI,
    min: 0,
    max: 500,
  },
  distance: { category: DEVICE_FEATURE_CATEGORIES.DISTANCE_SENSOR, min: 0, max: 100000 },
  moisture: { category: DEVICE_FEATURE_CATEGORIES.SOIL_MOISTURE_SENSOR, min: 0, max: 100 },
  ph: { category: DEVICE_FEATURE_CATEGORIES.PH_SENSOR, min: 0, max: 14 },
  precipitation: { category: DEVICE_FEATURE_CATEGORIES.PRECIPITATION_SENSOR, min: 0, max: 1000 },
  // `rain-sensor` is binary-only in Gladys; a rain RATE is a measurement, so it
  // maps to the precipitation category, which does carry a decimal type.
  precipitation_intensity: {
    category: DEVICE_FEATURE_CATEGORIES.PRECIPITATION_SENSOR,
    min: 0,
    max: 1000,
  },
  sound_pressure: {
    category: DEVICE_FEATURE_CATEGORIES.NOISE_SENSOR,
    // This category declares an INTEGER type, not a decimal one.
    type: SENSOR.INTEGER,
    min: 0,
    max: 200,
  },
  speed: { category: DEVICE_FEATURE_CATEGORIES.SPEED_SENSOR, min: 0, max: 1000 },
  wind_speed: { category: DEVICE_FEATURE_CATEGORIES.SPEED_SENSOR, min: 0, max: 1000 },
  duration: { category: DEVICE_FEATURE_CATEGORIES.DURATION, min: 0, max: 1000000 },
  data_size: {
    category: DEVICE_FEATURE_CATEGORIES.DATA,
    type: DEVICE_FEATURE_TYPES.DATA.SIZE,
    min: 0,
    max: 1000000000,
  },
  data_rate: {
    category: DEVICE_FEATURE_CATEGORIES.DATARATE,
    type: DEVICE_FEATURE_TYPES.DATARATE.RATE,
    min: 0,
    max: 1000000,
  },
  // Electrical measurements all live under the energy-sensor category, which
  // carries a dedicated type per physical quantity.
  power: {
    category: DEVICE_FEATURE_CATEGORIES.ENERGY_SENSOR,
    type: DEVICE_FEATURE_TYPES.ENERGY_SENSOR.POWER,
    min: -100000,
    max: 100000,
  },
  energy: {
    category: DEVICE_FEATURE_CATEGORIES.ENERGY_SENSOR,
    type: DEVICE_FEATURE_TYPES.ENERGY_SENSOR.ENERGY,
    min: 0,
    max: 1000000,
  },
  voltage: {
    category: DEVICE_FEATURE_CATEGORIES.ENERGY_SENSOR,
    type: DEVICE_FEATURE_TYPES.ENERGY_SENSOR.VOLTAGE,
    min: -1000,
    max: 1000,
  },
  current: {
    category: DEVICE_FEATURE_CATEGORIES.ENERGY_SENSOR,
    type: DEVICE_FEATURE_TYPES.ENERGY_SENSOR.CURRENT,
    min: -1000,
    max: 1000,
  },
};

// --- Binary sensors ---------------------------------------------------------
// Keyed on the ESPHome `device_class` as well. Every entry is read-only and
// bounded to 0/1 — that part is applied by the builder, not repeated here.
const BINARY_SENSOR_CLASSES = {
  motion: DEVICE_FEATURE_CATEGORIES.MOTION_SENSOR,
  occupancy: DEVICE_FEATURE_CATEGORIES.PRESENCE_SENSOR,
  presence: DEVICE_FEATURE_CATEGORIES.PRESENCE_SENSOR,
  door: DEVICE_FEATURE_CATEGORIES.OPENING_SENSOR,
  garage_door: DEVICE_FEATURE_CATEGORIES.OPENING_SENSOR,
  window: DEVICE_FEATURE_CATEGORIES.OPENING_SENSOR,
  opening: DEVICE_FEATURE_CATEGORIES.OPENING_SENSOR,
  smoke: DEVICE_FEATURE_CATEGORIES.SMOKE_SENSOR,
  gas: DEVICE_FEATURE_CATEGORIES.SMOKE_SENSOR,
  carbon_monoxide: DEVICE_FEATURE_CATEGORIES.CO_SENSOR,
  moisture: DEVICE_FEATURE_CATEGORIES.LEAK_SENSOR,
  vibration: DEVICE_FEATURE_CATEGORIES.VIBRATION_SENSOR,
  tamper: DEVICE_FEATURE_CATEGORIES.TAMPER,
  battery: DEVICE_FEATURE_CATEGORIES.BATTERY_LOW,
  lock: DEVICE_FEATURE_CATEGORIES.LOCK,
  // `light` and `sound` have no entry here on purpose: their Gladys categories
  // (light-sensor, noise-sensor) only declare NUMERIC types, so a binary
  // "is it bright / is it noisy" state has no valid pair there and falls back
  // to the generic on/off rendering (see mapBinarySensor).
};

/**
 * Build the Gladys feature descriptor of a numeric ESPHome `sensor` entity.
 * Falls back to a generic decimal sensor when the YAML declares no
 * `device_class`, so an unnamed measurement still reaches the dashboard.
 * @param {object} entity - The ESPHome entity (`deviceClass`, `unitOfMeasurement`…).
 * @returns {object} `{ category, type, unit?, min, max }`.
 * @example
 * mapSensor({ deviceClass: 'temperature', unitOfMeasurement: '°C' });
 */
export function mapSensor(entity) {
  const known = SENSOR_CLASSES[entity.deviceClass];
  const unit = mapUnit(entity.unitOfMeasurement);
  if (!known) {
    return {
      // No device_class: Gladys has a category for exactly this — an untyped
      // measurement, rendered under its own name and unit. The pair must be
      // `unknown/unknown`: the Gladys front resolves a feature label through
      // `deviceFeatureCategory.<category>.<type>`, and `unknown` declares that
      // single type (an `unknown/decimal` pair would render an empty label).
      category: DEVICE_FEATURE_CATEGORIES.UNKNOWN,
      type: DEVICE_FEATURE_TYPES.UNKNOWN.UNKNOWN,
      unit,
      // No device_class also means no known physical bound: keep the range wide
      // rather than clamping a value we cannot anticipate.
      min: -1000000,
      max: 1000000,
    };
  }
  return {
    category: known.category,
    // Most sensor categories carry the decimal type; the electrical ones name
    // their quantity explicitly.
    type: known.type || SENSOR.DECIMAL,
    unit,
    min: known.min,
    max: known.max,
  };
}

/**
 * Build the Gladys feature descriptor of an ESPHome `binary_sensor` entity.
 * @param {object} entity - The ESPHome entity (`deviceClass`).
 * @returns {object} `{ category, type, min, max }`.
 * @example
 * mapBinarySensor({ deviceClass: 'motion' });
 */
export function mapBinarySensor(entity) {
  const category = BINARY_SENSOR_CLASSES[entity.deviceClass];
  if (!category) {
    // No device_class: an unqualified on/off state. The switch category renders
    // it as a plain binary state, which is exactly what it is.
    return { category: DEVICE_FEATURE_CATEGORIES.SWITCH, type: SWITCH.BINARY, min: 0, max: 1 };
  }
  // Gladys convention for binary sensors: the CATEGORY carries the meaning
  // (motion, opening, leak…) while the TYPE stays the generic SENSOR.BINARY.
  // Two categories name their type differently — the Gladys front resolves
  // labels through `deviceFeatureCategory.<category>.<type>`, so the pair has
  // to exist there.
  return { category, type: BINARY_TYPE_OVERRIDES[category] || SENSOR.BINARY, min: 0, max: 1 };
}

// Categories whose binary state is NOT declared under the `binary` type. The
// SDK exposes no type table for `presence-sensor`, but the Gladys front
// declares its state under `push`, and SENSOR.PUSH carries that exact value.
const BINARY_TYPE_OVERRIDES = {
  [DEVICE_FEATURE_CATEGORIES.LOCK]: DEVICE_FEATURE_TYPES.LOCK.BINARY,
  [DEVICE_FEATURE_CATEGORIES.PRESENCE_SENSOR]: SENSOR.PUSH,
};

/**
 * Describe the Gladys features an ESPHome entity translates to. Most entities
 * yield exactly one feature; a light yields several (state, brightness, color,
 * temperature), which is why the return type is always an array.
 *
 * Each descriptor carries the `key` the runtime needs to translate a state or a
 * command back to the ESPHome side — `state`, `brightness`, `color`… — appended
 * to the entity id to build the feature external id.
 * @param {object} entity - The ESPHome entity, as discovered by the client.
 * @returns {object[]} The feature descriptors (possibly empty: unmapped type).
 * @example
 * describeEntity({ type: 'switch', name: 'Relay', objectId: 'relay' });
 */
export function describeEntity(entity) {
  switch (entity.type) {
    case 'sensor':
      return [{ key: 'state', readOnly: true, keepHistory: true, ...mapSensor(entity) }];

    case 'binary_sensor':
      return [{ key: 'state', readOnly: true, keepHistory: true, ...mapBinarySensor(entity) }];

    case 'text_sensor':
      return [
        {
          key: 'state',
          readOnly: true,
          keepHistory: true,
          category: DEVICE_FEATURE_CATEGORIES.TEXT,
          type: TEXT.TEXT,
          min: 0,
          max: 0,
        },
      ];

    case 'text':
      return [
        {
          key: 'state',
          // The writable counterpart of `text_sensor`: ESPHome accepts a free
          // string here (TextCommandRequest), which is what lets Gladys push a
          // line of text to a node — the message a `display:` lambda renders.
          readOnly: false,
          keepHistory: true,
          category: DEVICE_FEATURE_CATEGORIES.TEXT,
          type: TEXT.TEXT,
          min: 0,
          max: 0,
        },
      ];

    case 'switch':
      return [
        {
          key: 'state',
          readOnly: false,
          keepHistory: true,
          category: DEVICE_FEATURE_CATEGORIES.SWITCH,
          type: SWITCH.BINARY,
          min: 0,
          max: 1,
        },
      ];

    case 'button':
      return [
        {
          key: 'press',
          readOnly: false,
          keepHistory: false,
          category: DEVICE_FEATURE_CATEGORIES.BUTTON,
          type: BUTTON.PUSH,
          min: 0,
          max: 1,
        },
      ];

    case 'light':
      return describeLight(entity);

    case 'cover':
      return describeCover(entity);

    case 'lock':
      return [
        {
          key: 'state',
          readOnly: false,
          keepHistory: true,
          category: DEVICE_FEATURE_CATEGORIES.LOCK,
          type: DEVICE_FEATURE_TYPES.LOCK.BINARY,
          min: 0,
          max: 1,
        },
      ];

    case 'fan':
      return describeFan(entity);

    case 'climate':
      return describeClimate(entity);

    case 'number':
      return [
        {
          key: 'state',
          readOnly: false,
          keepHistory: true,
          // A `number` is a WRITABLE bounded setting. Gladys renders
          // `duration/decimal` with a slider bound to its min/max, which is
          // exactly that control — and it is the only generic numeric pair the
          // front renders as writable rather than as a read-only measurement.
          category: DEVICE_FEATURE_CATEGORIES.DURATION,
          type: DEVICE_FEATURE_TYPES.DURATION.DECIMAL,
          unit: mapUnit(entity.unitOfMeasurement),
          // A number entity declares its own bounds in the YAML; honour them.
          min: typeof entity.minValue === 'number' ? entity.minValue : 0,
          max: typeof entity.maxValue === 'number' ? entity.maxValue : 100,
        },
      ];

    default:
      // Entity types Gladys has no equivalent for (media_player, select, date,
      // camera, valve…). Returning nothing keeps them out of the discovery
      // list rather than creating a feature that could never work.
      return [];
  }
}

/**
 * Features of an ESPHome `light`: always a binary state, plus the dimensions
 * the firmware reports as supported. `supportedColorModes` is the authoritative
 * signal — a plain on/off relay light must not get a brightness slider.
 * @param {object} entity - The ESPHome light entity.
 * @returns {object[]} The feature descriptors.
 */
function describeLight(entity) {
  const features = [
    {
      key: 'state',
      readOnly: false,
      keepHistory: true,
      category: DEVICE_FEATURE_CATEGORIES.LIGHT,
      type: LIGHT.BINARY,
      min: 0,
      max: 1,
    },
  ];

  const modes = Array.isArray(entity.supportedColorModes) ? entity.supportedColorModes : [];
  // ColorMode is a bitfield: BRIGHTNESS is bit 1, RGB bit 4, COLOR_TEMPERATURE
  // bit 6. Any mode above the plain ON_OFF (1) carries brightness.
  const supports = (bit) => modes.some((mode) => (mode & bit) === bit);

  if (supports(BRIGHTNESS_BIT)) {
    features.push({
      key: 'brightness',
      readOnly: false,
      keepHistory: true,
      category: DEVICE_FEATURE_CATEGORIES.LIGHT,
      type: LIGHT.BRIGHTNESS,
      unit: DEVICE_FEATURE_UNITS.PERCENT,
      min: 0,
      max: 100,
    });
  }

  if (supports(RGB_BIT)) {
    features.push({
      key: 'color',
      readOnly: false,
      keepHistory: true,
      category: DEVICE_FEATURE_CATEGORIES.LIGHT,
      type: LIGHT.COLOR,
      min: 0,
      // Gladys stores a color as a single integer (0xRRGGBB).
      max: 16777215,
    });
  }

  if (supports(COLOR_TEMPERATURE_BIT)) {
    features.push({
      key: 'temperature',
      readOnly: false,
      keepHistory: true,
      category: DEVICE_FEATURE_CATEGORIES.LIGHT,
      type: LIGHT.TEMPERATURE,
      // ESPHome speaks mireds; the node reports its own usable range.
      min: Math.round(entity.minMireds || 153),
      max: Math.round(entity.maxMireds || 500),
    });
  }

  return features;
}

// ESPHome ColorMode capability bits (esphome/components/light/color_mode.h).
// Each ColorMode value is a bitfield combining the capabilities it implies, so
// RGB (0b100011) carries the RGB bit AND the brightness and on/off bits. Testing
// the bit — rather than comparing the whole value — is what makes a light
// declaring RGB_COLOR_TEMPERATURE (0b101111) match both color and temperature.
const BRIGHTNESS_BIT = 0b000010;
const COLOR_TEMPERATURE_BIT = 0b001000;
const RGB_BIT = 0b100000;

/**
 * Features of an ESPHome `cover`: a state (open/close/stop) and, when the
 * firmware supports positioning, a position slider.
 * @param {object} entity - The ESPHome cover entity.
 * @returns {object[]} The feature descriptors.
 */
function describeCover(entity) {
  // A curtain and a shutter are the same protocol here; the device_class only
  // changes which Gladys category (and therefore which icon) fits best.
  const category =
    entity.deviceClass === 'curtain'
      ? DEVICE_FEATURE_CATEGORIES.CURTAIN
      : DEVICE_FEATURE_CATEGORIES.SHUTTER;
  const types =
    category === DEVICE_FEATURE_CATEGORIES.CURTAIN ? DEVICE_FEATURE_TYPES.CURTAIN : SHUTTER;

  const features = [
    {
      key: 'state',
      readOnly: false,
      keepHistory: true,
      category,
      type: types.STATE,
      // Gladys shutter states: -1 closing, 0 stop, 1 opening, 2 open, 3 closed.
      min: -1,
      max: 3,
    },
  ];

  if (entity.supportsPosition) {
    features.push({
      key: 'position',
      readOnly: false,
      keepHistory: true,
      category,
      type: types.POSITION,
      unit: DEVICE_FEATURE_UNITS.PERCENT,
      min: 0,
      max: 100,
    });
  }

  return features;
}

/**
 * Features of an ESPHome `fan`: on/off, plus speed when the firmware supports
 * it. Oscillation and direction have no Gladys equivalent that maps cleanly, so
 * they are left out rather than approximated.
 * @param {object} entity - The ESPHome fan entity.
 * @returns {object[]} The feature descriptors.
 */
function describeFan(entity) {
  const features = [
    {
      key: 'state',
      readOnly: false,
      keepHistory: true,
      category: DEVICE_FEATURE_CATEGORIES.SWITCH,
      type: SWITCH.BINARY,
      min: 0,
      max: 1,
    },
  ];

  if (entity.supportsSpeed) {
    features.push({
      key: 'speed',
      readOnly: false,
      keepHistory: true,
      category: DEVICE_FEATURE_CATEGORIES.FAN,
      type: DEVICE_FEATURE_TYPES.FAN.SPEED,
      unit: DEVICE_FEATURE_UNITS.PERCENT,
      min: 0,
      max: 100,
    });
  }

  return features;
}

/**
 * Features of an ESPHome `climate`: the target temperature it accepts, and the
 * current temperature when the firmware measures one.
 * @param {object} entity - The ESPHome climate entity.
 * @returns {object[]} The feature descriptors.
 */
function describeClimate(entity) {
  const features = [
    {
      key: 'target_temperature',
      readOnly: false,
      keepHistory: true,
      category: DEVICE_FEATURE_CATEGORIES.THERMOSTAT,
      type: THERMOSTAT.TARGET_TEMPERATURE,
      unit: DEVICE_FEATURE_UNITS.CELSIUS,
      min:
        typeof entity.visualMinTemperature === 'number'
          ? Math.round(entity.visualMinTemperature)
          : 0,
      max:
        typeof entity.visualMaxTemperature === 'number'
          ? Math.round(entity.visualMaxTemperature)
          : 40,
    },
  ];

  if (entity.supportsCurrentTemperature) {
    features.push({
      key: 'current_temperature',
      readOnly: true,
      keepHistory: true,
      category: DEVICE_FEATURE_CATEGORIES.TEMPERATURE_SENSOR,
      type: SENSOR.DECIMAL,
      unit: DEVICE_FEATURE_UNITS.CELSIUS,
      min: -100,
      max: 250,
    });
  }

  return features;
}
