import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EsphomeManager } from '../src/esphome/EsphomeManager.js';

/**
 * Install a fake client under a given name, as connect() would.
 * @param {EsphomeManager} manager - The manager under test.
 * @param {string} name - The name to file the connection under.
 * @returns {object} The fake client.
 */
function attach(manager, name) {
  const client = { disconnected: false, disconnect: () => (client.disconnected = true) };
  const key = name.toLowerCase();
  manager.clients.set(key, client);
  manager.addresses.set(key, { host: '192.168.1.42', port: 6053 });
  manager.entityKeys.set(key, new Map([[1, { id: 'switch-relay' }]]));
  manager.nodeNames.set(client, name);
  return client;
}

test('a node reached by address is re-filed under the name it reports', () => {
  // Without this, its states would be published under "192.168.1.42" while its
  // Gladys device lives under "salon", and its commands would find no client.
  const manager = new EsphomeManager();
  const client = attach(manager, '192.168.1.42');

  manager.rename('192.168.1.42', 'salon');

  assert.equal(manager.getClient('salon'), client);
  assert.equal(manager.getClient('192.168.1.42'), undefined);
  assert.ok(manager.entityByKey('salon', 1), 'the entity index follows the rename');
  assert.equal(manager.nodeNames.get(client), 'salon');
});

test('renaming to the same name is a no-op', () => {
  const manager = new EsphomeManager();
  const client = attach(manager, 'salon');
  manager.rename('salon', 'Salon');
  assert.equal(manager.getClient('salon'), client);
});

test('a node found by the scan AND declared by hand drops its duplicate', () => {
  // Both entries resolve to the same physical node; keeping two sessions open
  // would waste one of the limited API slots the firmware offers.
  const manager = new EsphomeManager();
  const first = attach(manager, 'salon');
  const duplicate = attach(manager, '192.168.1.42');

  manager.rename('192.168.1.42', 'salon');

  assert.equal(manager.getClient('salon'), first, 'the first connection is kept');
  assert.equal(manager.getClient('192.168.1.42'), undefined);
  assert.equal(duplicate.disconnected, true, 'the duplicate is disconnected');
});

test('renaming an unknown node does nothing rather than throwing', () => {
  const manager = new EsphomeManager();
  assert.doesNotThrow(() => manager.rename('ghost', 'salon'));
});

test('a state event for an unindexed entity key resolves to nothing', () => {
  const manager = new EsphomeManager();
  attach(manager, 'salon');
  assert.equal(manager.entityByKey('salon', 999), undefined);
  assert.equal(manager.entityByKey('unknown-node', 1), undefined);
});

test('a command towards a disconnected node fails loudly', () => {
  // Silently dropping it would leave the user staring at a switch that does
  // nothing, with no clue why.
  const manager = new EsphomeManager();
  assert.throws(
    () => manager.command('salon', 'switch', 'relay', { state: true }),
    /not connected/,
  );
});
