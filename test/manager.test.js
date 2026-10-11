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
  const client = {
    disconnected: false,
    disconnect: () => (client.disconnected = true),
    getEntitiesWithIds: () => [{ key: 1, id: 'switch-relay' }],
  };
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

  const survivor = manager.rename('192.168.1.42', 'salon');

  assert.equal(survivor, first, 'rename hands back the connection that stays');
  assert.equal(manager.getClient('salon'), first, 'the first connection is kept');
  assert.equal(manager.getClient('192.168.1.42'), undefined);
  assert.equal(duplicate.disconnected, true, 'the duplicate is disconnected');
});

test('renaming an unknown node does nothing rather than throwing', () => {
  const manager = new EsphomeManager();
  assert.doesNotThrow(() => manager.rename('ghost', 'salon'));
});

test('an entity key missing from the index is looked up again before giving up', () => {
  // The client may have re-listed a reflashed node since our last snapshot.
  const manager = new EsphomeManager();
  attach(manager, 'salon');
  manager.entityKeys.set('salon', new Map());
  assert.equal(manager.entityByKey('salon', 1).id, 'switch-relay');
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

test('concurrent connects to one node share a single attempt', async () => {
  // The watchdog, a scan and a poll can ask for the same node at once; each
  // opening its own socket would burn the node's handful of API slots.
  const manager = new EsphomeManager();
  let opened = 0;
  let release;
  const fake = { id: 'client' };
  manager.open = () => {
    opened += 1;
    return new Promise((resolve) => {
      release = () => resolve(fake);
    });
  };
  const node = { name: 'salon', host: '192.168.1.42' };
  const first = manager.connect(node, null, 10);
  const second = manager.connect(node, null, 10);
  release();
  assert.equal(await first, fake);
  assert.equal(await second, fake);
  assert.equal(opened, 1, 'only one socket was opened');
  assert.equal(manager.pending.size, 0, 'the attempt is forgotten once settled');
});

test('a failed attempt is forgotten, so the next connect retries', async () => {
  const manager = new EsphomeManager();
  let opened = 0;
  manager.open = async () => {
    opened += 1;
    throw new Error('refused');
  };
  const node = { name: 'salon', host: '192.168.1.42' };
  await assert.rejects(manager.connect(node, null, 10), /refused/);
  await assert.rejects(manager.connect(node, null, 10), /refused/);
  assert.equal(opened, 2);
});
