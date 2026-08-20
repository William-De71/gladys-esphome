// -----------------------------------------------------------------------------
// Integration configuration.
//
// The user-facing values come from the `config_schema` of the manifest; the SDK
// fetches them (`gladys.getConfig()`) and notifies changes through
// `gladys.onConfigUpdated()`.
//
// This module provides the defaults, normalizes the received object (a numeric
// field arrives as a string from the form), and parses the two free-text fields
// the manifest cannot express structurally: the per-node keys and the nodes
// added by hand.
// -----------------------------------------------------------------------------

import { DEFAULT_PORT } from './esphome/constants.js';

// Defaults: they MUST stay consistent with the `default` values declared in the
// `config_schema` of the manifest.
export const DEFAULT_CONFIG = {
  scan_duration: 8, // seconds, how long the mDNS scan listens
  connection_timeout: 10, // seconds, before giving up on a node
};

/**
 * Split a free-text field into trimmed, non-empty lines. Users paste from a
 * YAML file or a terminal, so both line endings and stray blank lines happen.
 * @param {unknown} raw - The raw field value.
 * @returns {string[]} The meaningful lines.
 * @example
 * splitLines('salon.local\n\n 192.168.1.42 '); // ['salon.local', '192.168.1.42']
 */
function splitLines(raw) {
  if (typeof raw !== 'string') {
    return [];
  }
  return raw
    .split(/[\r\n]+/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/**
 * Parse the "keys per node" field: one `node|key` pair per line. The node part
 * is lower-cased so a key entered as "Salon" still matches the node named
 * "salon" the scan reports.
 * @param {unknown} raw - The raw field value.
 * @returns {Record<string, string>} Keys indexed by lower-cased node name.
 * @example
 * parseEncryptionKeys('salon|abc=\nkitchen|def='); // { salon: 'abc=', kitchen: 'def=' }
 */
export function parseEncryptionKeys(raw) {
  /** @type {Record<string, string>} */
  const keys = {};
  splitLines(raw).forEach((line) => {
    // Only the FIRST separator splits: a base64 key never contains "|", but
    // splitting on all of them would silently truncate a malformed entry.
    const separator = line.indexOf('|');
    if (separator <= 0) {
      return;
    }
    const node = line.slice(0, separator).trim().toLowerCase();
    const key = line.slice(separator + 1).trim();
    if (node && key) {
      keys[node] = key;
    }
  });
  return keys;
}

/**
 * Parse the "nodes added by hand" field: one address per line, with an optional
 * `:port`. The node name is unknown at this point (only a connection reveals
 * it), so the address doubles as the name until the node answers.
 * @param {unknown} raw - The raw field value.
 * @returns {Array<{ host: string, port: number }>} The manual nodes.
 * @example
 * parseNodes('salon.local\n192.168.1.42:6053');
 */
export function parseNodes(raw) {
  return splitLines(raw)
    .map((line) => {
      // An IPv6 literal is written [::1]:6053, so only split on the LAST colon
      // and only when what follows is a port number.
      const match = /^(.*?)(?::(\d{1,5}))?$/.exec(line);
      if (!match) {
        return null;
      }
      const host = match[1].trim();
      if (!host) {
        return null;
      }
      const port = match[2] ? Number(match[2]) : DEFAULT_PORT;
      if (!Number.isInteger(port) || port < 1 || port > 65535) {
        return null;
      }
      return { host, port };
    })
    .filter((node) => node !== null);
}

/**
 * Merge the user config with the defaults, force the numeric types and parse
 * the free-text fields.
 * @param {Record<string, unknown>} [raw] - Config returned by the SDK.
 * @returns {object} The normalized configuration.
 * @example
 * const config = normalizeConfig(await gladys.getConfig());
 */
export function normalizeConfig(raw = {}) {
  return {
    ...DEFAULT_CONFIG,
    scan_duration: Number(raw.scan_duration ?? DEFAULT_CONFIG.scan_duration),
    connection_timeout: Number(raw.connection_timeout ?? DEFAULT_CONFIG.connection_timeout),
    // Default key, applied to every node without a specific one.
    encryption_key: typeof raw.encryption_key === 'string' ? raw.encryption_key.trim() : '',
    encryption_keys: parseEncryptionKeys(raw.encryption_keys),
    nodes: parseNodes(raw.nodes),
  };
}

/**
 * Resolve the encryption key of a node: its own key if it has one, the default
 * key otherwise. An empty result means "no encryption", which the client maps
 * to a plaintext connection.
 *
 * A node declared by hand is looked up by the ADDRESS the user typed, because
 * its real name is only known after a successful handshake — which needs the
 * key. Such a node therefore needs its per-node key indexed by that same
 * address (`192.168.1.42|key…`), which the documentation states.
 * @param {object} config - The normalized configuration.
 * @param {string} nodeName - The ESPHome node name (or its address).
 * @returns {string|null} The key, or null when the node has none.
 * @example
 * resolveEncryptionKey(config, 'salon');
 */
export function resolveEncryptionKey(config, nodeName) {
  const specific = config.encryption_keys[String(nodeName).toLowerCase()];
  return specific || config.encryption_key || null;
}
