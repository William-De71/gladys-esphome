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

// How long a pushed state waits before being sent, so the states arriving in
// the same burst leave in ONE request. ESPHome pushes one event per entity, and
// a node that reports many of them at once (an mmWave sensor tracking targets)
// would otherwise fire one HTTP call per entity and hit the core's rate limit
// ("Too Many Requests"). 200 ms is short enough to stay imperceptible on a
// dashboard, long enough to collapse a burst.
export const STATE_FLUSH_DELAY_MS = 200;

// Maximum states the SDK accepts in one `publishStates` call. Anything beyond
// is split across requests rather than rejected wholesale.
export const MAX_STATES_PER_REQUEST = 100;

// Number of retries `openEspHomeClient` may spend on ONE connection attempt.
// The library defaults to 3 (so 4 sockets), which is exactly the number of API
// clients the default ESPHome firmware accepts: a single failing scan would
// saturate the node and get every later attempt rejected. 1 retry (2 sockets)
// still absorbs a node that is rebooting, and leaves it room to answer.
export const CONSTRUCTION_RETRIES = 1;
