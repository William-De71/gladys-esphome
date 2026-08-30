import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseMdnsResult,
  parseFeatureExternalId,
  parseDeviceExternalId,
  buildDevice,
  discoverNodes,
  publishEntityState,
  flushStates,
  buildDiscoveredDevices,
} from '../src/devices.js';
import { normalizeConfig } from '../src/config.js';
import { fakeGladys } from './helpers/fakeGladys.js';

test('an mDNS result yields the node name and a routable IPv4', () => {
  const node = parseMdnsResult({
    name: 'salon._esphomelib._tcp.local',
    addresses: ['192.168.1.42'],
    port: 6053,
  });
  assert.deepEqual(node, { name: 'salon', host: '192.168.1.42', port: 6053 });
});

test('a node name containing a dot survives the service-suffix strip', () => {
  // A plain split('.') would truncate this to "salon".
  const node = parseMdnsResult({
    name: 'salon.bas._esphomelib._tcp.local.',
    addresses: ['192.168.1.9'],
  });
  assert.equal(node.name, 'salon.bas');
});

test('an IPv6-only responder is skipped rather than published unusable', () => {
  const node = parseMdnsResult({ name: 'salon._esphomelib._tcp.local', addresses: ['fe80::1'] });
  assert.equal(node, null);
});

test('an IPv4 is preferred over the mDNS hostname the container cannot resolve', () => {
  const node = parseMdnsResult({
    name: 'salon._esphomelib._tcp.local',
    addresses: ['192.168.1.42'],
    host: 'salon.local',
  });
  assert.equal(node.host, '192.168.1.42');
});

test('a failing mDNS scan still yields the manually declared nodes', async () => {
  // A Gladys without mediated discovery must not make the integration useless.
  const gladys = fakeGladys({ scanResults: new Error('not supported') });
  const config = normalizeConfig({ nodes: '192.168.1.50:6054' });
  const nodes = await discoverNodes(gladys, config);
  assert.deepEqual(nodes, [{ name: '192.168.1.50', host: '192.168.1.50', port: 6054 }]);
});

test('a feature external id round-trips through its ESPHome coordinates', () => {
  const gladys = fakeGladys();
  const parsed = parseFeatureExternalId(
    gladys,
    'ext:ext-dev-esphome:esphome:salon:light-lamp:brightness',
  );
  assert.deepEqual(parsed, {
    nodeName: 'salon',
    entityType: 'light',
    objectId: 'lamp',
    featureKey: 'brightness',
  });
});

test('dashes in the node name and the object id do not break the parsing', () => {
  // Splitting from the left would read the node as "salon" and lose "bas".
  const gladys = fakeGladys();
  const parsed = parseFeatureExternalId(
    gladys,
    'ext:ext-dev-esphome:esphome:salon-bas:cover-volet-1:position',
  );
  assert.equal(parsed.nodeName, 'salon-bas');
  assert.equal(parsed.entityType, 'cover');
  assert.equal(parsed.objectId, 'volet-1');
});

test('an external id from another integration is rejected, not misparsed', () => {
  const gladys = fakeGladys();
  assert.throws(() => parseFeatureExternalId(gladys, 'ext:other:zigbee:0x00158d:state'));
  assert.throws(() => parseDeviceExternalId(gladys, 'ext:other:zigbee:0x00158d'));
});

test('a device carries one feature per usable entity dimension', () => {
  const gladys = fakeGladys();
  const device = buildDevice(
    gladys,
    { name: 'salon', host: '192.168.1.42', port: 6053 },
    [
      {
        id: 'sensor-temperature',
        type: 'sensor',
        name: 'Temperature',
        objectId: 'temperature',
        deviceClass: 'temperature',
        unitOfMeasurement: '°C',
      },
      {
        id: 'light-lamp',
        type: 'light',
        name: 'Lamp',
        objectId: 'lamp',
        supportedColorModes: [35],
      },
    ],
    { friendlyName: 'Living room', esphomeVersion: '2025.10.1' },
  );

  assert.equal(device.name, 'Living room');
  assert.equal(device.external_id, 'ext:ext-dev-esphome:esphome:salon');
  assert.deepEqual(
    device.features.map((f) => f.external_id),
    [
      'ext:ext-dev-esphome:esphome:salon:sensor-temperature:state',
      'ext:ext-dev-esphome:esphome:salon:light-lamp:state',
      'ext:ext-dev-esphome:esphome:salon:light-lamp:brightness',
      'ext:ext-dev-esphome:esphome:salon:light-lamp:color',
    ],
  );
  // The address is kept as a param so a reconnection needs no fresh scan.
  assert.ok(device.params.some((p) => p.name === 'ADDRESS' && p.value === '192.168.1.42:6053'));
});

test('a pushed state reaches only the features the user actually created', async () => {
  // The core rejects a state addressed to an unknown external id.
  const deviceExternalId = 'ext:ext-dev-esphome:esphome:salon';
  const gladys = fakeGladys({
    devices: [
      {
        external_id: deviceExternalId,
        features: [{ external_id: `${deviceExternalId}:light-lamp:state` }],
      },
    ],
  });

  const entity = { id: 'light-lamp', type: 'light', objectId: 'lamp', supportedColorModes: [35] };
  await publishEntityState(gladys, 'salon', entity, { state: true, brightness: 0.5 });
  // States are batched over a short window: close it before asserting.
  await flushStates(gladys);

  // The light exposes brightness too, but the user only created the state
  // feature: publishing the rest would be rejected.
  assert.deepEqual(gladys.published.states, [
    { device_feature_external_id: `${deviceExternalId}:light-lamp:state`, state: 1 },
  ]);
});

test('states pushed in the same window leave in ONE request', async () => {
  // ESPHome pushes one event per entity. Publishing each on arrival meant one
  // HTTP call per entity, which exhausted the core rate limit ("Too Many
  // Requests") on a node reporting many entities at once.
  const deviceExternalId = 'ext:ext-dev-esphome:esphome:salon';
  const gladys = fakeGladys({
    devices: [
      {
        external_id: deviceExternalId,
        features: [
          { external_id: `${deviceExternalId}:sensor-angle:state` },
          { external_id: `${deviceExternalId}:sensor-count:state` },
        ],
      },
    ],
  });

  let requests = 0;
  const publishStates = gladys.publishStates;
  gladys.publishStates = async (states) => {
    requests += 1;
    return publishStates(states);
  };

  const angle = { id: 'sensor-angle', type: 'sensor', objectId: 'angle' };
  const count = { id: 'sensor-count', type: 'sensor', objectId: 'count' };
  await publishEntityState(gladys, 'salon', angle, { state: -11.8 });
  await publishEntityState(gladys, 'salon', count, { state: 1 });
  await flushStates(gladys);

  assert.equal(requests, 1);
  assert.deepEqual(gladys.published.states, [
    { device_feature_external_id: `${deviceExternalId}:sensor-angle:state`, state: -11.8 },
    { device_feature_external_id: `${deviceExternalId}:sensor-count:state`, state: 1 },
  ]);
});

test('a feature changing twice in one window is sent once, with its latest value', async () => {
  // The intermediate value is already stale when the window closes; history
  // keeps the reading that actually held.
  const deviceExternalId = 'ext:ext-dev-esphome:esphome:salon';
  const gladys = fakeGladys({
    devices: [
      {
        external_id: deviceExternalId,
        features: [{ external_id: `${deviceExternalId}:sensor-angle:state` }],
      },
    ],
  });

  const angle = { id: 'sensor-angle', type: 'sensor', objectId: 'angle' };
  await publishEntityState(gladys, 'salon', angle, { state: 1 });
  await publishEntityState(gladys, 'salon', angle, { state: 2 });
  await publishEntityState(gladys, 'salon', angle, { state: 3 });
  await flushStates(gladys);

  assert.deepEqual(gladys.published.states, [
    { device_feature_external_id: `${deviceExternalId}:sensor-angle:state`, state: 3 },
  ]);
});

test('a binary sensor toggling inside one window keeps its transitions', async () => {
  // An mmWave `has_moving_target` going 0 -> 1 -> 0 inside one flush window is
  // reporting a movement that HAPPENED. Collapsing it to its latest value would
  // publish 0 after 0: the feature never appears to change and no scene can
  // trigger on it.
  const deviceExternalId = 'ext:ext-dev-esphome:esphome:salon';
  const gladys = fakeGladys({
    devices: [
      {
        external_id: deviceExternalId,
        features: [{ external_id: `${deviceExternalId}:binary-motion:state` }],
      },
    ],
  });

  const motion = { id: 'binary-motion', type: 'binary_sensor', deviceClass: 'motion' };
  await publishEntityState(gladys, 'salon', motion, { state: false });
  await publishEntityState(gladys, 'salon', motion, { state: true });
  await publishEntityState(gladys, 'salon', motion, { state: false });
  await flushStates(gladys);

  assert.deepEqual(gladys.published.states, [
    { device_feature_external_id: `${deviceExternalId}:binary-motion:state`, state: 0 },
    { device_feature_external_id: `${deviceExternalId}:binary-motion:state`, state: 1 },
    { device_feature_external_id: `${deviceExternalId}:binary-motion:state`, state: 0 },
  ]);
});

test('a binary sensor republishing the same value is still collapsed', async () => {
  // Keeping transitions must not reopen the rate-limit hole: a node repeating
  // the same 1 every second carries no transition to preserve.
  const deviceExternalId = 'ext:ext-dev-esphome:esphome:salon';
  const gladys = fakeGladys({
    devices: [
      {
        external_id: deviceExternalId,
        features: [{ external_id: `${deviceExternalId}:binary-motion:state` }],
      },
    ],
  });

  const motion = { id: 'binary-motion', type: 'binary_sensor', deviceClass: 'motion' };
  await publishEntityState(gladys, 'salon', motion, { state: true });
  await publishEntityState(gladys, 'salon', motion, { state: true });
  await publishEntityState(gladys, 'salon', motion, { state: true });
  await flushStates(gladys);

  assert.deepEqual(gladys.published.states, [
    { device_feature_external_id: `${deviceExternalId}:binary-motion:state`, state: 1 },
  ]);
});

test('a batch the core rejects does not take the next states down with it', async () => {
  // Retrying into a rate limit makes it worse, and ESPHome pushes continuously:
  // the next event carries a fresher value than any replay would.
  const deviceExternalId = 'ext:ext-dev-esphome:esphome:salon';
  const gladys = fakeGladys({
    devices: [
      {
        external_id: deviceExternalId,
        features: [{ external_id: `${deviceExternalId}:sensor-angle:state` }],
      },
    ],
  });

  gladys.publishStates = async () => {
    throw new Error('Too Many Requests');
  };
  const angle = { id: 'sensor-angle', type: 'sensor', objectId: 'angle' };
  await publishEntityState(gladys, 'salon', angle, { state: 1 });
  await flushStates(gladys);

  // The failure is swallowed (logged, not thrown) and the buffer is drained, so
  // a later state still publishes normally.
  const published = [];
  gladys.publishStates = async (states) => published.push(...states);
  await publishEntityState(gladys, 'salon', angle, { state: 2 });
  await flushStates(gladys);

  assert.deepEqual(published, [
    { device_feature_external_id: `${deviceExternalId}:sensor-angle:state`, state: 2 },
  ]);
});

test('a state for a device the user never created publishes nothing', async () => {
  const gladys = fakeGladys({ devices: [] });
  await publishEntityState(
    gladys,
    'salon',
    { id: 'switch-relay', type: 'switch' },
    { state: true },
  );
  assert.deepEqual(gladys.published.states, []);
});

test('a reachable node with no entity is still published, not silently dropped', async () => {
  // The regression b3n.0 hit on real hardware: a freshly flashed node whose YAML
  // declares api/ota/wifi but no entity yet. The handshake succeeds, so hiding
  // the node made a working setup look exactly like a wrong key.
  const gladys = fakeGladys({
    scanResults: [
      { name: 'test-esphome._esphomelib._tcp.local', addresses: ['192.168.0.39'], port: 6053 },
    ],
  });
  const manager = {
    connect: async () => ({ deviceInfo: () => ({ name: 'test-esphome' }) }),
    listEntities: () => [],
  };

  const devices = await buildDiscoveredDevices(gladys, manager, normalizeConfig());

  assert.equal(devices.length, 1);
  assert.equal(devices[0].external_id, 'ext:ext-dev-esphome:esphome:test-esphome');
  assert.deepEqual(devices[0].features, []);
});
