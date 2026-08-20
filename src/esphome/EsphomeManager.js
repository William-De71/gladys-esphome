// -----------------------------------------------------------------------------
// Connection manager: one live ESPHome connection per node.
//
// ESPHome has no hub — every node is an independent TCP peer that PUSHES its
// state changes over the native API. That shapes the whole design:
//
//   - one `EspHomeClient` per node, kept OPEN (not a request/response client);
//   - states arrive unsolicited, so we forward them to a callback instead of
//     answering a Gladys poll (see devices.js);
//   - auto-reconnect is delegated to the client library, which already filters
//     permanent errors (bad key…) from transient ones (node rebooting).
//
// This module owns connections and nothing else: no Gladys SDK, no feature
// mapping. It speaks ESPHome and reports what happens through callbacks.
// -----------------------------------------------------------------------------

import { openEspHomeClient, entityId } from 'esphome-client';
import { createLogger } from '@gladysassistant/integration-sdk';
import { DEFAULT_PORT, RECONNECT_INITIAL_DELAY_MS, RECONNECT_MAX_DELAY_MS } from './constants.js';

const logger = createLogger({ name: 'esphome-manager' });

/**
 * Manages the live connections to the ESPHome nodes.
 * @example
 * const manager = new EsphomeManager();
 * manager.onState((nodeName, entity, event) => { ... });
 */
export class EsphomeManager {
  constructor() {
    /**
     * Live connections, indexed by lower-cased node name.
     * @type {Map<string, object>}
     */
    this.clients = new Map();
    /**
     * Last known address of each node, so a reconnection does not depend on a
     * fresh mDNS scan.
     * @type {Map<string, { host: string, port: number }>}
     */
    this.addresses = new Map();
    /**
     * Per-node index of entities by their firmware key, rebuilt on every
     * connection: a state event only carries that numeric key.
     * @type {Map<string, Map<number, object>>}
     */
    this.entityKeys = new Map();
    /**
     * Current name of each connection. The event callbacks read it here rather
     * than capturing it, so a node renamed after its handshake (see rename())
     * keeps reporting under the right name.
     * @type {Map<object, string>}
     */
    this.nodeNames = new Map();
    /** @type {Function|null} */
    this.stateCallback = null;
    /** @type {Function|null} */
    this.connectionCallback = null;
  }

  /**
   * Register the callback invoked on every state change pushed by a node.
   * @param {Function} callback - `(nodeName, entity, event) => void`.
   * @returns {void}
   * @example
   * manager.onState((node, entity, event) => logger.info(node, event.state));
   */
  onState(callback) {
    this.stateCallback = callback;
  }

  /**
   * Register the callback invoked when a node connects or disconnects.
   * @param {Function} callback - `(nodeName, connected) => void`.
   * @returns {void}
   * @example
   * manager.onConnectionChange((node, connected) => logger.info(node, connected));
   */
  onConnectionChange(callback) {
    this.connectionCallback = callback;
  }

  /**
   * Open (or reuse) the connection to a node. Reusing matters: discovery and
   * the state loop both ask for the same nodes, and a second TCP session would
   * be refused by the firmware, which accepts a limited number of API clients.
   * @param {object} node - `{ name, host, port }` of the node.
   * @param {string|null} encryptionKey - The base64 Noise key, or null.
   * @param {number} timeoutSeconds - How long to wait for the node to answer.
   * @returns {Promise<object>} The connected ESPHome client.
   * @example
   * const client = await manager.connect({ name: 'salon', host: '192.168.1.42' }, key, 10);
   */
  async connect(node, encryptionKey, timeoutSeconds) {
    const key = String(node.name).toLowerCase();
    const existing = this.clients.get(key);
    if (existing) {
      return existing;
    }

    const host = node.host;
    const port = node.port || DEFAULT_PORT;
    logger.info(`Connecting to ESPHome node "${node.name}" (${host}:${port})`);

    const client = await openEspHomeClient({
      host,
      port,
      // The library treats an absent key as "plaintext connection", which is
      // what an ESPHome node without `api: encryption:` expects.
      psk: encryptionKey || null,
      connectTimeoutMs: timeoutSeconds * 1000,
      reconnect: {
        initialDelayMs: RECONNECT_INITIAL_DELAY_MS,
        maxDelayMs: RECONNECT_MAX_DELAY_MS,
      },
    });

    this.clients.set(key, client);
    this.addresses.set(key, { host, port });
    this.nodeNames.set(client, node.name);

    // The callbacks below must report the node's CURRENT name, which rename()
    // may change once the handshake reveals it — hence the lookup rather than
    // the captured `node.name`.
    const currentName = () => this.nodeNames.get(client) || node.name;

    // Forward every state change. `telemetry` is the union rail: one callback
    // for all entity types, which is what we want since the mapping downstream
    // keys on the entity type anyway.
    //
    // A state event carries the entity's numeric `key`, not its object id — and
    // the client exposes no public key->entity lookup. We keep our own index,
    // rebuilt on every connect (keys are assigned by the firmware at boot and
    // change when the user reflashes a modified YAML).
    client.on('telemetry', (event) => {
      if (!this.stateCallback) {
        return;
      }
      const name = currentName();
      const entity = this.entityByKey(name, event.key);
      if (!entity) {
        logger.debug(`Ignored state from "${name}": unknown entity key ${event.key}`);
        return;
      }
      this.stateCallback(name, entity, event);
    });

    // Surface the connection lifecycle so Gladys can show a node as reachable
    // or not (publishTransports in devices.js).
    client.on('lifecycle', (event) => {
      const connected = event.kind === 'connect';
      const name = currentName();
      if (connected) {
        // Entity keys are re-issued by the firmware on each session: rebuild
        // the index before any state event of the new session lands.
        this.indexEntities(name);
      }
      if (this.connectionCallback) {
        this.connectionCallback(name, connected);
      }
    });

    // The node reports its real name during the handshake, which openEspHomeClient
    // has already completed here: file the connection under it right away, before
    // any state event or command has to find it.
    const info = client.deviceInfo() || {};
    if (info.name) {
      this.rename(node.name, info.name);
    }

    const name = currentName();
    this.indexEntities(name);

    if (this.connectionCallback) {
      this.connectionCallback(name, true);
    }

    return client;
  }

  /**
   * Re-key a connection under the node's real ESPHome name.
   *
   * A node the user declared by hand is reached by address ("192.168.1.42"),
   * but it announces its real name during the handshake — and that name is what
   * the external ids are built from. Without this, its pushed states would be
   * published under the wrong device id, and its commands would look for a
   * client that is filed under the address.
   * @param {string} currentName - The name the connection is filed under.
   * @param {string} realName - The name the node reports.
   * @returns {void}
   * @example
   * manager.rename('192.168.1.42', 'salon');
   */
  rename(currentName, realName) {
    const from = String(currentName).toLowerCase();
    const to = String(realName).toLowerCase();
    if (from === to) {
      return;
    }
    const client = this.clients.get(from);
    if (!client) {
      return;
    }
    // A node already connected under its real name (found by the scan AND
    // declared by hand) would otherwise be replaced by its own duplicate.
    const existing = this.clients.get(to);
    if (existing && existing !== client) {
      logger.debug(`Node "${realName}" is already connected: dropping the duplicate "${from}"`);
      this.clients.delete(from);
      this.addresses.delete(from);
      this.entityKeys.delete(from);
      this.nodeNames.delete(client);
      client.disconnect();
      return;
    }

    this.clients.set(to, client);
    this.clients.delete(from);
    const address = this.addresses.get(from);
    if (address) {
      this.addresses.set(to, address);
      this.addresses.delete(from);
    }
    const index = this.entityKeys.get(from);
    if (index) {
      this.entityKeys.set(to, index);
      this.entityKeys.delete(from);
    }
    // The callbacks captured the old name in their closure; point them at the
    // real one so later states and lifecycle events carry it.
    this.nodeNames.set(client, realName);
    logger.info(`ESPHome node "${currentName}" reports its real name: "${realName}"`);
  }

  /**
   * (Re)build the key -> entity index of a node from what the client discovered
   * during its handshake.
   * @param {string} nodeName - The ESPHome node name.
   * @returns {void}
   * @example
   * manager.indexEntities('salon');
   */
  indexEntities(nodeName) {
    const key = String(nodeName).toLowerCase();
    const client = this.clients.get(key);
    if (!client) {
      return;
    }
    const index = new Map();
    // `getEntitiesWithIds()` stamps the branded `${type}-${objectId}` id into
    // each record, which is exactly the suffix our feature external ids use.
    (client.getEntitiesWithIds() || []).forEach((entity) => {
      index.set(entity.key, entity);
    });
    this.entityKeys.set(key, index);
    logger.debug(`Indexed ${index.size} entities for node "${nodeName}"`);
  }

  /**
   * Resolve the entity a state event refers to, by its firmware key.
   * @param {string} nodeName - The ESPHome node name.
   * @param {number} entityKey - The numeric key carried by the state event.
   * @returns {object|undefined} The entity, or undefined if unknown.
   * @example
   * const entity = manager.entityByKey('salon', 560583272);
   */
  entityByKey(nodeName, entityKey) {
    const index = this.entityKeys.get(String(nodeName).toLowerCase());
    return index ? index.get(entityKey) : undefined;
  }

  /**
   * Return the live client of a node, if any.
   * @param {string} nodeName - The ESPHome node name.
   * @returns {object|undefined} The client, or undefined when not connected.
   * @example
   * const client = manager.getClient('salon');
   */
  getClient(nodeName) {
    return this.clients.get(String(nodeName).toLowerCase());
  }

  /**
   * List the entities a connected node exposes, each carrying its branded
   * `${type}-${objectId}` id — the suffix our feature external ids are built
   * from, so discovery and commands agree on one identifier.
   * @param {string} nodeName - The ESPHome node name.
   * @returns {object[]} The entities, or an empty array when not connected.
   * @example
   * const entities = manager.listEntities('salon');
   */
  listEntities(nodeName) {
    const client = this.getClient(nodeName);
    if (!client) {
      return [];
    }
    return client.getEntitiesWithIds() || [];
  }

  /**
   * Send a command to an entity of a node.
   * @param {string} nodeName - The ESPHome node name.
   * @param {string} entityType - The ESPHome entity type (e.g. 'light').
   * @param {string} objectId - The ESPHome object id.
   * @param {object} command - The command payload, in the client's format.
   * @returns {void}
   * @example
   * manager.command('salon', 'light', 'lamp', { state: true, brightness: 0.5 });
   */
  command(nodeName, entityType, objectId, command) {
    const client = this.getClient(nodeName);
    if (!client) {
      throw new Error(`ESPHome node "${nodeName}" is not connected`);
    }
    client.command(entityId(entityType, objectId), command);
  }

  /**
   * Disconnect one node and forget its client.
   * @param {string} nodeName - The ESPHome node name.
   * @returns {Promise<void>} Resolves once disconnected.
   * @example
   * await manager.disconnect('salon');
   */
  async disconnect(nodeName) {
    const key = String(nodeName).toLowerCase();
    const client = this.clients.get(key);
    if (!client) {
      return;
    }
    this.clients.delete(key);
    this.entityKeys.delete(key);
    this.addresses.delete(key);
    this.nodeNames.delete(client);
    try {
      // Graceful path: sends DISCONNECT_REQUEST so the node frees the API slot
      // immediately instead of waiting for its own timeout.
      await client.disconnectAsync();
    } catch (e) {
      logger.debug(`Disconnection of "${nodeName}" failed: ${e.message}`);
    }
  }

  /**
   * Disconnect every node (used on shutdown and before a full reconnection).
   * @returns {Promise<void>} Resolves once every node is disconnected.
   * @example
   * await manager.disconnectAll();
   */
  async disconnectAll() {
    const names = [...this.clients.keys()];
    await Promise.all(names.map((name) => this.disconnect(name)));
  }
}
