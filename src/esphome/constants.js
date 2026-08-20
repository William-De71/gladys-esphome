// -----------------------------------------------------------------------------
// ESPHome protocol constants and external-id scheme.
//
// External ids follow the SDK convention (`gladys.externalIds(type, platformId)`
// prefixes them with `ext:<selector>:`). The platform id we use is the ESPHome
// NODE NAME, which is stable across reboots and DHCP leases — an IP address is
// not, so it never appears in an external id, only in a device param.
//
//   device : ext:<selector>:esphome:<nodeName>
//   feature: ext:<selector>:esphome:<nodeName>:<entityType>-<objectId>
//
// The feature suffix IS the esphome-client branded entity id (`${type}-${objectId}`),
// so a feature received back from Gladys maps to an entity with a single split.
// -----------------------------------------------------------------------------

// mDNS service ESPHome nodes announce themselves on. Declared in the manifest
// `network_discovery` field, otherwise the core rejects the scan with a 403.
export const MDNS_SERVICE = '_esphomelib._tcp';

// Default port of the ESPHome native API.
export const DEFAULT_PORT = 6053;

// Namespace of our device external ids (see the scheme above).
export const EXTERNAL_ID_TYPE = 'esphome';

// Device param carrying the last known address of a node. Kept as a param and
// not in the external id: a DHCP lease changes, the node name does not.
export const PARAM_ADDRESS = 'ADDRESS';

// Device param carrying the ESPHome firmware version, for display only.
export const PARAM_VERSION = 'ESPHOME_VERSION';

// Gladys polls devices, but ESPHome pushes its states over the native API. We
// keep the connection open and publish on every state change, so no
// `poll_frequency` is declared on the features (see convert.js).
export const RECONNECT_INITIAL_DELAY_MS = 5000;
export const RECONNECT_MAX_DELAY_MS = 300000;
