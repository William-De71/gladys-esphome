// -----------------------------------------------------------------------------
// The handlers of src/app.js, driven by the fake Gladys of the SDK: the real
// GladysIntegration with an in-memory Gladys, so the payloads are checked the
// way the core checks them. The ESPHome nodes are a fake manager; nothing
// touches the network.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { createApp } from '../src/app.js';

const manifest = JSON.parse(
  readFileSync(new URL('../gladys-assistant-integration.json', import.meta.url), 'utf8'),
);

const RELAY = { key: 1, type: 'switch', objectId: 'relay', id: 'switch-relay', name: 'Relay' };
const TEMPERATURE = {
  key: 2,
  type: 'sensor',
  objectId: 'temperature',
  id: 'sensor-temperature',
  name: 'Temperature',
  deviceClass: 'temperature',
  unitOfMeasurement: '°C',
};
const BUTTON = {
  key: 3,
  type: 'event',
  objectId: 'button',
  id: 'event-button',
  name: 'Button',
  eventTypes: ['single', 'double'],
};
const BEEP = { key: 10, name: 'beep', args: [{ name: 'times', type: 1 }] };

/**
 * A stand-in for the EsphomeManager: one node "salon" at 192.168.1.42, with a
 * relay, a temperature, a button event entity and one user-defined action.
 */
class FakeManager {
  constructor() {
    this.clients = new Map();
    this.addresses = new Map();
    this.states = new Map();
    this.ran = [];
    this.online = true;
  }

  onState(callback) {
    this.stateCallback = callback;
  }

  onConnectionChange(callback) {
    this.connectionCallback = callback;
  }

  async connect(node) {
    if (!this.online) {
      throw new Error('connect ECONNREFUSED');
    }
    const client = { deviceInfo: () => ({ name: 'salon', friendlyName: 'Salon' }) };
    this.clients.set('salon', client);
    this.addresses.set('salon', { host: node.host, port: node.port || 6053 });
    this.connectionCallback('salon', true);
    return client;
  }

  getClient(name) {
    return this.clients.get(String(name).toLowerCase());
  }

  listEntities(name) {
    return this.getClient(name) ? [RELAY, TEMPERATURE, BUTTON] : [];
  }

  lastStatesOf() {
    return [...this.states.values()];
  }

  runAction(name, action, values) {
    if (!this.getClient(name)) {
      throw new Error(`ESPHome node "${name}" is not connected`);
    }
    if (action !== BEEP.name) {
      throw new Error(`ESPHome node "${name}" declares no action "${action}"`);
    }
    this.ran.push({ name, action, values });
    return BEEP;
  }

  async disconnectAll() {
    this.clients.clear();
  }

  /** A node pushes a state or an event, as the real manager would relay it. */
  push(entity, event) {
    if (entity.type !== 'event') {
      this.states.set(entity.key, { entity, event });
    }
    this.stateCallback('salon', entity, event);
  }

  /** The node drops or comes back. */
  drop() {
    this.connectionCallback('salon', false);
  }

  back() {
    this.connectionCallback('salon', true);
  }
}

const settle = (ms = 300) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * A connected fake Gladys running the integration, its node found by mDNS.
 * @param {object} [options] - `devices` the user created, scene event delays.
 * @returns {Promise<{ gladys: object, manager: FakeManager, app: object }>} The parts.
 */
async function start({ devices = [], sceneEvents = { graceMs: 50, quietMs: 100 } } = {}) {
  const gladys = createFakeGladys({
    selector: 'ext-esphome',
    devices,
    scanResults: {
      mdns: [{ name: 'salon._esphomelib._tcp.local', addresses: ['192.168.1.42'], port: 6053 }],
    },
  });
  const manager = new FakeManager();
  const app = createApp(gladys, { manager, sceneEvents });
  await gladys.connect();
  await settle(50);
  return { gladys, manager, app };
}

/** The device the discovery published, as the user would create it. */
function createdDevice(gladys) {
  const [device] = gladys.fake.discoveredDevices;
  return { ...device, id: 'device-1', selector: 'salon' };
}

test('the node found by the scan is published, and the integration reports itself connected', async () => {
  const { gladys, app } = await start();
  const [device] = gladys.fake.discoveredDevices;
  assert.equal(device.external_id, 'ext:ext-esphome:esphome:salon');
  assert.deepEqual(
    device.features.map((feature) => feature.external_id),
    [
      'ext:ext-esphome:esphome:salon:switch-relay:state',
      'ext:ext-esphome:esphome:salon:sensor-temperature:state',
    ],
  );
  assert.deepEqual(gladys.fake.connectionStatus, { connected: true });
  await app.shutdown();
});

test('a device created after its node reported gets the states it missed, and its transport', async () => {
  // ESPHome only pushes a CHANGE: a relay ON before the device existed would
  // otherwise stay blank until it moves.
  const { gladys, manager, app } = await start();
  manager.push(RELAY, { key: 1, state: true });
  manager.push(TEMPERATURE, { key: 2, state: 21.5 });
  await settle();
  assert.deepEqual(gladys.fake.states, [], 'nothing published before the device exists');

  await gladys.fake.deviceCreated(createdDevice(gladys));
  await settle();
  assert.equal(gladys.fake.lastState('ext:ext-esphome:esphome:salon:switch-relay:state'), 1);
  assert.equal(
    gladys.fake.lastState('ext:ext-esphome:esphome:salon:sensor-temperature:state'),
    21.5,
  );
  assert.deepEqual(gladys.fake.transports.at(-1), {
    device_external_id: 'ext:ext-esphome:esphome:salon',
    transport: 'local',
  });
  await app.shutdown();
});

test('a reading that did not change is not published again', async () => {
  const { gladys, manager, app } = await start();
  const device = createdDevice(gladys);
  await gladys.fake.deviceCreated(device);
  manager.push(TEMPERATURE, { key: 2, state: 21.5 });
  await settle();
  manager.push(TEMPERATURE, { key: 2, state: 21.5 });
  await settle();
  manager.push(TEMPERATURE, { key: 2, state: 21.6 });
  await settle();
  const values = gladys.fake.states
    .filter((state) => state.device_feature_external_id.endsWith('sensor-temperature:state'))
    .map((state) => state.state);
  assert.deepEqual(values, [21.5, 21.6]);
  await app.shutdown();
});

test('an ESPHome event fires event_fired with flat, declared data, and publishes no state', async () => {
  const { gladys, manager, app } = await start();
  manager.push(BUTTON, { key: 3, eventType: 'double' });
  await settle(20);
  assert.deepEqual(gladys.fake.sceneEvents, [
    {
      key: 'event_fired',
      data: { node: 'salon', entity: 'Button', entity_id: 'button', event_type: 'double' },
    },
  ]);
  const trigger = manifest.scene_triggers.find((entry) => entry.key === 'event_fired');
  const declared = trigger.variables.map((variable) => variable.key);
  assert.deepEqual(Object.keys(gladys.fake.sceneEvents[0].data).sort(), [...declared].sort());
  for (const field of trigger.fields) {
    assert.ok(declared.includes(field.key), `filter ${field.key} has its value in the event`);
  }
  assert.deepEqual(gladys.fake.states, []);
  await app.shutdown();
});

test('a node down past the grace period fires node_offline once, then node_online when back', async () => {
  const { gladys, manager, app } = await start();
  manager.drop();
  manager.drop();
  await settle(120);
  manager.back();
  await settle(20);
  assert.deepEqual(
    gladys.fake.sceneEvents.map((event) => event.key),
    ['node_offline', 'node_online'],
  );
  assert.deepEqual(gladys.fake.sceneEvents[0].data, {
    node: 'salon',
    address: '192.168.1.42:6053',
  });
  assert.equal(gladys.fake.sceneEvents[1].data.offline_minutes, 0);
  await app.shutdown();
});

test('a node back within the grace period (a reboot, an OTA update) fires nothing', async () => {
  const { gladys, manager, app } = await start();
  manager.drop();
  await settle(10);
  manager.back();
  await settle(120);
  assert.deepEqual(gladys.fake.sceneEvents, []);
  await app.shutdown();
});

test('run_action runs the user-defined action and returns its outputs', async () => {
  const { gladys, manager, app } = await start();
  const ack = await gladys.fake.sceneAction('run_action', {
    node: 'salon',
    action: 'beep',
    arguments: '{"times": 3}',
  });
  assert.equal(ack.success, true);
  assert.deepEqual(ack.data.outputs, { node: 'salon', action: 'beep' });
  assert.deepEqual(manager.ran, [{ name: 'salon', action: 'beep', values: { times: 3 } }]);
  const declared = manifest.scene_actions[0].outputs.map((output) => output.key);
  assert.deepEqual(Object.keys(ack.data.outputs).sort(), [...declared].sort());
  await app.shutdown();
});

test('run_action finds the node by the name of its device in Gladys', async () => {
  const { gladys, manager, app } = await start();
  await gladys.fake.deviceCreated(createdDevice(gladys));
  const ack = await gladys.fake.sceneAction('run_action', {
    node: 'SALON',
    action: 'beep',
    arguments: '{"times": 1}',
  });
  assert.equal(ack.success, true);
  assert.equal(manager.ran[0].name, 'SALON');
  await app.shutdown();
});

test('run_action fails clearly on an unknown action or bad arguments', async () => {
  const { gladys, app } = await start();
  const unknown = await gladys.fake.sceneAction('run_action', { node: 'salon', action: 'nope' });
  assert.equal(unknown.success, false);
  const badJson = await gladys.fake.sceneAction('run_action', {
    node: 'salon',
    action: 'beep',
    arguments: 'times=3',
  });
  assert.equal(badJson.success, false);
  await app.shutdown();
});

test('an event the action fires on its own node does not start a scene again (no loop)', async () => {
  const { gladys, manager, app } = await start();
  await gladys.fake.sceneAction('run_action', {
    node: 'salon',
    action: 'beep',
    arguments: '{"times": 1}',
  });
  manager.push(BUTTON, { key: 3, eventType: 'single' });
  await settle(150);
  manager.push(BUTTON, { key: 3, eventType: 'single' });
  await settle(20);
  assert.equal(gladys.fake.sceneEvents.length, 1, 'only the event after the quiet window');
  await app.shutdown();
});

test('every scene trigger and action of the manifest has its handler', async () => {
  const { app } = await start();
  assert.deepEqual(manifest.scene_triggers.map((trigger) => trigger.key).sort(), [
    'event_fired',
    'node_offline',
    'node_online',
  ]);
  assert.deepEqual(
    manifest.scene_actions.map((action) => action.key),
    ['run_action'],
  );
  await app.shutdown();
});
