import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeConfig,
  parseEncryptionKeys,
  parseNodes,
  resolveEncryptionKey,
  DEFAULT_CONFIG,
} from '../src/config.js';

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
