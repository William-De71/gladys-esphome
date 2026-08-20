# gladys-esphome

External [Gladys Assistant](https://gladysassistant.com) integration to control your **ESPHome** devices (ESP32 / ESP8266) over the local network, through the ESPHome native API.

Built on the [Gladys integration SDK](https://github.com/GladysAssistant/integration-sdk-js), from the [official template](https://github.com/GladysAssistant/integration-template-js).

## What it does

| ESPHome entity  | Gladys support                                    |
| --------------- | ------------------------------------------------- |
| `sensor`        | Numeric sensor, categorized by its `device_class` |
| `binary_sensor` | Binary sensor, categorized by its `device_class`  |
| `text_sensor`   | Text feature                                      |
| `switch`        | Binary switch                                     |
| `light`         | On/off, brightness, color, color temperature      |
| `cover`         | State (open/close/stop) + position                |
| `fan`           | On/off + speed                                    |
| `lock`          | Lock / unlock                                     |
| `button`        | Push                                              |
| `number`        | Writable bounded value                            |
| `climate`       | Target temperature + current temperature          |

Entity types with no Gladys equivalent (`media_player`, `camera`, `select`, `valve`, `date`, …) are left out of discovery rather than mapped to something that could not work.

## Architecture

```
index.js                     SDK wiring: handlers + manifest actions
src/config.js                config normalization, per-node keys, manual nodes
src/devices.js               discovery / state publishing / commands orchestration
src/esphome/
  EsphomeManager.js          one live connection per node, entity key index
  mapping.js                 ESPHome entity -> Gladys feature descriptors
  convert.js                 value translation, both directions
  constants.js               mDNS service, port, external-id scheme
```

## Push model

This is not a polling integration. ESPHome nodes **push** their state changes over a connection kept open, so:

- states reach Gladys from the manager's `onState` callback, through `publishStates()`;
- no `poll_frequency` is declared on the features;
- `onPoll` is only a safety net: it reconnects a node whose session dropped while Gladys kept its device.

## Mediated discovery

Integration containers run on a bridge network and never receive mDNS traffic. The manifest declares the capture:

```json
"network_discovery": [{ "type": "mdns", "service": "_esphomelib._tcp" }]
```

The core captures (network position), the integration interprets (protocol knowledge) and joins the nodes over unicast, which crosses the NAT. Nodes the scan cannot see are declared by hand in the configuration.

## External-id scheme

The platform id is the ESPHome **node name**, stable across reboots and DHCP leases — an IP address is not, so it lives in a device param instead.

```
device : ext:<selector>:esphome:<nodeName>
feature: ext:<selector>:esphome:<nodeName>:<entityType>-<objectId>:<featureKey>
```

The middle segment is the `esphome-client` branded entity id, so a feature received back from Gladys maps to an entity without a lookup table. Parsing splits from the **right**, since both the node name and the object id may contain dashes.

## Encryption

ESPHome 2025.x uses the Noise protocol (`api: encryption: key:`) by default. Keys are per node, so the configuration exposes a default key plus per-node overrides. An empty key means a plaintext connection, which a node without an `encryption` block expects.

## Local development

```bash
npm install
GLADYS_HOST_API_URL="http://localhost:1443" \
GLADYS_INTEGRATION_TOKEN="<token>" \
npm start
```

```bash
npm test          # node --test
npm run lint      # eslint
npm run format    # prettier
```

## Releasing

In GitHub: **Actions → Release → Run workflow**, pick `patch` / `minor` / `major`. The workflow bumps `package.json` and the manifest (version **and** `docker_image` tag), tags the commit and publishes the multi-arch image to ghcr.io.

## Credits

Speaks the ESPHome native API through [`esphome-client`](https://github.com/hjdhjd/esphome-client), a zero-dependency implementation including the Noise handshake.
