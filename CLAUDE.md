# CLAUDE.md

Project rules for coding assistants (Claude Code reads this file) and for human
contributors.

## What this is

A Gladys Assistant **external integration** for ESPHome devices (ESP32,
ESP8266): a Node.js service (Node 22+, ESM, no build step) running in its own
sandboxed Docker container, talking to Gladys through
[`@gladysassistant/integration-sdk`](https://github.com/GladysAssistant/integration-sdk-js)
and to the nodes through the ESPHome native API
([`esphome-client`](https://github.com/hjdhjd/esphome-client), TCP 6053, Noise
encryption). `type: "device"`, local only. Nodes are found through the mDNS
capture Gladys performs (`network_discovery`), push their states over a
session kept open, and their `event` entities and outages become scene
triggers.

## Commands

```bash
npm install
npm test                                  # node --test, never touches the network
node --test test/app.test.js              # one file
node --test --test-name-pattern "scene"   # tests whose name matches
npm run lint                              # ESLint
npm run format:check                      # Prettier, as the CI runs it
npm run format                            # Prettier, fix in place
npx github:GladysAssistant/integration-store . --skip-image-check
```

## Architecture

```
index.js                      SDK wiring only: createApp(new GladysIntegration()) + connect
src/app.js                    every handler, registered before connect(); the tests drive
                              it with the fake Gladys of the SDK (test/app.test.js)
src/events.js                 scene triggers event_fired, node_offline, node_online
src/devices.js                discovery, state batching (publishChangedStates), commands
src/config.js                 config normalization, per-node keys, manual nodes
src/messages.js               runtime messages, en / fr / de / es
src/esphome/EsphomeManager.js one session per node, entity index, last states, actions
src/esphome/mapping.js        ESPHome entity -> Gladys feature descriptors
src/esphome/convert.js        values both ways; withWireDefaults completes protobuf events
src/esphome/actions.js        user-defined actions (`api: actions:`): typed arguments
.github/scripts/release.mjs   version, changelog, version files, PR title checks
```

## Rules

- **Forever fields**: device and feature external ids
  (`ext:<selector>:esphome:<node>[:<type>-<objectId>:<key>]`), and for each
  feature its `category`, `type`, `unit`, `min`, `max`; the `config_schema`
  and action keys; the scene trigger keys (`event_fired`, `node_offline`,
  `node_online`), their fields and variables; the scene action `run_action`,
  its fields and outputs. `test/structure.test.js` checks the discovery
  against `test/fixtures/discovery.baseline.json` and the manifest against
  `test/fixtures/manifest.baseline.json` (v1.1.0). A change needs an entry in
  its `ALLOWED_CHANGES` with the migration, in the changelog, the docs and the
  forum message: users would have to delete and recreate their devices.
- **New entity types** go through `describeEntity` with a category/type pair
  the Gladys front knows (the list is pinned in `test/mapping.test.js`), and
  never test `event.x === undefined` as "no reading": protobuf omits a field at
  its default value, `withWireDefaults` puts it back. "No reading" is
  `missingState` or NaN.
- **Four API slots per node**: never open a second session to a node; go
  through `EsphomeManager.connect`, which shares the attempt in flight.
- **States**: only the changed ones, through `publishChangedStates` (heartbeat
  1 h), after the 200 ms batching window; a binary state keeps its transitions.
  A device created or updated receives the last states the node reported
  (`onDeviceCreated` / `onDeviceUpdated`), as ESPHome only pushes changes.
- **Scene events** on transitions only, flat scalar data limited to the
  declared variables. `node_offline` waits one minute (reboots and OTA updates
  fire nothing), `node_online` only follows a fired `node_offline`. After a
  `run_action`, the events of that node fire nothing for 2 s, so an action that
  fires an event cannot loop on its own scene.
- **Language**: Gladys does not send it with a command or a scene action.
  Error messages are in English (they also go to the logs); every text Gladys
  shows comes from the manifest or `src/messages.js`, in four languages.
- **The container rootfs is read-only** and the integration stores nothing:
  the node addresses live in the device params.
- **User-facing text** exists in en, fr, de and es: manifest,
  `src/messages.js`, `docs/*.md`, `README*.md`. `test/i18n.test.js` checks it.
  Images in `docs/*.md` use `raw.githubusercontent.com` URLs (the store
  re-hosts the docs), relative paths in the READMEs.
- **Versions belong to the Release workflow**: never edit `version` in
  `package.json`, `package-lock.json` or the manifest, nor the `docker_image`
  tag.
- **Changelog**: Ne jamais éditer CHANGELOG.md à la main, il est généré à la
  release. Écris le titre de PR comme la ligne que l'utilisateur lira.
- **Style**: Prettier formats, ESLint catches mistakes. Comments explain why,
  in English. Tests never touch the network.
