// -----------------------------------------------------------------------------
// Device orchestration: discovery, state publishing and commands.
//
// Bridges the EsphomeManager (raw protocol) and the Gladys SDK. It holds no
// connection state of its own — the manager owns that.
//
// The push model is what makes this integration different from a polling one:
// ESPHome nodes send their state changes as they happen, so states reach Gladys
// through `publishStates()` from the manager's callback, not through `onPoll`.
// -----------------------------------------------------------------------------

import { createLogger, DEVICE_TRANSPORTS } from '@gladysassistant/integration-sdk';
import { describeEntity } from './esphome/mapping.js';
import { readState, writeCommand } from './esphome/convert.js';
import {
  EXTERNAL_ID_TYPE,
  MDNS_SERVICE,
  DEFAULT_PORT,
  PARAM_ADDRESS,
  PARAM_VERSION,
} from './esphome/constants.js';
import { resolveEncryptionKey } from './config.js';

const logger = createLogger({ name: 'esphome-devices' });

// A scan in flight, shared by concurrent callers. The core rate-limits network
// scans (1 per 10s per integration), and a user clicking "Scan" twice must not
// turn the second click into a 429 that empties the Discover screen.
let inFlightScan = null;

/**
 * Discover the ESPHome nodes reachable on the network: the ones the core's mDNS
 * scan reports, plus the ones the user declared by hand. Manual entries win on
 * address, since the user typed them for a reason (a node the scan cannot see).
 * @param {object} gladys - The Gladys SDK instance.
 * @param {object} config - The normalized configuration.
 * @returns {Promise<Array<{ name: string, host: string, port: number }>>} The nodes.
 * @example
 * const nodes = await discoverNodes(gladys, config);
 */
export async function discoverNodes(gladys, config) {
  /** @type {Map<string, { name: string, host: string, port: number }>} */
  const nodes = new Map();

  // Integration containers run on a bridge network and never receive mDNS
  // traffic: the core captures it for us (manifest `network_discovery`).
  try {
    if (!inFlightScan) {
      inFlightScan = gladys
        .scanNetwork('mdns', { timeoutSeconds: config.scan_duration })
        .finally(() => {
          inFlightScan = null;
        });
    }
    const results = await inFlightScan;
    (results || []).forEach((result) => {
      const node = parseMdnsResult(result);
      if (node) {
        nodes.set(node.name.toLowerCase(), node);
      }
    });
    logger.info(`mDNS scan (${MDNS_SERVICE}): ${nodes.size} ESPHome node(s) found`);
  } catch (e) {
    // A Gladys without mediated discovery, or a scan rate-limited by the core:
    // the manually declared nodes must still work.
    logger.warn(`mDNS scan unavailable: ${e.message}`);
    logger.debug(e);
  }

  config.nodes.forEach((manual) => {
    // The node name is unknown until it answers; its address stands in, and the
    // real name replaces it once connected (see buildDiscoveredDevices).
    const name = manual.host;
    nodes.set(name.toLowerCase(), { name, host: manual.host, port: manual.port });
  });

  return [...nodes.values()];
}

/**
 * Turn one raw mDNS result into a node descriptor. ESPHome announces its node
 * name in the service instance name, and the reachable address in `addresses`.
 * @param {object} result - A raw mDNS result `{ name, host, addresses, port, txt }`.
 * @returns {{ name: string, host: string, port: number }|null} The node, or null.
 * @example
 * parseMdnsResult({ name: 'salon._esphomelib._tcp.local', addresses: ['192.168.1.42'], port: 6053 });
 */
export function parseMdnsResult(result) {
  if (!result) {
    return null;
  }
  // Strip the service suffix to keep the node name. The trailing dot and the
  // `.local` part are both optional depending on the responder, hence the
  // regex — and a plain `split('.')` would truncate a node named "salon.bas".
  const name = String(result.name || '')
    .replace(new RegExp(`\\.?${MDNS_SERVICE.replace(/\./g, '\\.')}(\\.local)?\\.?$`), '')
    .trim();

  // Prefer a routable IPv4: an mDNS `.local` hostname needs a resolver the
  // container may not have, while the address the scan reports always works.
  const candidates = [...(result.addresses || []), result.host].filter(Boolean);
  const host = candidates.find((address) => /^\d+\.\d+\.\d+\.\d+$/.test(String(address)));
  if (!host || !name) {
    return null;
  }
  return { name, host, port: result.port || DEFAULT_PORT };
}

/**
 * Connect to every discovered node and build the Gladys devices, one per node,
 * carrying the features of all its entities. A node that refuses the connection
 * (wrong key, offline) is skipped with a log rather than failing the whole scan:
 * one unreachable node must not hide the others.
 * @param {object} gladys - The Gladys SDK instance.
 * @param {object} manager - The EsphomeManager instance.
 * @param {object} config - The normalized configuration.
 * @returns {Promise<object[]>} The Gladys devices, ready to publish.
 * @example
 * const devices = await buildDiscoveredDevices(gladys, manager, config);
 */
export async function buildDiscoveredDevices(gladys, manager, config) {
  const nodes = await discoverNodes(gladys, config);
  const devices = [];

  for (const node of nodes) {
    try {
      const key = resolveEncryptionKey(config, node.name);
      const client = await manager.connect(node, key, config.connection_timeout);

      // The node reports its REAL name during the handshake, and the manager
      // has already re-filed the connection under it: a node added by hand as
      // "192.168.1.42" is now "salon", so its external id stays stable even if
      // its IP changes later.
      const info = client.deviceInfo() || {};
      const name = info.name || node.name;

      const device = buildDevice(gladys, { ...node, name }, manager.listEntities(name), info);
      if (device.features.length === 0) {
        logger.info(`ESPHome node "${name}" exposes no entity Gladys can use`);
        continue;
      }
      devices.push(device);
    } catch (e) {
      logger.warn(`ESPHome node "${node.name}" (${node.host}) unreachable: ${e.message}`);
      logger.debug(e);
    }
  }

  logger.info(`ESPHome discovery: ${devices.length} device(s) built`);
  return devices;
}

/**
 * Build the Gladys device of one node: one device carrying one feature per
 * usable entity dimension.
 * @param {object} gladys - The Gladys SDK instance.
 * @param {object} node - The node `{ name, host, port }`.
 * @param {object[]} entities - The entities the node exposes.
 * @param {object} info - The node's `deviceInfo` (version, model…).
 * @returns {object} The Gladys device.
 * @example
 * const device = buildDevice(gladys, node, entities, info);
 */
export function buildDevice(gladys, node, entities, info = {}) {
  const ids = gladys.externalIds(EXTERNAL_ID_TYPE, node.name);
  const features = [];

  entities.forEach((entity) => {
    describeEntity(entity).forEach((descriptor) => {
      features.push({
        // The entity name is the one the user wrote in their YAML — the most
        // meaningful label available. Several features of one entity are
        // disambiguated by their key (brightness, color…).
        name: featureName(entity, descriptor),
        // `entity.id` is the branded `${type}-${objectId}`; appending the
        // descriptor key makes the feature id, which setValue parses back.
        external_id: ids.feature(`${entity.id}:${descriptor.key}`),
        category: descriptor.category,
        type: descriptor.type,
        read_only: descriptor.readOnly,
        keep_history: descriptor.keepHistory,
        has_feedback: true,
        min: descriptor.min,
        max: descriptor.max,
        ...(descriptor.unit ? { unit: descriptor.unit } : {}),
      });
    });
  });

  return {
    name: info.friendlyName || node.name,
    external_id: ids.device,
    // Keep the address to reconnect without waiting for a new scan, and the
    // firmware version for display.
    params: [
      { name: PARAM_ADDRESS, value: `${node.host}:${node.port || DEFAULT_PORT}` },
      { name: PARAM_VERSION, value: String(info.esphomeVersion || '') },
    ],
    features,
  };
}

/**
 * Build the display name of a feature. A single-feature entity keeps the plain
 * entity name; a multi-feature one gets its dimension appended.
 * @param {object} entity - The ESPHome entity.
 * @param {object} descriptor - The feature descriptor.
 * @returns {string} The feature name.
 * @example
 * featureName({ name: 'Lamp' }, { key: 'brightness' }); // 'Lamp - brightness'
 */
function featureName(entity, descriptor) {
  const base = entity.name || entity.objectId;
  return descriptor.key === 'state' || descriptor.key === 'press'
    ? base
    : `${base} - ${descriptor.key.replace(/_/g, ' ')}`;
}

/**
 * Publish the states an ESPHome event carries, for the Gladys device that owns
 * the entity. Called on every state change pushed by a node.
 *
 * Only the devices the USER created are considered: an entity discovered but
 * never added to Gladys has no feature to publish to, and the core would reject
 * the unknown external id.
 * @param {object} gladys - The Gladys SDK instance.
 * @param {string} nodeName - The ESPHome node name.
 * @param {object} entity - The entity the event belongs to.
 * @param {object} event - The ESPHome state event.
 * @returns {Promise<void>} Resolves once published (no-op if nothing to send).
 * @example
 * await publishEntityState(gladys, 'salon', entity, event);
 */
export async function publishEntityState(gladys, nodeName, entity, event) {
  const ids = gladys.externalIds(EXTERNAL_ID_TYPE, nodeName);
  const deviceExternalId = ids.device;

  const device = (gladys.devices || []).find((d) => d.external_id === deviceExternalId);
  if (!device) {
    return;
  }

  // A feature id ends with `<entityId>:<descriptorKey>`; the descriptors carry
  // the read logic, so rebuild them for this entity and match by external id.
  const descriptors = describeEntity(entity);
  const states = [];

  descriptors.forEach((descriptor) => {
    const externalId = ids.feature(`${entity.id}:${descriptor.key}`);
    const feature = (device.features || []).find((f) => f.external_id === externalId);
    if (!feature) {
      return;
    }
    const value = readState(
      // The read needs the category (a cover state is not a boolean) and, for a
      // fan, the number of speed levels the firmware declares.
      { ...descriptor, speedCount: entity.supportedSpeedCount },
      event,
    );
    if (value === undefined || value === null) {
      return;
    }
    states.push(
      typeof value === 'object'
        ? { device_feature_external_id: externalId, ...value }
        : { device_feature_external_id: externalId, state: value },
    );
  });

  if (states.length > 0) {
    await gladys.publishStates(states);
  }
}

/**
 * Apply a Gladys command on an ESPHome entity.
 * @param {object} gladys - The Gladys SDK instance.
 * @param {object} manager - The EsphomeManager instance.
 * @param {object} device - The Gladys device.
 * @param {object} feature - The Gladys feature being actioned.
 * @param {number|string} value - The requested value (a string for a text feature).
 * @returns {Promise<void>} Resolves once the command is sent.
 * @example
 * await setDeviceValue(gladys, manager, device, feature, 1);
 */
export async function setDeviceValue(gladys, manager, device, feature, value) {
  const { nodeName, entityType, objectId, featureKey } = parseFeatureExternalId(
    gladys,
    feature.external_id,
  );

  const entity = findEntity(manager, nodeName, entityType, objectId);
  const command = writeCommand(
    {
      key: featureKey,
      category: feature.category,
      type: feature.type,
      speedCount: entity && entity.supportedSpeedCount,
    },
    value,
  );

  if (command === null) {
    throw new Error(`ESPHome: feature "${feature.external_id}" is not commandable`);
  }

  logger.debug(`ESPHome command ${nodeName}/${entityType}-${objectId}: ${JSON.stringify(command)}`);
  manager.command(nodeName, entityType, objectId, command);
}

/**
 * Parse a feature external id back into its ESPHome coordinates.
 *
 * Shape: `ext:<selector>:esphome:<nodeName>:<entityType>-<objectId>:<featureKey>`.
 * The node name and the object id can both contain dashes, so the split is done
 * from the RIGHT (the feature key is last, the entity id before it) — splitting
 * from the left would break on a node named "salon-bas".
 * @param {object} gladys - The Gladys SDK instance.
 * @param {string} externalId - The feature external id.
 * @returns {{ nodeName: string, entityType: string, objectId: string, featureKey: string }} The coordinates.
 * @example
 * parseFeatureExternalId(gladys, 'ext:sel:esphome:salon:light-lamp:brightness');
 */
export function parseFeatureExternalId(gladys, externalId) {
  const prefix = `${gladys.externalId(EXTERNAL_ID_TYPE)}:`;
  if (!String(externalId).startsWith(prefix)) {
    throw new Error(`ESPHome feature external_id is invalid: "${externalId}"`);
  }
  const rest = String(externalId).slice(prefix.length);

  // rest = "<nodeName>:<entityType>-<objectId>:<featureKey>"
  const parts = rest.split(':');
  if (parts.length < 3) {
    throw new Error(`ESPHome feature external_id is invalid: "${externalId}"`);
  }
  const featureKey = parts.pop();
  const entityId = parts.pop();
  // Whatever is left is the node name, which may itself contain colons only if
  // the user named it so — rejoining keeps it intact.
  const nodeName = parts.join(':');

  // The entity id is "<type>-<objectId>", and the FIRST dash separates them:
  // an entity type never contains one, an object id may.
  const dash = entityId.indexOf('-');
  if (dash <= 0) {
    throw new Error(`ESPHome entity id is invalid: "${entityId}"`);
  }

  return {
    nodeName,
    entityType: entityId.slice(0, dash),
    objectId: entityId.slice(dash + 1),
    featureKey,
  };
}

/**
 * Extract the node name from a DEVICE external id
 * (`ext:<selector>:esphome:<nodeName>`).
 * @param {object} gladys - The Gladys SDK instance.
 * @param {string} externalId - The device external id.
 * @returns {string} The ESPHome node name.
 * @example
 * parseDeviceExternalId(gladys, 'ext:sel:esphome:salon'); // 'salon'
 */
export function parseDeviceExternalId(gladys, externalId) {
  const prefix = `${gladys.externalId(EXTERNAL_ID_TYPE)}:`;
  if (!String(externalId).startsWith(prefix)) {
    throw new Error(`ESPHome device external_id is invalid: "${externalId}"`);
  }
  return String(externalId).slice(prefix.length);
}

/**
 * Find an entity on a connected node.
 * @param {object} manager - The EsphomeManager instance.
 * @param {string} nodeName - The ESPHome node name.
 * @param {string} entityType - The entity type.
 * @param {string} objectId - The entity object id.
 * @returns {object|undefined} The entity, or undefined when not found.
 */
function findEntity(manager, nodeName, entityType, objectId) {
  return manager
    .listEntities(nodeName)
    .find((entity) => entity.type === entityType && entity.objectId === objectId);
}

/**
 * Publish the reachability of the integration devices as a Gladys transport
 * badge. ESPHome is a local protocol, so a connected node is `local` and a
 * disconnected one is `unreachable`.
 * @param {object} gladys - The Gladys SDK instance.
 * @param {string} nodeName - The ESPHome node name.
 * @param {boolean} connected - Whether the node is connected.
 * @returns {Promise<void>} Resolves once published.
 * @example
 * await publishNodeTransport(gladys, 'salon', true);
 */
export async function publishNodeTransport(gladys, nodeName, connected) {
  const ids = gladys.externalIds(EXTERNAL_ID_TYPE, nodeName);
  try {
    await gladys.publishTransports([
      {
        external_id: ids.device,
        transport: connected ? DEVICE_TRANSPORTS.LOCAL : DEVICE_TRANSPORTS.UNREACHABLE,
      },
    ]);
  } catch (e) {
    // Unknown external ids are ignored by Gladys, but a transient API error
    // must not take the connection callback down with it.
    logger.debug(`Publishing the transport of "${nodeName}" failed: ${e.message}`);
  }
}
