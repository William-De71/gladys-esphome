import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeConfig,
  parseEncryptionKeys,
  parseNodes,
  resolveEncryptionKey,
  parseNodeKeys,
  normalizeNodeName,
  isValidEncryptionKey,
  DEFAULT_CONFIG,
} from '../src/config.js';

const KEY_A = 'kBv1s2f9xQm4ZtAbCdEfGhIjKlMnOpQrStUvWxYz0+/=';
const KEY_B = '9xQm4ZtkBv1s2fAbCdEfGhIjKlMnOpQrStUvWxYz0+/=';

test('normalizeConfig falls back to the manifest defaults', () => {
  const config = normalizeConfig();
  assert.equal(config.scan_duration, DEFAULT_CONFIG.scan_duration);
  assert.equal(config.connection_timeout, DEFAULT_CONFIG.connection_timeout);
  assert.equal(config.encryption_key, '');
  assert.deepEqual(config.encryption_keys, {});
  assert.deepEqual(config.nodes, []);
});

test('normalizeConfig forces the numeric types the form sends as strings', () => {
  const config = normalizeConfig({ scan_duration: '12', connection_timeout: '30' });
  assert.strictEqual(config.scan_duration, 12);
  assert.strictEqual(config.connection_timeout, 30);
});

test('parseEncryptionKeys reads one node|key pair per line', () => {
  const keys = parseEncryptionKeys('salon|aBc123=\ncuisine|XyZ789=');
  assert.deepEqual(keys, { salon: 'aBc123=', cuisine: 'XyZ789=' });
});

test('parseEncryptionKeys lower-cases the node so the lookup always matches', () => {
  // The mDNS scan reports the name as the firmware spells it; the user may have
  // typed it differently.
  const keys = parseEncryptionKeys('Salon|aBc123=');
  assert.deepEqual(keys, { salon: 'aBc123=' });
});

test('parseEncryptionKeys keeps a base64 key intact and ignores junk lines', () => {
  // A base64 key ends in "=" and may contain "+" and "/", but never "|", so
  // only the first separator splits.
  const keys = parseEncryptionKeys('  \nsalon|a+b/c=\nno-separator\n|orphan\nnode|\n');
  assert.deepEqual(keys, { salon: 'a+b/c=' });
});

test('parseEncryptionKeys reads the pairs the single-line input of Gladys leaves', () => {
  // Firefox turns the pasted line breaks into spaces; a user may also type
  // commas or semicolons. A base64 key contains none of them.
  const expected = { salon: KEY_A, cuisine: KEY_B };
  assert.deepEqual(parseEncryptionKeys(`salon|${KEY_A} cuisine|${KEY_B}`), expected);
  assert.deepEqual(parseEncryptionKeys(`salon|${KEY_A}, cuisine|${KEY_B}`), expected);
  assert.deepEqual(parseEncryptionKeys(`salon|${KEY_A};cuisine|${KEY_B};`), expected);
  assert.deepEqual(parseEncryptionKeys(`salon|${KEY_A}\r\ncuisine|${KEY_B}`), expected);
});

test('parseNodes accepts addresses separated by spaces, commas or semicolons', () => {
  assert.deepEqual(parseNodes('salon.local 192.168.1.42:6054, [fe80::1]:6053;cuisine.local'), [
    { host: 'salon.local', port: 6053 },
    { host: '192.168.1.42', port: 6054 },
    { host: '[fe80::1]', port: 6053 },
    { host: 'cuisine.local', port: 6053 },
  ]);
});

test('parseNodeKeys reads the registry, as JSON or as an object, and drops junk', () => {
  assert.deepEqual(parseNodeKeys(JSON.stringify({ Salon: KEY_A })), { salon: KEY_A });
  assert.deepEqual(parseNodeKeys({ salon: KEY_A, 'bad name': KEY_B, cuisine: 42 }), {
    salon: KEY_A,
  });
  assert.deepEqual(parseNodeKeys('not json'), {});
  assert.deepEqual(parseNodeKeys(['salon']), {});
  assert.deepEqual(parseNodeKeys(undefined), {});
});

test('the form field wins over the registry for the same node', () => {
  const config = normalizeConfig({
    node_keys: JSON.stringify({ salon: KEY_A, garage: KEY_A }),
    encryption_keys: `salon|${KEY_B}`,
  });
  assert.deepEqual(config.encryption_keys, { salon: KEY_B, garage: KEY_A });
});

test('normalizeNodeName and isValidEncryptionKey refuse what cannot be a node or a key', () => {
  assert.equal(normalizeNodeName(' Salon '), 'salon');
  assert.equal(normalizeNodeName('192.168.1.42'), '192.168.1.42');
  assert.equal(normalizeNodeName('mon salon'), null);
  assert.equal(normalizeNodeName('salon|x'), null);
  assert.equal(normalizeNodeName(''), null);
  assert.ok(isValidEncryptionKey(KEY_A));
  assert.ok(isValidEncryptionKey(` ${KEY_A} `));
  assert.ok(!isValidEncryptionKey('kBv1s2f...='));
  assert.ok(!isValidEncryptionKey(`salon|${KEY_A}`));
  assert.ok(!isValidEncryptionKey(undefined));
});

test('parseNodes accepts a bare host, an IP, and an explicit port', () => {
  const nodes = parseNodes('salon.local\n192.168.1.42\n192.168.1.43:6054');
  assert.deepEqual(nodes, [
    { host: 'salon.local', port: 6053 },
    { host: '192.168.1.42', port: 6053 },
    { host: '192.168.1.43', port: 6054 },
  ]);
});

test('parseNodes rejects an out-of-range port rather than connecting to it', () => {
  assert.deepEqual(parseNodes('192.168.1.42:99999'), []);
});

test('resolveEncryptionKey prefers the per-node key over the default one', () => {
  const config = normalizeConfig({
    encryption_key: 'default=',
    encryption_keys: 'salon|specific=',
  });
  assert.equal(resolveEncryptionKey(config, 'salon'), 'specific=');
  assert.equal(resolveEncryptionKey(config, 'kitchen'), 'default=');
});

test('resolveEncryptionKey reports no key at all, which means plaintext', () => {
  const config = normalizeConfig({});
  assert.equal(resolveEncryptionKey(config, 'salon'), null);
});
