// -----------------------------------------------------------------------------
// Scene triggers: what HAPPENS on the ESPHome side, as opposed to a state.
//
//   event_fired   an ESPHome `event` entity fired (a button clicked twice, a
//                 doorbell, a remote code received): the entity has no state
//                 to show, so a scene is the only place it can be used;
//   node_offline  a node stayed disconnected for NODE_OFFLINE_GRACE_MS;
//   node_online   that same node came back.
//
// One event per transition: a node that drops for an OTA update and is back
// within the grace period fires nothing, and `node_online` only follows a
// `node_offline` that was fired. Data is flat and limited to the variables the
// manifest declares (the core drops any other key anyway).
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { NODE_OFFLINE_GRACE_MS, SCENE_ACTION_QUIET_MS } from './esphome/constants.js';

const logger = createLogger({ name: 'esphome-events' });

export const SCENE_TRIGGERS = {
  EVENT_FIRED: 'event_fired',
  NODE_OFFLINE: 'node_offline',
  NODE_ONLINE: 'node_online',
};

/**
 * Create the scene event source of the integration.
 * @param {object} gladys - The Gladys SDK instance.
 * @param {object} [options] - Options (the tests shorten the delays).
 * @param {number} [options.graceMs] - How long a node stays down before `node_offline`.
 * @param {number} [options.quietMs] - Quiet window of `event_fired` after a scene action.
 * @param {() => number} [options.now] - Clock.
 * @returns {object} `{ entityEvent, connectionChange, quiet, stop }`.
 * @example
 * const events = createSceneEvents(gladys);
 * events.connectionChange('salon', false, '192.168.1.42:6053');
 */
export function createSceneEvents(gladys, options = {}) {
  const graceMs = options.graceMs ?? NODE_OFFLINE_GRACE_MS;
  const quietMs = options.quietMs ?? SCENE_ACTION_QUIET_MS;
  const now = options.now || Date.now;

  /** Nodes seen connected in this process, by lower-cased name. */
  const seenOnline = new Set();
  /** Nodes whose `node_offline` was fired, by lower-cased name. */
  const reportedOffline = new Map();
  /** Grace timers of the nodes currently down, by lower-cased name. */
  const offlineTimers = new Map();
  /** End of the quiet window of each node, by lower-cased name. */
  const quietUntil = new Map();

  /**
   * Fire one scene event, never throwing: a refused event (rate limit, Gladys
   * restarting) must not break the state flow that called it.
   * @param {string} key - The trigger key.
   * @param {object} data - The flat event data.
   * @returns {Promise<void>} Resolves once sent or logged.
   */
  async function fire(key, data) {
    try {
      await gladys.publishSceneEvent(key, data);
      logger.debug(`Scene event ${key} sent: ${JSON.stringify(data)}`);
    } catch (e) {
      logger.warn(`Scene event ${key} refused: ${e.message}`);
    }
  }

  return {
    /**
     * An ESPHome `event` entity fired.
     * @param {string} nodeName - The node name.
     * @param {object} entity - The event entity.
     * @param {object} event - The ESPHome event (`eventType`).
     * @returns {Promise<void>} Resolves once sent.
     */
    async entityEvent(nodeName, entity, event) {
      const eventType = event && typeof event.eventType === 'string' ? event.eventType : '';
      if (!eventType) {
        return;
      }
      const node = String(nodeName).toLowerCase();
      if ((quietUntil.get(node) || 0) > now()) {
        logger.debug(
          `Event "${eventType}" of "${nodeName}" ignored: a scene action just ran there`,
        );
        return;
      }
      await fire(SCENE_TRIGGERS.EVENT_FIRED, {
        node: nodeName,
        entity: entity.name || entity.objectId,
        entity_id: entity.objectId,
        event_type: eventType,
      });
    },

    /**
     * A node connected or disconnected.
     * @param {string} nodeName - The node name.
     * @param {boolean} connected - Whether it is connected now.
     * @param {string} [address] - Its `host:port`, for the scene.
     * @returns {void}
     */
    connectionChange(nodeName, connected, address = '') {
      const node = String(nodeName).toLowerCase();
      if (connected) {
        seenOnline.add(node);
        clearTimeout(offlineTimers.get(node));
        offlineTimers.delete(node);
        const since = reportedOffline.get(node);
        if (since !== undefined) {
          reportedOffline.delete(node);
          fire(SCENE_TRIGGERS.NODE_ONLINE, {
            node: nodeName,
            address,
            offline_minutes: Math.round((now() - since) / 60000),
          });
        }
        return;
      }
      // A node never seen online in this process has no transition to report:
      // it was already down when the integration started.
      if (!seenOnline.has(node) || offlineTimers.has(node) || reportedOffline.has(node)) {
        return;
      }
      const downSince = now();
      const timer = setTimeout(() => {
        offlineTimers.delete(node);
        reportedOffline.set(node, downSince);
        fire(SCENE_TRIGGERS.NODE_OFFLINE, { node: nodeName, address });
      }, graceMs);
      // Never a reason to hold the process open.
      if (typeof timer.unref === 'function') {
        timer.unref();
      }
      offlineTimers.set(node, timer);
    },

    /**
     * Open the quiet window of a node after a scene ran one of its actions.
     * @param {string} nodeName - The node name.
     * @returns {void}
     */
    quiet(nodeName) {
      quietUntil.set(String(nodeName).toLowerCase(), now() + quietMs);
    },

    /**
     * Cancel the pending grace timers (shutdown).
     * @returns {void}
     */
    stop() {
      offlineTimers.forEach((timer) => clearTimeout(timer));
      offlineTimers.clear();
    },
  };
}
