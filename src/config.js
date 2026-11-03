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
//
// Gladys renders every config field as a SINGLE-LINE input: the browser drops
// the line breaks of a paste (Chrome strips them, Firefox turns them into
// spaces). Both free-text fields therefore accept any whitespace, a comma or a
// semicolon between entries — none of them can appear in a base64 key, a node
// name or an address.
//
// The per-node keys also live in a registry the configuration buttons edit
// (`NODE_KEYS_KEY`, stored through setConfig outside the config_schema), one
// node at a time: a secret field never comes back to the form, so editing a
// list of 19 keys in it means retyping all of them.
// -----------------------------------------------------------------------------

import { DEFAULT_PORT } from './esphome/constants.js';

// Defaults: they MUST stay consistent with the `default` values declared in the
// `config_schema` of the manifest.
export const DEFAULT_CONFIG = {
  scan_duration: 8, // seconds, how long the mDNS scan listens
  connection_timeout: 10, // seconds, before giving up on a node
};

// Key stored through setConfig() OUTSIDE the config_schema: the per-node keys
// set with the configuration buttons, as a JSON object `{ node: key }`. The
// configuration lives in the Gladys database, so the keys follow its backups.
export const NODE_KEYS_KEY = 'node_keys';

// An ESPHome API key: 32 random bytes, base64-encoded (44 characters, one "=").
const ENCRYPTION_KEY = /^[A-Za-z0-9+/]{43}=$/;

// A node name (`esphome: name:`, letters, digits and hyphens) or the address
// of a node added by hand (host name, IPv4, [IPv6]). No whitespace, "|", ","
// or ";": those separate the entries of the free-text fields.
const NODE_NAME = /^[a-z0-9_.:[\]-]{1,253}$/i;

// Quotes a key is often pasted with, straight from the YAML (`key: "…="`) or
// through a word processor or a forum that curls them.
const QUOTES = /^["'`«»“”‘’„\s]+|["'`«»“”‘’„\s]+$/g;

/**
 * Strip the quotes a key or a node name was pasted with. A quoted key fails
 * the handshake with nothing in the logs but "invalid key", and a base64 key
 * never contains a quote.
 * @param {unknown} raw - The pasted text.
 * @returns {string} The text without surrounding quotes or spaces.
 * @example
 * unquote('"kBv1…="'); // 'kBv1…='
 */
export function unquote(raw) {
  return String(raw ?? '').replace(QUOTES, '');
}

/**
 * Split a free-text field into trimmed, non-empty entries. Users paste from a
 * YAML file or a terminal, and the single-line input of Gladys mangles the
 * line breaks, so any whitespace, comma or semicolon separates two entries.
 * @param {unknown} raw - The raw field value.
 * @returns {string[]} The meaningful entries.
 * @example
 * splitEntries('salon.local\n\n 192.168.1.42 '); // ['salon.local', '192.168.1.42']
 */
function splitEntries(raw) {
  if (typeof raw !== 'string') {
    return [];
  }
  return raw.split(/[\s,;]+/).filter((entry) => entry.length > 0);
}

/**
 * Normalize a node name the way the lookups expect it: trimmed and lower-cased,
 * so a key entered as "Salon" still matches the node named "salon" the scan
 * reports.
 * @param {unknown} raw - The name typed by the user.
 * @returns {string|null} The node name, or null when it cannot be one.
 * @example
 * normalizeNodeName(' Salon '); // 'salon'
 */
export function normalizeNodeName(raw) {
  const name = unquote(raw).toLowerCase();
  return NODE_NAME.test(name) ? name : null;
}

/**
 * Tell whether a text is a well-formed ESPHome API encryption key.
 * @param {unknown} raw - The key typed by the user.
 * @returns {boolean} True for 32 bytes in base64.
 * @example
 * isValidEncryptionKey('kBv1s2f...='); // false, too short
 */
export function isValidEncryptionKey(raw) {
  return typeof raw === 'string' && ENCRYPTION_KEY.test(unquote(raw));
}

/**
 * Parse the "keys per node" field: `node|key` pairs, separated by line breaks,
 * spaces, commas or semicolons.
 * @param {unknown} raw - The raw field value.
 * @returns {Record<string, string>} Keys indexed by lower-cased node name.
 * @example
 * parseEncryptionKeys('salon|abc=\nkitchen|def='); // { salon: 'abc=', kitchen: 'def=' }
 */
export function parseEncryptionKeys(raw) {
  /** @type {Record<string, string>} */
  const keys = {};
  splitEntries(raw).forEach((line) => {
    // Only the FIRST separator splits: a base64 key never contains "|", but
    // splitting on all of them would silently truncate a malformed entry.
    const separator = line.indexOf('|');
    if (separator <= 0) {
      return;
    }
    const node = unquote(line.slice(0, separator)).toLowerCase();
    const key = unquote(line.slice(separator + 1));
    if (node && key) {
      keys[node] = key;
    }
  });
  return keys;
}

/**
 * Read the registry of per-node keys the configuration buttons maintain.
 * @param {unknown} stored - The NODE_KEYS_KEY value (an object, or its JSON).
 * @returns {Record<string, string>} Keys indexed by lower-cased node name.
 * @example
 * parseNodeKeys('{"salon":"abc="}'); // { salon: 'abc=' }
 */
export function parseNodeKeys(stored) {
  let value = stored;
  if (typeof stored === 'string') {
    try {
      value = JSON.parse(stored);
    } catch {
      return {};
    }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  /** @type {Record<string, string>} */
  const keys = {};
  Object.entries(value).forEach(([node, key]) => {
    const name = normalizeNodeName(node);
    if (name && typeof key === 'string' && unquote(key)) {
      keys[name] = unquote(key);
    }
  });
  return keys;
}

/**
 * Parse the "nodes added by hand" field: addresses separated by line breaks,
 * spaces, commas or semicolons, each with an optional
 * `:port`. The node name is unknown at this point (only a connection reveals
 * it), so the address doubles as the name until the node answers.
 * @param {unknown} raw - The raw field value.
 * @returns {Array<{ host: string, port: number }>} The manual nodes.
 * @example
 * parseNodes('salon.local\n192.168.1.42:6053');
 */
export function parseNodes(raw) {
  return splitEntries(raw)
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
    encryption_key: typeof raw.encryption_key === 'string' ? unquote(raw.encryption_key) : '',
    // The registry first, then the form field: what the user just typed in the
    // form wins, and the buttons fold the field into the registry anyway.
    encryption_keys: {
      ...parseNodeKeys(raw[NODE_KEYS_KEY]),
      ...parseEncryptionKeys(raw.encryption_keys),
    },
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
