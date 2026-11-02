import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createNodeKeys, NodeKeyError, maskKey } from '../src/nodeKeys.js';

const KEY_A = 'kBv1s2f9xQm4ZtAbCdEfGhIjKlMnOpQrStUvWxYz0+/=';
const KEY_B = '9xQm4ZtkBv1s2fAbCdEfGhIjKlMnOpQrStUvWxYz0+/=';

/**
 * A Gladys that keeps its configuration in memory and merges setConfig the
 * way the core does (partial merge).
 * @param {object} config - The stored configuration.
 * @returns {object} `{ getConfig, setConfig, config, writes }`.
 */
function memoryGladys(config = {}) {
  const writes = [];
  return {
    config,
    writes,
    getConfig: async () => ({ ...config }),
    setConfig: async (partial) => {
      writes.push(partial);
      Object.assign(config, partial);
    },
  };
}

test('set adds one node and keeps the others', async () => {
  const gladys = memoryGladys({ node_keys: JSON.stringify({ garage: KEY_A }) });
  const name = await createNodeKeys(gladys).set(' Salon ', KEY_B);
  assert.equal(name, 'salon');
  assert.deepEqual(JSON.parse(gladys.config.node_keys), { garage: KEY_A, salon: KEY_B });
  // Nothing typed in the form field: it is not written.
  assert.deepEqual(Object.keys(gladys.writes[0]), ['node_keys']);
});

test('a write folds the keys of the form field into the registry and empties it', async () => {
  const gladys = memoryGladys({ encryption_keys: `salon|${KEY_A} cuisine|${KEY_A}` });
  await createNodeKeys(gladys).set('cuisine', KEY_B);
  assert.deepEqual(JSON.parse(gladys.config.node_keys), { salon: KEY_A, cuisine: KEY_B });
  assert.equal(gladys.config.encryption_keys, '');
});

test('remove drops the key, even one only typed in the form field', async () => {
  const gladys = memoryGladys({
    node_keys: JSON.stringify({ garage: KEY_A }),
    encryption_keys: `salon|${KEY_B}`,
  });
  const keys = createNodeKeys(gladys);
  assert.deepEqual(await keys.remove('salon'), { name: 'salon', removed: true });
  assert.deepEqual(JSON.parse(gladys.config.node_keys), { garage: KEY_A });
  assert.equal(gladys.config.encryption_keys, '');
});

test('removing a node without a key saves nothing', async () => {
  const gladys = memoryGladys({ node_keys: JSON.stringify({ garage: KEY_A }) });
  assert.deepEqual(await createNodeKeys(gladys).remove('salon'), {
    name: 'salon',
    removed: false,
  });
  assert.equal(gladys.writes.length, 0);
});

test('two quick changes are both kept', async () => {
  const gladys = memoryGladys();
  const keys = createNodeKeys(gladys);
  await Promise.all([keys.set('salon', KEY_A), keys.set('cuisine', KEY_B)]);
  assert.deepEqual(JSON.parse(gladys.config.node_keys), { salon: KEY_A, cuisine: KEY_B });
});

test('a malformed node or key is refused before anything is saved', async () => {
  const gladys = memoryGladys();
  const keys = createNodeKeys(gladys);
  await assert.rejects(
    keys.set('mon salon', KEY_A),
    (e) => e instanceof NodeKeyError && e.code === 'invalid_node',
  );
  await assert.rejects(keys.set('salon', `salon|${KEY_A}`), (e) => e.code === 'invalid_key');
  await assert.rejects(keys.remove(''), (e) => e.code === 'invalid_node');
  assert.equal(gladys.writes.length, 0);
});

test('a failed save rejects, and the next change still runs', async () => {
  const gladys = memoryGladys();
  const setConfig = gladys.setConfig;
  gladys.setConfig = async () => {
    throw new Error('Gladys unreachable');
  };
  const keys = createNodeKeys(gladys);
  await assert.rejects(keys.set('salon', KEY_A), /Gladys unreachable/);
  gladys.setConfig = setConfig;
  await keys.set('cuisine', KEY_B);
  assert.deepEqual(JSON.parse(gladys.config.node_keys), { cuisine: KEY_B });
});

test('maskKey keeps too little of a key to reuse it', () => {
  assert.equal(maskKey(KEY_A), 'kBv1…=');
});
