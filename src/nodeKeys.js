// -----------------------------------------------------------------------------
// The per-node keys set with the configuration buttons.
//
// Stored through setConfig() under NODE_KEYS_KEY, a key outside the
// config_schema, as JSON. Each button changes ONE node and leaves the others
// alone — what the "Keys per node" secret field cannot do: Gladys never sends
// a stored secret back to the form, so saving it again replaces every key.
//
// A write, and every save of the form (fold), moves the keys typed in that
// field into the registry and empties it: the field then ADDS keys instead of
// replacing them, the two never disagree, and a removed key does not come
// back from the field. Writes are chained: two quick clicks never lose a key.
// -----------------------------------------------------------------------------

import {
  NODE_KEYS_KEY,
  normalizeNodeName,
  isValidEncryptionKey,
  parseEncryptionKeys,
  parseNodeKeys,
  unquote,
} from './config.js';

export class NodeKeyError extends Error {
  /**
   * @param {string} code - `invalid_node` or `invalid_key`.
   */
  constructor(code) {
    super(`ESPHome: ${code.replace('_', ' ')}`);
    this.code = code;
  }
}

/**
 * Hide a key in a listing, keeping enough of it to tell two keys apart.
 * @param {string} key - The encryption key.
 * @returns {string} Its first four characters and its last one.
 * @example
 * maskKey('kBv1s2f...='); // 'kBv1…='
 */
export function maskKey(key) {
  return `${key.slice(0, 4)}…${key.slice(-1)}`;
}

/**
 * Build the registry of per-node keys.
 * @param {object} gladys - The Gladys SDK instance (getConfig, setConfig).
 * @returns {object} `{ set, remove }`.
 * @example
 * const nodeKeys = createNodeKeys(gladys);
 * await nodeKeys.set('salon', 'kBv1s2f...=');
 */
export function createNodeKeys(gladys) {
  let writing = Promise.resolve();

  /**
   * Apply one change to the stored keys, once the previous change is saved.
   * @param {(keys: Record<string, string>) => boolean} change - Mutates the
   * keys, returns false when there is nothing to save.
   * @returns {Promise<boolean>} Whether something was saved.
   */
  function update(change) {
    const run = writing.then(async () => {
      // Read fresh: the user may have saved the form since the last write.
      const raw = (await gladys.getConfig()) || {};
      const fieldKeys = parseEncryptionKeys(raw.encryption_keys);
      const keys = { ...parseNodeKeys(raw[NODE_KEYS_KEY]), ...fieldKeys };
      const folded = typeof raw.encryption_keys === 'string' && raw.encryption_keys.trim() !== '';
      if (!change(keys) && !folded) {
        return false;
      }
      const partial = { [NODE_KEYS_KEY]: JSON.stringify(keys) };
      if (folded) {
        partial.encryption_keys = '';
      }
      await gladys.setConfig(partial);
      return true;
    });
    writing = run.catch(() => {});
    return run;
  }

  return {
    /**
     * Add or replace the key of a node.
     * @param {string} node - The node name or the address of a manual node.
     * @param {string} key - Its encryption key.
     * @returns {Promise<string>} The normalized node name.
     */
    async set(node, key) {
      const name = normalizeNodeName(node);
      if (!name) {
        throw new NodeKeyError('invalid_node');
      }
      if (!isValidEncryptionKey(key)) {
        throw new NodeKeyError('invalid_key');
      }
      const value = unquote(key);
      await update((keys) => {
        keys[name] = value;
        return true;
      });
      return name;
    },

    /**
     * Move the keys typed in the "Keys per node" field into the registry and
     * empty the field. Run on every save of the form: the field never shows
     * what it holds, so the next save would otherwise replace every key with
     * the one just typed — it now ADDS that key to the others.
     * @returns {Promise<boolean>} Whether keys were moved.
     */
    fold() {
      return update(() => false);
    },

    /**
     * Remove the key of a node, which then uses the default key again.
     * @param {string} node - The node name or the address of a manual node.
     * @returns {Promise<{ name: string, removed: boolean }>} Whether it had one.
     */
    async remove(node) {
      const name = normalizeNodeName(node);
      if (!name) {
        throw new NodeKeyError('invalid_node');
      }
      let removed = false;
      await update((keys) => {
        removed = name in keys;
        delete keys[name];
        return removed;
      });
      return { name, removed };
    },
  };
}
