// Minimal stand-in for the Gladys SDK instance, exposing only what the modules
// under test call. Keeping it tiny is deliberate: a fake that mirrors the whole
// SDK would pass even when the real contract changed.

/**
 * Build a fake Gladys SDK instance.
 * @param {object} [options] - Options.
 * @param {string} [options.selector] - The integration selector.
 * @param {Array} [options.devices] - The devices the user "created".
 * @param {Array} [options.scanResults] - What the mDNS scan returns.
 * @returns {object} The fake instance, with a `published` log for assertions.
 * @example
 * const gladys = fakeGladys({ scanResults: [{ name: 'salon._esphomelib._tcp.local' }] });
 */
export function fakeGladys({ selector = 'ext-dev-esphome', devices = [], scanResults } = {}) {
  const published = { states: [], devices: [], transports: [] };

  return {
    selector,
    devices,
    published,
    externalId: (suffix) => `ext:${selector}:${suffix}`,
    externalIds: (type, platformId) => {
      const device = `ext:${selector}:${type}:${platformId}`;
      return { device, feature: (key) => `${device}:${key}` };
    },
    scanNetwork: async () => {
      if (scanResults instanceof Error) {
        throw scanResults;
      }
      return scanResults || [];
    },
    publishStates: async (states) => {
      published.states.push(...states);
    },
    publishDiscoveredDevices: async (list) => {
      published.devices = list;
    },
    publishTransports: async (transports) => {
      published.transports.push(...transports);
    },
  };
}
