// -----------------------------------------------------------------------------
// Entry point of the ESPHome external integration.
//
// Role of this file: wire the Gladys SDK to the connection manager and the
// device orchestration (src/devices.js). It:
//   1. instantiates the SDK (connection, auth, reconnection handled for you);
//   2. registers the event handlers BEFORE connect();
//   3. exposes the manifest actions (test / reconnect);
//   4. connects to the nodes and publishes their devices once connected.
//
// Push model: unlike a polling integration, ESPHome nodes send their state
// changes as they happen over a connection kept open. States therefore reach
// Gladys from the manager's callback (`onState`), and `onPoll` only serves as a
// safety net for a device Gladys asks to refresh explicitly.
// -----------------------------------------------------------------------------

import { GladysIntegration, logger } from '@gladysassistant/integration-sdk';
import { EsphomeManager } from './src/esphome/EsphomeManager.js';
import { normalizeConfig, resolveEncryptionKey } from './src/config.js';
import {
  buildDiscoveredDevices,
  publishEntityState,
  flushStates,
  publishNodeTransport,
  setDeviceValue,
  parseDeviceExternalId,
} from './src/devices.js';
import { PARAM_ADDRESS } from './src/esphome/constants.js';

const gladys = new GladysIntegration();
const manager = new EsphomeManager();

let config = normalizeConfig();

// --- State push: a node reports a change -------------------------------------
manager.onState((nodeName, entity, event) => {
  publishEntityState(gladys, nodeName, entity, event).catch((e) => {
    // Name the ENTITY, not just the node: a node exposes dozens of them, and a
    // failure that only says "salon" leaves no way to tell which reading caused
    // it — the exact dead end a user hit when an mmWave sensor kept failing.
    const label = entity ? entity.name || entity.objectId || entity.id : 'unknown entity';
    logger.warn(`Publishing the state of "${nodeName}"/"${label}" failed: ${e.message}`);
    logger.debug(e);
  });
});

// --- Reachability: a node connects or drops ----------------------------------
manager.onConnectionChange((nodeName, connected) => {
  logger.info(`ESPHome node "${nodeName}" is ${connected ? 'connected' : 'disconnected'}`);
  publishNodeTransport(gladys, nodeName, connected).catch(() => {});
});

/**
 * Refresh the configuration, connect to the nodes and publish what they expose.
 * @returns {Promise<object[]>} The published devices.
 */
async function publishDevices() {
  config = normalizeConfig(await gladys.getConfig());
  const devices = await buildDiscoveredDevices(gladys, manager, config);
  await gladys.publishDiscoveredDevices(devices);

  if (devices.length > 0) {
    await gladys.setConnectionStatus(true).catch(() => {});
  } else {
    await gladys
      .setConnectionStatus(false, {
        en: 'No ESPHome node found. Check your encryption key, then run a scan.',
        fr: 'Aucun nœud ESPHome trouvé. Vérifiez votre clé de chiffrement, puis lancez un scan.',
      })
      .catch(() => {});
  }
  return devices;
}

// --- Discovery: the user asks for the list of devices ------------------------
gladys.onScanRequest(async () => {
  logger.info('onScanRequest -> discovering the ESPHome nodes');
  await publishDevices();
});

// --- Command: the user acts on a controllable feature ------------------------
gladys.onSetValue(async (device, feature, value) => {
  logger.info(`onSetValue <- ${feature.external_id} = ${value}`);
  await setDeviceValue(gladys, manager, device, feature, value);
});

// --- Polling: Gladys asks to refresh a device --------------------------------
// ESPHome pushes its states, so there is nothing to fetch here. What a poll CAN
// fix is a node whose connection dropped while Gladys kept its device: retry the
// connection so the state flow resumes on its own.
gladys.onPoll(async (device) => {
  const nodeName = parseDeviceExternalId(gladys, device.external_id);
  if (manager.getClient(nodeName)) {
    return;
  }
  const address = (device.params || []).find((param) => param.name === PARAM_ADDRESS);
  if (!address) {
    return;
  }
  const [host, port] = String(address.value).split(':');
  logger.info(`onPoll -> reconnecting the ESPHome node "${nodeName}"`);
  await manager
    .connect(
      { name: nodeName, host, port: Number(port) },
      resolveEncryptionKey(config, nodeName),
      config.connection_timeout,
    )
    .catch((e) => {
      logger.debug(`Reconnection of "${nodeName}" failed: ${e.message}`);
    });
});

// --- Manifest action: test the connection ------------------------------------
gladys.onAction('test_connection', async () => {
  try {
    const devices = await publishDevices();
    if (devices.length === 0) {
      return {
        en: 'No ESPHome node answered. Check that your nodes are powered on and that the encryption key matches.',
        fr: "Aucun nœud ESPHome n'a répondu. Vérifiez que vos nœuds sont allumés et que la clé de chiffrement correspond.",
      };
    }
    const featureCount = devices.reduce((total, device) => total + device.features.length, 0);
    return {
      en: `Connection OK: ${devices.length} node(s), ${featureCount} feature(s) available.`,
      fr: `Connexion OK : ${devices.length} nœud(s), ${featureCount} fonctionnalité(s) disponible(s).`,
    };
  } catch (e) {
    logger.error('ESPHome connection test failed', e);
    return {
      en: `Connection failed: ${e.message}`,
      fr: `Échec de la connexion : ${e.message}`,
    };
  }
});

// --- Manifest action: reconnect every node -----------------------------------
gladys.onAction('reconnect', async () => {
  logger.info('Action reconnect -> closing every connection and reconnecting');
  try {
    await manager.disconnectAll();
    const devices = await publishDevices();
    return {
      en: `Reconnected: ${devices.length} node(s) available.`,
      fr: `Reconnexion effectuée : ${devices.length} nœud(s) disponible(s).`,
    };
  } catch (e) {
    logger.error('ESPHome reconnection failed', e);
    return {
      en: `Reconnection failed: ${e.message}`,
      fr: `Échec de la reconnexion : ${e.message}`,
    };
  }
});

// --- Configuration updated by the user ---------------------------------------
gladys.onConfigUpdated(async () => {
  logger.info('onConfigUpdated -> reconnecting with the new configuration');
  // An encryption key that changed invalidates every open session: drop them
  // all rather than guess which ones are still valid.
  await manager.disconnectAll();
  await publishDevices().catch((e) => logger.error('Re-publish after config update failed', e));
});

// --- Connection lifecycle ----------------------------------------------------
gladys.on('connected', async () => {
  try {
    // Load the devices the user created, so a pushed state finds its feature.
    await gladys.getDevices();
    await publishDevices();
  } catch (err) {
    logger.error('Post-connection initialization failed', err);
    await gladys
      .setConnectionStatus(false, {
        en: 'Initialization failed, check the integration logs.',
        fr: "L'initialisation a échoué, consultez les logs de l'intégration.",
      })
      .catch(() => {});
  }
});

// --- Graceful shutdown -------------------------------------------------------
gladys.handleShutdown(async (signal) => {
  logger.info(`Received ${signal} -> graceful shutdown`);
  // States are batched over a short window: send what is still pending before
  // the process goes away, otherwise the last readings die with it.
  await flushStates(gladys).catch(() => {});
  // Closing cleanly frees the API slot on each node right away: ESPHome accepts
  // a limited number of simultaneous API clients.
  await manager.disconnectAll();
});

// --- Startup -----------------------------------------------------------------
logger.info('Starting the ESPHome integration...');
gladys.connect().catch((err) => {
  logger.error('Initial connection failed', err);
  process.exit(1);
});
