import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  DEVICE_FEATURE_CATEGORIES,
  DEVICE_FEATURE_TYPES,
  DEVICE_FEATURE_UNITS,
} from '@gladysassistant/integration-sdk';
import {
  describeEntity,
  mapSensor,
  mapBinarySensor,
  mapUnit,
  isHiddenByDefault,
} from '../src/esphome/mapping.js';

test('a numeric sensor maps to its Gladys category through its device_class', () => {
  const feature = mapSensor({ deviceClass: 'temperature', unitOfMeasurement: '°C' });
  assert.equal(feature.category, DEVICE_FEATURE_CATEGORIES.TEMPERATURE_SENSOR);
  assert.equal(feature.type, DEVICE_FEATURE_TYPES.SENSOR.DECIMAL);
  assert.equal(feature.unit, 'celsius');
});

test('a sensor without device_class still reaches Gladys, as a generic one', () => {
  // Dropping it would lose a measurement the user deliberately exposed.
  const feature = mapSensor({ unitOfMeasurement: 'ppm' });
  assert.equal(feature.category, DEVICE_FEATURE_CATEGORIES.UNKNOWN);
  assert.equal(feature.type, DEVICE_FEATURE_TYPES.UNKNOWN.UNKNOWN);
  assert.equal(feature.unit, 'ppm');
});

test('a sensor in degrees with no device_class is read as an angle', () => {
  // `ld2450` publishes its target angles with a unit and an accuracy, and no
  // device_class at all — Home Assistant's vocabulary has no word for an angle.
  const feature = mapSensor({ unitOfMeasurement: '°', accuracyDecimals: 1 });
  assert.equal(feature.category, DEVICE_FEATURE_CATEGORIES.ANGLE_SENSOR);
  assert.equal(feature.type, DEVICE_FEATURE_TYPES.SENSOR.INTEGER);
  assert.equal(feature.unit, 'degree');
  // A signed angle: the range has to reach below zero (-11.8° is a real value).
  assert.ok(feature.min < 0);
});

test('a unitless whole-number sensor with no device_class is read as a counter', () => {
  // The mmWave target counters: accuracy_decimals=0, no unit, no device_class.
  const feature = mapSensor({ accuracyDecimals: 0 });
  assert.equal(feature.category, DEVICE_FEATURE_CATEGORIES.COUNTER_SENSOR);
  assert.equal(feature.type, DEVICE_FEATURE_TYPES.SENSOR.INTEGER);
});

test("an explicit state_class classifies the sensor on the firmware's own word", () => {
  // MEASUREMENT_ANGLE (4) and TOTAL_INCREASING (2) in ESPHome's SensorStateClass.
  assert.equal(mapSensor({ stateClass: 4 }).category, DEVICE_FEATURE_CATEGORIES.ANGLE_SENSOR);
  assert.equal(
    mapSensor({ stateClass: 2, unitOfMeasurement: 'pulses' }).category,
    DEVICE_FEATURE_CATEGORIES.COUNTER_SENSOR,
  );
});

test('a unitless sensor with decimals is not mistaken for a counter', () => {
  // An index or a ratio: whole-number accuracy is what makes a count a count.
  const feature = mapSensor({ accuracyDecimals: 2 });
  assert.equal(feature.category, DEVICE_FEATURE_CATEGORIES.UNKNOWN);
});

test('a device_class deliberately left unmapped is not re-read by shape', () => {
  // `carbon_monoxide` maps to null on purpose: numeric CO has no Gladys home.
  // The firmware already said what it measures, so it stays a generic reading
  // rather than being reclassified as a counter by its accuracy.
  const feature = mapSensor({ deviceClass: 'carbon_monoxide', accuracyDecimals: 0 });
  assert.equal(feature.category, DEVICE_FEATURE_CATEGORIES.UNKNOWN);
});

test('an unknown unit yields no unit rather than an invalid one', () => {
  // The core validates `unit` against a closed enum: an invalid value would
  // have the whole feature rejected.
  assert.equal(mapUnit('parsecs'), undefined);
  assert.equal(mapUnit(undefined), undefined);
});

test('the electrical device_classes name their quantity explicitly', () => {
  assert.equal(mapSensor({ deviceClass: 'power' }).type, DEVICE_FEATURE_TYPES.ENERGY_SENSOR.POWER);
  assert.equal(
    mapSensor({ deviceClass: 'energy' }).type,
    DEVICE_FEATURE_TYPES.ENERGY_SENSOR.ENERGY,
  );
});

test('a binary sensor maps to the category its device_class implies', () => {
  const feature = mapBinarySensor({ deviceClass: 'motion' });
  assert.equal(feature.category, DEVICE_FEATURE_CATEGORIES.MOTION_SENSOR);
  assert.equal(feature.type, DEVICE_FEATURE_TYPES.SENSOR.BINARY);
});

test('the categories whose state type is not "binary" are honoured', () => {
  // The Gladys front resolves a label through `<category>.<type>`, so an
  // unmatched pair would render an empty label.
  assert.equal(mapBinarySensor({ deviceClass: 'lock' }).type, DEVICE_FEATURE_TYPES.LOCK.BINARY);
});

test('an occupancy sensor is a binary STATE, not a push event', () => {
  // `presence-sensor/push` is the event type: it only ever receives 1 and never
  // falls back to 0, so a scene could not test "the room is empty". An mmWave
  // `has_target` / `has_still_target` is a state and must stay binary.
  ['occupancy', 'presence'].forEach((deviceClass) => {
    const feature = mapBinarySensor({ deviceClass });
    assert.equal(feature.category, DEVICE_FEATURE_CATEGORIES.PRESENCE_SENSOR);
    assert.equal(feature.type, DEVICE_FEATURE_TYPES.SENSOR.BINARY);
  });
});

test('a light only gets the features its firmware declares as supported', () => {
  // supportedColorModes is a bitfield: ON_OFF (1) carries nothing more.
  const onOff = describeEntity({ type: 'light', supportedColorModes: [1] });
  assert.deepEqual(
    onOff.map((f) => f.key),
    ['state'],
  );

  // RGB (35) implies brightness; RGB_COLOR_TEMPERATURE (47) adds temperature.
  const rgb = describeEntity({ type: 'light', supportedColorModes: [35] });
  assert.deepEqual(
    rgb.map((f) => f.key),
    ['state', 'brightness', 'color'],
  );

  const full = describeEntity({ type: 'light', supportedColorModes: [47] });
  assert.deepEqual(
    full.map((f) => f.key),
    ['state', 'brightness', 'color', 'temperature'],
  );
});

test('a cold/warm white light gets a color temperature when its YAML gives the range', () => {
  // ESPHome api.proto: COLD_WARM_WHITE (19 = 0b010011) and RGB_COLD_WARM_WHITE
  // (51 = 0b110011) carry the COLD_WARM_WHITE bit (0b010000), not
  // COLOR_TEMPERATURE (0b001000). The firmware still mixes both channels from a
  // color_temperature when cold_white_color_temperature and
  // warm_white_color_temperature are set, which reports a mired range.
  // Gladys: light/temperature, in mireds as ESPHome speaks them.
  const range = { minMireds: 153, maxMireds: 370 };
  const cwww = describeEntity({ type: 'light', supportedColorModes: [19], ...range });
  assert.deepEqual(
    cwww.map((f) => f.key),
    ['state', 'brightness', 'temperature'],
  );
  const temperature = cwww.find((f) => f.key === 'temperature');
  assert.equal(temperature.type, DEVICE_FEATURE_TYPES.LIGHT.TEMPERATURE);
  assert.equal(temperature.min, 153);
  assert.equal(temperature.max, 370);

  const rgbww = describeEntity({ type: 'light', supportedColorModes: [35, 51], ...range });
  assert.deepEqual(
    rgbww.map((f) => f.key),
    ['state', 'brightness', 'color', 'temperature'],
  );

  // No range declared: the node ignores a temperature, so no slider.
  const bare = describeEntity({ type: 'light', supportedColorModes: [19] });
  assert.deepEqual(
    bare.map((f) => f.key),
    ['state', 'brightness'],
  );
});

test('the temperature of the node itself is not a room temperature', () => {
  // ESPHome flags `internal_temperature` (an ESP32 at 45-60 °C) as a
  // diagnostic (entityCategory 2). Under temperature-sensor it entered the room
  // temperature the core averages; Gladys files it as device-temperature-sensor.
  const internal = mapSensor({
    deviceClass: 'temperature',
    unitOfMeasurement: '°C',
    entityCategory: 2,
  });
  assert.equal(internal.category, DEVICE_FEATURE_CATEGORIES.DEVICE_TEMPERATURE_SENSOR);
  assert.equal(internal.type, DEVICE_FEATURE_TYPES.SENSOR.DECIMAL);
  assert.equal(internal.unit, DEVICE_FEATURE_UNITS.CELSIUS);

  // A room probe (no category), and a diagnostic in kelvin, which the
  // device-temperature-sensor category does not accept, stay where they were.
  const room = mapSensor({ deviceClass: 'temperature', unitOfMeasurement: '°C' });
  assert.equal(room.category, DEVICE_FEATURE_CATEGORIES.TEMPERATURE_SENSOR);
  const kelvin = mapSensor({
    deviceClass: 'temperature',
    unitOfMeasurement: 'K',
    entityCategory: 2,
  });
  assert.equal(kelvin.category, DEVICE_FEATURE_CATEGORIES.TEMPERATURE_SENSOR);
});

test('only node buttons and entities disabled by default are hidden from discovery', () => {
  // ESPHome EntityCategory: 0 none, 1 config, 2 diagnostic.
  assert.equal(isHiddenByDefault({ type: 'button', entityCategory: 1 }), true);
  assert.equal(isHiddenByDefault({ type: 'button', entityCategory: 2 }), true);
  assert.equal(isHiddenByDefault({ type: 'button' }), false);
  assert.equal(isHiddenByDefault({ type: 'sensor', entityCategory: 2 }), false);
  assert.equal(isHiddenByDefault({ type: 'switch', entityCategory: 1 }), false);
  assert.equal(isHiddenByDefault({ type: 'switch', disabledByDefault: true }), true);
});

test('a select becomes a Gladys text/select with the options of the YAML', () => {
  // ESPHome `select`: a list of strings declared in the YAML (`options:`).
  // Gladys `text/select`: string supported_options { value, label }, no history.
  const [feature] = describeEntity({
    type: 'select',
    options: ['Normal', 'Engineering mode'],
  });
  assert.equal(feature.category, DEVICE_FEATURE_CATEGORIES.TEXT);
  assert.equal(feature.type, DEVICE_FEATURE_TYPES.TEXT.SELECT);
  assert.equal(feature.readOnly, false);
  assert.equal(feature.keepHistory, false);
  assert.deepEqual(feature.supportedOptions, [
    { value: 'Normal', label: 'Normal' },
    { value: 'Engineering mode', label: 'Engineering mode' },
  ]);
  // No option: nothing Gladys could ever command.
  assert.deepEqual(describeEntity({ type: 'select', options: [] }), []);
  assert.deepEqual(describeEntity({ type: 'select' }), []);
});

test('a cover only gets a position slider when it supports positioning', () => {
  assert.deepEqual(
    describeEntity({ type: 'cover' }).map((f) => f.key),
    ['state'],
  );
  assert.deepEqual(
    describeEntity({ type: 'cover', supportsPosition: true }).map((f) => f.key),
    ['state', 'position'],
  );
});

test('a curtain uses the curtain category, a plain cover the shutter one', () => {
  assert.equal(
    describeEntity({ type: 'cover', deviceClass: 'curtain' })[0].category,
    DEVICE_FEATURE_CATEGORIES.CURTAIN,
  );
  assert.equal(describeEntity({ type: 'cover' })[0].category, DEVICE_FEATURE_CATEGORIES.SHUTTER);
});

test('a number entity honours the bounds declared in the YAML', () => {
  const [feature] = describeEntity({ type: 'number', minValue: 5, maxValue: 42 });
  assert.equal(feature.min, 5);
  assert.equal(feature.max, 42);
  assert.equal(feature.readOnly, false);
});

test('a siren and a valve are writable on/off features', () => {
  const [siren] = describeEntity({ type: 'siren' });
  assert.equal(siren.category, 'siren');
  assert.equal(siren.type, 'binary');
  assert.equal(siren.readOnly, false);
  const [valve] = describeEntity({ type: 'valve' });
  assert.equal(valve.category, 'switch');
  assert.equal(valve.readOnly, false);
});

test('a two-point climate gets no single setpoint it would ignore', () => {
  // heat_cool climates hold a low and a high setpoint; a slider bound to the
  // single target_temperature would read 0 and move nothing.
  const keys = (entity) => describeEntity(entity).map((feature) => feature.key);
  assert.deepEqual(keys({ type: 'climate', supportsCurrentTemperature: true }), [
    'target_temperature',
    'current_temperature',
  ]);
  assert.deepEqual(
    keys({
      type: 'climate',
      supportsCurrentTemperature: true,
      supportsTwoPointTargetTemperature: true,
    }),
    ['current_temperature'],
  );
});

test('an entity type Gladys cannot represent is left out of discovery', () => {
  // Publishing a feature that could never work is worse than not showing it.
  assert.deepEqual(describeEntity({ type: 'media_player' }), []);
  assert.deepEqual(describeEntity({ type: 'camera' }), []);
});

test('every category/type pair the mapping can emit exists in the Gladys front', () => {
  // The Gladys front resolves a feature label through
  // `deviceFeatureCategory.<category>.<type>`; a pair missing from that
  // dictionary renders an empty label in the UI. The dictionary is not
  // shipped with the integration, so this test pins the pairs it produces
  // against the list verified against the core at the time of writing.
  const allowed = new Set([
    'temperature-sensor/decimal',
    'device-temperature-sensor/decimal',
    'humidity-sensor/decimal',
    'pressure-sensor/decimal',
    'light-sensor/decimal',
    'battery/integer',
    'signal/integer',
    'co2-sensor/decimal',
    'pm25-sensor/decimal',
    'pm10-sensor/decimal',
    'voc-sensor/decimal',
    'airquality-sensor/aqi',
    'distance-sensor/decimal',
    'soil-moisture-sensor/decimal',
    'ph-sensor/decimal',
    'precipitation-sensor/decimal',
    'noise-sensor/integer',
    'speed-sensor/decimal',
    'duration/decimal',
    'data/size',
    'datarate/rate',
    'energy-sensor/power',
    'energy-sensor/energy',
    'energy-sensor/voltage',
    'energy-sensor/current',
    'motion-sensor/binary',
    'presence-sensor/binary',
    'opening-sensor/binary',
    'smoke-sensor/binary',
    'co-sensor/binary',
    'leak-sensor/binary',
    'vibration-sensor/binary',
    'tamper/binary',
    'battery-low/binary',
    'lock/binary',
    'switch/binary',
    'button/push',
    'light/binary',
    'light/brightness',
    'light/color',
    'light/temperature',
    'shutter/state',
    'shutter/position',
    'curtain/state',
    'curtain/position',
    'fan/speed',
    'thermostat/target-temperature',
    'air-conditioning/binary',
    'air-conditioning/mode',
    'air-conditioning/fan-speed',
    'air-conditioning/swing-vertical',
    'air-conditioning/swing-horizontal',
    'text/text',
    'text/select',
    'angle-sensor/integer',
    'counter-sensor/integer',
    'siren/binary',
    'unknown/unknown',
  ]);

  // Exercise the mapping across every branch it can take.
  const entities = [
    ...Object.keys(SENSOR_DEVICE_CLASSES).map((deviceClass) => ({ type: 'sensor', deviceClass })),
    { type: 'sensor', deviceClass: 'temperature', entityCategory: 2 },
    { type: 'sensor' },
    { type: 'sensor', unitOfMeasurement: '°', accuracyDecimals: 1 },
    { type: 'sensor', accuracyDecimals: 0 },
    { type: 'sensor', stateClass: 4 },
    { type: 'sensor', stateClass: 2 },
    ...BINARY_DEVICE_CLASSES.map((deviceClass) => ({ type: 'binary_sensor', deviceClass })),
    { type: 'binary_sensor' },
    { type: 'text_sensor' },
    { type: 'text' },
    { type: 'switch' },
    { type: 'button' },
    { type: 'light', supportedColorModes: [47] },
    { type: 'cover', supportsPosition: true },
    { type: 'cover', deviceClass: 'curtain', supportsPosition: true },
    { type: 'lock' },
    { type: 'fan', supportsSpeed: true },
    { type: 'climate', supportsCurrentTemperature: true },
    {
      type: 'climate',
      supportedModes: [0, 1, 2, 3, 4, 5, 6],
      supportedFanModes: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
      supportedSwingModes: [0, 1, 2, 3],
    },
    { type: 'select', options: ['Low', 'High'] },
    { type: 'number' },
    { type: 'siren' },
    { type: 'valve' },
  ];

  for (const entity of entities) {
    for (const feature of describeEntity(entity)) {
      const pair = `${feature.category}/${feature.type}`;
      assert.ok(
        allowed.has(pair),
        `${entity.type}/${entity.deviceClass ?? '-'} produced the unknown pair "${pair}"`,
      );
    }
  }
});

// The device_classes the mapping handles, mirrored from mapping.js so the test
// above walks every branch rather than a sample.
const SENSOR_DEVICE_CLASSES = {
  temperature: 1,
  humidity: 1,
  pressure: 1,
  atmospheric_pressure: 1,
  illuminance: 1,
  battery: 1,
  signal_strength: 1,
  carbon_dioxide: 1,
  carbon_monoxide: 1,
  pm25: 1,
  pm10: 1,
  volatile_organic_compounds: 1,
  volatile_organic_compounds_parts: 1,
  aqi: 1,
  distance: 1,
  moisture: 1,
  ph: 1,
  precipitation: 1,
  precipitation_intensity: 1,
  sound_pressure: 1,
  speed: 1,
  wind_speed: 1,
  duration: 1,
  data_size: 1,
  data_rate: 1,
  power: 1,
  energy: 1,
  voltage: 1,
  current: 1,
};

const BINARY_DEVICE_CLASSES = [
  'motion',
  'occupancy',
  'presence',
  'door',
  'garage_door',
  'window',
  'opening',
  'smoke',
  'gas',
  'carbon_monoxide',
  'moisture',
  'vibration',
  'tamper',
  'battery',
  'light',
  'sound',
  'lock',
];

test('the mapping table covers the device_classes this test walks', () => {
  // Guards against the two lists above drifting from mapping.js: a device_class
  // removed there would silently stop being exercised.
  const source = readFileSync(new URL('../src/esphome/mapping.js', import.meta.url), 'utf8');
  for (const deviceClass of Object.keys(SENSOR_DEVICE_CLASSES)) {
    assert.ok(source.includes(`${deviceClass}:`), `${deviceClass} is no longer in mapping.js`);
  }
});

test('a text entity is writable, unlike the read-only text_sensor', () => {
  // ESPHome has two text types and the difference is the whole point here:
  // `text_sensor` reports, `text` accepts. Only the second one lets Gladys
  // push a line to a node (a message an e-ink `display:` lambda renders).
  const [sensor] = describeEntity({ type: 'text_sensor' });
  const [input] = describeEntity({ type: 'text' });

  assert.equal(sensor.readOnly, true);
  assert.equal(input.readOnly, false);
  // Both land on the same Gladys pair: the direction is what differs.
  assert.equal(input.category, sensor.category);
  assert.equal(input.type, sensor.type);
  assert.equal(input.key, 'state');
});
