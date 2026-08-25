import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DEVICE_FEATURE_CATEGORIES, DEVICE_FEATURE_TYPES } from '@gladysassistant/integration-sdk';
import { describeEntity, mapSensor, mapBinarySensor, mapUnit } from '../src/esphome/mapping.js';

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
  assert.equal(
    mapBinarySensor({ deviceClass: 'occupancy' }).type,
    DEVICE_FEATURE_TYPES.SENSOR.PUSH,
  );
  assert.equal(mapBinarySensor({ deviceClass: 'lock' }).type, DEVICE_FEATURE_TYPES.LOCK.BINARY);
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
    'presence-sensor/push',
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
    'text/text',
    'angle-sensor/integer',
    'counter-sensor/integer',
    'unknown/unknown',
  ]);

  // Exercise the mapping across every branch it can take.
  const entities = [
    ...Object.keys(SENSOR_DEVICE_CLASSES).map((deviceClass) => ({ type: 'sensor', deviceClass })),
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
    { type: 'number' },
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
