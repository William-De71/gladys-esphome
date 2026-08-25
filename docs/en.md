# ESPHome integration

This integration controls your **ESPHome** devices (ESP32, ESP8266) from Gladys Assistant, directly on your local network, through the ESPHome **native API**. No cloud, no MQTT broker, no Home Assistant required.

## What it does

Unlike an off-the-shelf device, an ESPHome node exposes exactly what **you** declared in its YAML file. The integration therefore adapts to whatever each node announces:

| ESPHome component | What you get in Gladys                                  |
| ----------------- | ------------------------------------------------------- |
| `sensor`          | Numeric sensor (temperature, humidity, power, battery…) |
| `binary_sensor`   | Binary sensor (motion, opening, presence, leak, smoke…) |
| `text_sensor`     | Text sensor                                             |
| `switch`          | Switch (on/off)                                         |
| `light`           | Light: on/off, brightness, color, color temperature     |
| `cover`           | Cover or curtain: open, close, stop, position           |
| `fan`             | Fan: on/off and speed                                   |
| `lock`            | Lock: lock / unlock                                     |
| `button`          | Push button                                             |
| `number`          | Writable numeric setting (slider)                       |
| `climate`         | Thermostat: setpoint and measured temperature           |

Types Gladys has no equivalent for (`media_player`, `camera`, `select`, `valve`, `date`…) are simply left out of discovery.

### States arrive in real time

ESPHome **pushes** its state changes: the integration keeps a connection open to every node, and Gladys receives the new value the moment it changes. There is no polling interval to tune.

## Requirements

- One or more devices running **ESPHome 2025.10 or newer**.
- The native API enabled in your YAML (it is by default):

  ```yaml
  api:
    encryption:
      key: 'your_base64_key'
  ```

- Gladys and your ESPHome nodes must be on the **same local network**.

## Setup

### 1. The encryption key

Open the integration's Configuration screen and paste, into **Encryption key**, the key declared under `api: encryption: key:` in your YAML.

If **all** your nodes share the same key (the common case when using a shared `!secret`), this is the only thing to fill in.

> If your nodes have no encryption at all (`api:` with no `encryption` block), leave this field empty.

### 2. Nodes with a different key

If some nodes have their own key, fill in **Keys per node**, one node per line:

```
living_room|kBv1s2f3G4h5J6k7L8m9N0p1Q2r3S4t5U6v7W8x9Y0=
kitchen|9xQm4Zt6R8s0T2u4V6w8X0y2Z4a6B8c0D2e4F6g8H0=
```

The node name is the one declared in `esphome: name:`. These keys take precedence over the default key.

### 3. Discover your devices

Go to the **Discover** screen and run a scan. The ESPHome nodes on your network appear there with all their entities. Add the ones you want: **no IP address to type**.

Discovery uses mDNS (the protocol ESPHome announces itself with). Gladys performs the capture itself, because the integration runs in a container that never receives that kind of traffic.

### 4. If a node is not found

Some networks block mDNS (separate VLANs, Wi-Fi with client isolation, a router filtering multicast). In that case, declare the node by hand under **Nodes added by hand**, one address per line:

```
living-room.local
192.168.1.42
192.168.1.43:6054
```

The port is optional (6053 by default). Once connected, the node reports its real name itself: a node added by IP address still shows up under its ESPHome name, and it keeps working even if its IP address changes later.

> **If that node has an encryption key of its own**, declare it under **Keys per node** using **the same address** you typed here, not its ESPHome name:
>
> ```
> 192.168.1.42|kBv1s2f3G4h5J6k7L8m9N0p1Q2r3S4t5U6v7W8x9Y0=
> ```
>
> The reason is simple: its name is only known once the connection succeeds, and the connection needs the key in the first place. This does not apply to nodes found by the scan, nor to nodes using the default key.

## Available actions

- **Test the connection**: runs a full discovery and tells you how many nodes answered and how many features are available.
- **Reconnect the nodes**: closes every connection and reopens them. Useful after reflashing a node or changing a key.

## Understanding sensors: why `device_class` matters

Gladys needs to know **what a sensor measures** to display it properly (icon, unit, chart). ESPHome carries that information through `device_class`.

With a `device_class`, your sensor arrives typed:

```yaml
sensor:
  - platform: dht
    temperature:
      name: 'Living room temperature'
      device_class: temperature # -> temperature sensor in Gladys
    humidity:
      name: 'Living room humidity'
      device_class: humidity # -> humidity sensor in Gladys
```

**Without a `device_class`, the sensor still shows up**, but under the generic "Unknown" category. It works and its history is kept, but it gets no specific icon or category. If one of your sensors appears that way, add the matching `device_class` to your YAML and run discovery again.

Two families of sensors escape that rule, because ESPHome never gives them a `device_class` — Home Assistant's vocabulary has no word for what they measure. The integration recognizes them from the shape of their declaration:

| ESPHome declaration                | Gladys category |
| ---------------------------------- | --------------- |
| `unit_of_measurement: "°"`         | Angle           |
| no unit and `accuracy_decimals: 0` | Counter         |

This is the everyday case with mmWave sensors (`ld2350`, `ld2450`…): their target counters (_Moving / Still / Presence Target Count_) land under **Counter**, and their target angles (_Target-1 Angle_) under **Angle**. A firmware that explicitly declares `state_class: measurement_angle`, `total` or `total_increasing` is classified on that declaration first.

Recognized `device_class` values include: `temperature`, `humidity`, `pressure`, `illuminance`, `battery`, `signal_strength`, `carbon_dioxide`, `pm25`, `pm10`, `power`, `energy`, `voltage`, `current`, `distance`, `moisture`, `speed`, `duration`, and for binary sensors: `motion`, `occupancy`, `door`, `window`, `smoke`, `gas`, `moisture`, `vibration`, `tamper`, `battery`, `lock`.

## Troubleshooting

**No node is found by the scan**
Check that your nodes are powered on and connected to Wi-Fi. If your network blocks mDNS, add them by hand (see above).

**A node is found but does not show up in the list**
This is almost always a mismatched encryption key. The node is visible on the network but refuses the connection. Check the key in its YAML, and use **Keys per node** if it differs from the default key.

**A node disappears then comes back**
That is expected after a node reboot (OTA update, power cut). The integration reconnects on its own, with a growing delay so it never floods the network.

**A device shows up as "unreachable"**
The connection to that node dropped: node powered off, out of Wi-Fi range, or rebooting. The integration retries automatically. Note also that an ESPHome node accepts a limited number of simultaneous API clients: if the same node is already connected to a Home Assistant or an open ESPHome log console, it may refuse one more connection. Close the clients you do not need and use the **Reconnect the nodes** action.

**An entity does not show up at all**
Its type has no Gladys equivalent (see the features table), or it is marked `internal: true` in your YAML — in which case ESPHome does not expose it on its API at all.
