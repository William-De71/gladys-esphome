# Intégration ESPHome

Cette intégration permet de piloter vos appareils **ESPHome** (ESP32, ESP8266) depuis Gladys Assistant, directement sur votre réseau local, via l'**API native** ESPHome. Aucun cloud, aucun broker MQTT, aucun Home Assistant nécessaire.

## Fonctionnalités

Contrairement à un appareil du commerce, un nœud ESPHome expose exactement ce que **vous** avez déclaré dans son fichier YAML. L'intégration s'adapte donc à ce que chaque nœud annonce :

| Composant ESPHome | Ce que vous obtenez dans Gladys                                   |
| ----------------- | ----------------------------------------------------------------- |
| `sensor`          | Capteur numérique (température, humidité, puissance, batterie...) |
| `binary_sensor`   | Capteur binaire (mouvement, ouverture, présence, fuite, fumée...) |
| `text_sensor`     | Capteur texte (lecture seule)                                     |
| `text`            | Texte modifiable : envoyer un message au nœud (écran)             |
| `switch`          | Interrupteur (on/off)                                             |
| `light`           | Lampe : on/off, luminosité, couleur, température de couleur       |
| `cover`           | Volet ou rideau : ouvrir, fermer, arrêter, position               |
| `fan`             | Ventilateur : on/off et vitesse                                   |
| `lock`            | Serrure : verrouiller / déverrouiller                             |
| `button`          | Bouton poussoir                                                   |
| `number`          | Réglage numérique modifiable (curseur)                            |
| `climate`         | Thermostat : consigne et température mesurée                      |

Les types qui n'ont pas d'équivalent dans Gladys (`media_player`, `camera`, `select`, `valve`, `date`...) sont simplement ignorés lors de la découverte.

### Les états arrivent en temps réel

ESPHome **pousse** ses changements d'état : l'intégration garde une connexion ouverte vers chaque nœud, et Gladys reçoit la nouvelle valeur à l'instant où elle change. Il n'y a pas d'intervalle d'interrogation à régler.

## Prérequis

- Un ou plusieurs appareils sous **ESPHome 2025.10 ou plus récent**.
- L'API native activée dans votre YAML (c'est le cas par défaut) :

  ```yaml
  api:
    encryption:
      key: 'votre_clé_base64'
  ```

- Gladys et vos nœuds ESPHome doivent être sur le **même réseau local**.

## Configuration

### 1. La clé de chiffrement

Ouvrez l'écran de configuration de l'intégration et collez, dans **Clé de chiffrement**, la clé déclarée sous `api: encryption: key:` dans votre YAML.

Si **tous** vos nœuds partagent la même clé (le cas le plus courant quand on utilise un `!secret` commun), c'est la seule chose à renseigner.

> Si vos nœuds n'ont pas de chiffrement du tout (`api:` sans bloc `encryption`), laissez ce champ vide.

### 2. Les nœuds ayant une clé différente

Si certains nœuds ont leur propre clé, remplissez **Clés par nœud**, une ligne par nœud :

```
salon|kBv1s2f3G4h5J6k7L8m9N0p1Q2r3S4t5U6v7W8x9Y0=
cuisine|9xQm4Zt6R8s0T2u4V6w8X0y2Z4a6B8c0D2e4F6g8H0=
```

Le nom du nœud est celui déclaré dans `esphome: name:`. Ces clés sont prioritaires sur la clé par défaut.

### 3. Découvrez vos appareils

Allez dans l'écran **Découverte** et lancez un scan. Les nœuds ESPHome présents sur votre réseau y apparaissent avec toutes leurs entités. Ajoutez ceux que vous voulez : **aucune adresse IP à saisir**.

La découverte utilise le mDNS (le protocole par lequel ESPHome s'annonce sur le réseau). C'est Gladys qui effectue la capture, car l'intégration tourne dans un conteneur qui ne reçoit pas ce type de trafic.

### 4. Si un nœud n'est pas trouvé

Certains réseaux bloquent le mDNS (VLAN séparés, Wi-Fi avec isolation des clients, routeur filtrant le multicast). Dans ce cas, renseignez le nœud à la main dans **Nœuds ajoutés à la main**, une adresse par ligne :

```
salon.local
192.168.1.42
192.168.1.43:6054
```

Le port est facultatif (6053 par défaut). Une fois connecté, le nœud annonce lui-même son vrai nom : un nœud ajouté par son adresse IP apparaîtra bien sous son nom ESPHome, et il continuera de fonctionner même si son adresse IP change ensuite.

> **Si ce nœud a une clé de chiffrement qui lui est propre**, indiquez-la dans **Clés par nœud** en utilisant **la même adresse** que celle saisie ici, et non son nom ESPHome :
>
> ```
> 192.168.1.42|kBv1s2f3G4h5J6k7L8m9N0p1Q2r3S4t5U6v7W8x9Y0=
> ```
>
> La raison est simple : son nom n'est connu qu'une fois la connexion établie, et la connexion a justement besoin de la clé. Cela ne concerne pas les nœuds trouvés par le scan, ni ceux qui utilisent la clé par défaut.

## Actions disponibles

- **Tester la connexion** : relance une découverte complète et vous indique combien de nœuds ont répondu et combien de fonctionnalités sont disponibles.
- **Reconnecter les nœuds** : ferme toutes les connexions et les rouvre. Utile après avoir reflashé un nœud ou changé une clé.

## Comprendre les capteurs : l'importance de `device_class`

Gladys a besoin de savoir **ce que mesure** un capteur pour l'afficher correctement (icône, unité, graphique). ESPHome transmet cette information via `device_class`.

Avec un `device_class`, votre capteur arrive typé :

```yaml
sensor:
  - platform: dht
    temperature:
      name: 'Température salon'
      device_class: temperature # -> capteur de température dans Gladys
    humidity:
      name: 'Humidité salon'
      device_class: humidity # -> capteur d'humidité dans Gladys
```

**Sans `device_class`, le capteur apparaît quand même**, mais dans la catégorie générique « Inconnu ». Il fonctionne, il est historisé, mais il n'aura ni icône ni catégorie spécifique. Si un de vos capteurs s'affiche ainsi, ajoutez le `device_class` correspondant dans votre YAML et relancez une découverte.

Les `device_class` reconnus incluent : `temperature`, `humidity`, `pressure`, `illuminance`, `battery`, `signal_strength`, `carbon_dioxide`, `pm25`, `pm10`, `power`, `energy`, `voltage`, `current`, `distance`, `moisture`, `speed`, `duration`, et pour les capteurs binaires : `motion`, `occupancy`, `door`, `window`, `smoke`, `gas`, `moisture`, `vibration`, `tamper`, `battery`, `lock`.

## Résolution de problèmes

**Aucun nœud n'est trouvé lors du scan**
Vérifiez que vos nœuds sont allumés et connectés au Wi-Fi. Si votre réseau bloque le mDNS, ajoutez-les à la main (voir plus haut).

**Un nœud est trouvé mais n'apparaît pas dans la liste**
C'est presque toujours une clé de chiffrement qui ne correspond pas. Le nœud est visible sur le réseau, mais refuse la connexion. Vérifiez la clé dans son YAML, et utilisez **Clés par nœud** si elle diffère de la clé par défaut.

**Un nœud disparaît puis revient**
C'est normal après un redémarrage du nœud (mise à jour OTA, coupure de courant). L'intégration se reconnecte automatiquement, avec un délai croissant pour ne pas saturer le réseau.

**Un appareil s'affiche comme « injoignable »**
La connexion vers ce nœud est tombée : nœud éteint, hors de portée Wi-Fi, ou en cours de redémarrage. L'intégration retente automatiquement. Sachez aussi qu'un nœud ESPHome n'accepte qu'un nombre limité de clients API simultanés : si le même nœud est déjà connecté à un Home Assistant ou à une console de logs ESPHome ouverte, il peut refuser une connexion de plus. Fermez les clients inutiles et utilisez l'action **Reconnecter les nœuds**.

**Une entité n'apparaît pas du tout**
Son type n'a pas d'équivalent dans Gladys (voir le tableau des fonctionnalités), ou elle est marquée `internal: true` dans votre YAML — auquel cas ESPHome ne l'expose pas du tout sur son API.
