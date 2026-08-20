import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseMdnsResult,
  parseFeatureExternalId,
  parseDeviceExternalId,
  buildDevice,
  discoverNodes,
  publishEntityState,
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

  // The light exposes brightness too, but the user only created the state
  // feature: publishing the rest would be rejected.
  assert.deepEqual(gladys.published.states, [
    { device_feature_external_id: `${deviceExternalId}:light-lamp:state`, state: 1 },
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
