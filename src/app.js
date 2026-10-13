// -----------------------------------------------------------------------------
// Every handler of the integration, wired on a Gladys SDK instance.
//
// index.js only builds the real SDK instance and connects; the tests build the
// SDK's fake Gladys (`@gladysassistant/integration-sdk/testing`) and a fake
// node manager, and drive the very same handlers (test/app.test.js).
//
// Push model: unlike a polling integration, ESPHome nodes send their state
// changes as they happen over a connection kept open. States therefore reach
// Gladys from the manager's callback (`onState`), never from a poll. Keeping
// that flow alive is the watchdog's job: the client library reconnects a
// session it once had, and the watchdog covers the one it never got.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { EsphomeManager } from './esphome/EsphomeManager.js';
import { parseActionArguments } from './esphome/actions.js';
import { normalizeConfig, resolveEncryptionKey } from './config.js';
import {
  buildDiscoveredDevices,
  publishEntityState,
  flushStates,
  publishNodeTransport,
  setDeviceValue,
  parseDeviceExternalId,
  reconnectKnownNodes,
} from './devices.js';
import { createSceneEvents } from './events.js';
import { PARAM_ADDRESS, RECONNECT_WATCHDOG_INTERVAL_MS } from './esphome/constants.js';
import { MESSAGES, testOk, testFailed, reconnectOk, reconnectFailed } from './messages.js';

const logger = createLogger({ name: 'esphome' });

/**
 * Register every handler on the SDK instance. Call it BEFORE `connect()`.
 * @param {object} gladys - The Gladys SDK instance (real or fake).
 * @param {object} [options] - Dependencies the tests replace.
 * @param {object} [options.manager] - The node manager (an EsphomeManager by default).
 * @param {object} [options.sceneEvents] - Options of createSceneEvents (delays, clock).
 * @returns {object} `{ manager, publishDevices, startReconnectWatchdog, shutdown }`.
 * @example
 * const app = createApp(new GladysIntegration());
 */
export function createApp(gladys, options = {}) {
  const manager = options.manager || new EsphomeManager();
  const sceneEvents = createSceneEvents(gladys, options.sceneEvents);

  let config = normalizeConfig();

  /**
   * Publish one state event, naming the ENTITY on failure: a node exposes
   * dozens of them, and a failure that only says "salon" leaves no way to tell
   * which reading caused it.
   * @param {string} nodeName - The node name.
   * @param {object} entity - The entity.
   * @param {object} event - The ESPHome state event.
   * @returns {Promise<void>} Resolves once queued or logged.
   */
  function publishState(nodeName, entity, event) {
    return publishEntityState(gladys, nodeName, entity, event).catch((e) => {
      const label = entity ? entity.name || entity.objectId || entity.id : 'unknown entity';
      logger.warn(`Publishing the state of "${nodeName}"/"${label}" failed: ${e.message}`);
      logger.debug(e);
    });
  }

  /**
   * The `host:port` a node is reached at, for the scene events.
   * @param {string} nodeName - The node name.
   * @returns {string} The address, or an empty string.
   */
  function addressOf(nodeName) {
    const address = manager.addresses?.get(String(nodeName).toLowerCase());
    return address ? `${address.host}:${address.port}` : '';
  }

  // --- State push: a node reports a change -----------------------------------
  manager.onState((nodeName, entity, event) => {
    if (entity && entity.type === 'event') {
      // An event entity has no state to show: it only exists for scenes.
      sceneEvents.entityEvent(nodeName, entity, event);
      return;
    }
    publishState(nodeName, entity, event);
  });

  // --- Reachability: a node connects or drops --------------------------------
  manager.onConnectionChange((nodeName, connected) => {
    logger.info(`ESPHome node "${nodeName}" is ${connected ? 'connected' : 'disconnected'}`);
    publishNodeTransport(gladys, nodeName, connected).catch(() => {});
    sceneEvents.connectionChange(nodeName, connected, addressOf(nodeName));
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
      await gladys.setConnectionStatus(false, MESSAGES.noNodeFound).catch(() => {});
    }
    return devices;
  }

  // --- Reconnection watchdog -------------------------------------------------
  // The client library reconnects a session it once established, but never
  // retries a connection that failed outright — a node powered off when the
  // container started stays dead forever. This tick is that retry, and it is
  // also what brings back a node whose mDNS scan came up empty.
  /** @type {NodeJS.Timeout|null} */
  let watchdogTimer = null;

  /**
   * Start the periodic reconnection of the known nodes. Idempotent: calling it
   * twice keeps a single timer.
   * @returns {void}
   */
  function startReconnectWatchdog() {
    if (watchdogTimer) {
      return;
    }
    watchdogTimer = setInterval(() => {
      reconnectKnownNodes(gladys, manager, config)
        .then(async (count) => {
          // A node that came back exposes entities Gladys has no feature for
          // yet if its YAML changed while it was away; re-publishing costs one
          // call and keeps the device in sync.
          if (count > 0) {
            await publishDevices().catch(() => {});
          }
        })
        .catch((e) => logger.debug(`Reconnection watchdog failed: ${e.message}`));
    }, RECONNECT_WATCHDOG_INTERVAL_MS);
    // Never a reason to hold the process open.
    if (typeof watchdogTimer.unref === 'function') {
      watchdogTimer.unref();
    }
  }

  /**
   * The node behind a device of this integration, or null for any other device.
   * @param {object} device - A Gladys device.
   * @returns {string|null} The node name.
   */
  function nodeOfDevice(device) {
    try {
      return parseDeviceExternalId(gladys, device.external_id);
    } catch {
      return null;
    }
  }

  /**
   * Publish again what a node already reported, for a device the user just
   * created or updated. ESPHome only pushes a state when it CHANGES, and Gladys
   * drops every state sent before the device existed: without this, a relay
   * that was ON when the device was added would show nothing until it moves.
   * @param {object} device - The created or updated device.
   * @returns {Promise<void>} Resolves once queued.
   */
  async function republishDevice(device) {
    const nodeName = nodeOfDevice(device);
    if (!nodeName) {
      return;
    }
    const states = manager.lastStatesOf(nodeName);
    logger.info(`Device "${device.name}" saved: publishing its ${states.length} known state(s)`);
    await Promise.all(states.map(({ entity, event }) => publishState(nodeName, entity, event)));
    await publishNodeTransport(gladys, nodeName, Boolean(manager.getClient(nodeName)));
  }

  /**
   * Resolve the node a scene names: its ESPHome name (`esphome: name:`), or the
   * name of its device in Gladys — whichever the scene author typed.
   * @param {string} text - What the scene wrote.
   * @returns {string} The node name.
   */
  function resolveNodeName(text) {
    if (manager.getClient(text)) {
      return text;
    }
    const wanted = text.toLowerCase();
    const device = (gladys.devices || []).find(
      (candidate) =>
        String(candidate.name || '').toLowerCase() === wanted && nodeOfDevice(candidate),
    );
    return device ? nodeOfDevice(device) : text;
  }

  // --- Discovery: the user asks for the list of devices ----------------------
  gladys.onScanRequest(async () => {
    logger.info('onScanRequest -> discovering the ESPHome nodes');
    await publishDevices();
  });

  // --- Command: the user acts on a controllable feature ----------------------
  gladys.onSetValue(async (device, feature, value) => {
    logger.info(`onSetValue <- ${feature.external_id} = ${value}`);
    await setDeviceValue(gladys, manager, device, feature, value);
  });

  // --- A device is saved: give it the states it missed -----------------------
  gladys.onDeviceCreated(republishDevice);
  gladys.onDeviceUpdated(republishDevice);

  // --- Polling: Gladys asks to refresh a device ------------------------------
  // ESPHome pushes its states, so there is nothing to fetch here. What a poll
  // CAN fix is a node whose connection dropped while Gladys kept its device:
  // retry the connection so the state flow resumes on its own.
  //
  // No feature declares a `poll_frequency`, so Gladys never calls this on its
  // own — the watchdog above is what actually reconnects a dropped node. This
  // stays wired for an explicit refresh, and costs nothing when never called.
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
        { name: nodeName, host, port: Number(port) || undefined },
        resolveEncryptionKey(config, nodeName),
        config.connection_timeout,
      )
      .catch((e) => {
        logger.debug(`Reconnection of "${nodeName}" failed: ${e.message}`);
      });
  });

  // --- Scene action: run a user-defined ESPHome action -----------------------
  gladys.onSceneAction('run_action', async (fields) => {
    const node = String(fields.node || '').trim();
    const action = String(fields.action || '').trim();
    if (!node || !action) {
      throw new Error('ESPHome: the node and the action are both required');
    }
    const nodeName = resolveNodeName(node);
    const values = parseActionArguments(fields.arguments);
    // Opened BEFORE the action leaves: the event it may fire on the node must
    // not start the scene that is running it.
    sceneEvents.quiet(nodeName);
    const run = manager.runAction(nodeName, action, values);
    logger.info(`Scene action run_action -> "${nodeName}" ran "${run.name}"`);
    return { node: nodeName, action: run.name };
  });

  // --- Manifest action: test the connection ----------------------------------
  gladys.onAction('test_connection', async () => {
    try {
      const devices = await publishDevices();
      if (devices.length === 0) {
        return MESSAGES.testNoAnswer;
      }
      const featureCount = devices.reduce((total, device) => total + device.features.length, 0);
      return testOk(devices.length, featureCount);
    } catch (e) {
      logger.error('ESPHome connection test failed', e);
      return testFailed(e.message);
    }
  });

  // --- Manifest action: reconnect every node ---------------------------------
  gladys.onAction('reconnect', async () => {
    logger.info('Action reconnect -> closing every connection and reconnecting');
    try {
      await manager.disconnectAll();
      const devices = await publishDevices();
      return reconnectOk(devices.length);
    } catch (e) {
      logger.error('ESPHome reconnection failed', e);
      return reconnectFailed(e.message);
    }
  });

  // --- Configuration updated by the user -------------------------------------
  gladys.onConfigUpdated(async () => {
    logger.info('onConfigUpdated -> reconnecting with the new configuration');
    // An encryption key that changed invalidates every open session: drop them
    // all rather than guess which ones are still valid.
    await manager.disconnectAll();
    await publishDevices().catch((e) => logger.error('Re-publish after config update failed', e));
  });

  // --- Connection lifecycle --------------------------------------------------
  gladys.on('connected', async () => {
    try {
      // Load the devices the user created, so a pushed state finds its feature
      // — and so discovery can reuse their stored addresses when a scan comes
      // up empty (see knownNodes).
      await gladys.getDevices();
      await publishDevices();
      startReconnectWatchdog();
    } catch (err) {
      logger.error('Post-connection initialization failed', err);
      await gladys.setConnectionStatus(false, MESSAGES.initFailed).catch(() => {});
    }
  });

  /**
   * Stop the timers, send the pending states and close every session.
   * @returns {Promise<void>} Resolves once done.
   */
  async function shutdown() {
    if (watchdogTimer) {
      clearInterval(watchdogTimer);
      watchdogTimer = null;
    }
    sceneEvents.stop();
    // States are batched over a short window: send what is still pending
    // before the process goes away, otherwise the last readings die with it.
    await flushStates(gladys).catch(() => {});
    // Closing cleanly frees the API slot on each node right away: ESPHome
    // accepts a limited number of simultaneous API clients.
    await manager.disconnectAll();
  }

  return { manager, publishDevices, startReconnectWatchdog, shutdown };
}
