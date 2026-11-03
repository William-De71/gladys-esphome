// -----------------------------------------------------------------------------
// Every message this integration shows to the user, in the four languages of
// Gladys (en, fr, de, es).
//
// Gathered here rather than inline in `index.js`: a message added in English
// only would show up in English in a German interface, and keeping them side by
// side is what makes a missing translation visible in review. The messages test
// checks that every entry carries the four languages.
//
// The connection status and the action results take a `{ en, fr, de, es }`
// object; Gladys picks the user's language and falls back to English.
// -----------------------------------------------------------------------------

/**
 * Messages without parameters. Values (node names, error texts) are never
 * translated: they come from the node or the network as they are.
 */
export const MESSAGES = {
  noNodeFound: {
    en: 'No ESPHome node found. Check your encryption key, then run a scan.',
    fr: 'Aucun nœud ESPHome trouvé. Vérifiez votre clé de chiffrement, puis lancez un scan.',
    de: 'Kein ESPHome-Knoten gefunden. Prüfen Sie Ihren Verschlüsselungsschlüssel und starten Sie dann eine Suche.',
    es: 'No se ha encontrado ningún nodo ESPHome. Compruebe su clave de cifrado y luego inicie una búsqueda.',
  },
  initFailed: {
    en: 'Initialization failed, check the integration logs.',
    fr: "L'initialisation a échoué, consultez les logs de l'intégration.",
    de: 'Die Initialisierung ist fehlgeschlagen, prüfen Sie die Protokolle der Integration.',
    es: 'La inicialización ha fallado, consulte los registros de la integración.',
  },
  testNoAnswer: {
    en: 'No ESPHome node answered. Check that your nodes are powered on and that the encryption key matches.',
    fr: "Aucun nœud ESPHome n'a répondu. Vérifiez que vos nœuds sont allumés et que la clé de chiffrement correspond.",
    de: 'Kein ESPHome-Knoten hat geantwortet. Prüfen Sie, ob Ihre Knoten eingeschaltet sind und der Verschlüsselungsschlüssel übereinstimmt.',
    es: 'Ningún nodo ESPHome ha respondido. Compruebe que sus nodos estén encendidos y que la clave de cifrado coincida.',
  },
};

/**
 * Result of a successful connection test.
 * @param {number} nodeCount - How many nodes answered.
 * @param {number} featureCount - How many features they expose in total.
 * @returns {object} The message, in the four languages.
 * @example
 * testOk(2, 14);
 */
export function testOk(nodeCount, featureCount) {
  return {
    en: `Connection OK: ${nodeCount} node(s), ${featureCount} feature(s) available.`,
    fr: `Connexion OK : ${nodeCount} nœud(s), ${featureCount} fonctionnalité(s) disponible(s).`,
    de: `Verbindung OK: ${nodeCount} Knoten, ${featureCount} Funktion(en) verfügbar.`,
    es: `Conexión correcta: ${nodeCount} nodo(s), ${featureCount} función(es) disponible(s).`,
  };
}

/**
 * Result of a failed connection test.
 * @param {string} reason - The error message, shown as is.
 * @returns {object} The message, in the four languages.
 * @example
 * testFailed('timeout');
 */
export function testFailed(reason) {
  return {
    en: `Connection failed: ${reason}`,
    fr: `Échec de la connexion : ${reason}`,
    de: `Verbindung fehlgeschlagen: ${reason}`,
    es: `Error de conexión: ${reason}`,
  };
}

/**
 * Result of the "reconnect" action.
 * @param {number} nodeCount - How many nodes are available again.
 * @returns {object} The message, in the four languages.
 * @example
 * reconnectOk(3);
 */
export function reconnectOk(nodeCount) {
  return {
    en: `Reconnected: ${nodeCount} node(s) available.`,
    fr: `Reconnexion effectuée : ${nodeCount} nœud(s) disponible(s).`,
    de: `Neu verbunden: ${nodeCount} Knoten verfügbar.`,
    es: `Reconexión realizada: ${nodeCount} nodo(s) disponible(s).`,
  };
}

/**
 * Result of a failed "reconnect" action.
 * @param {string} reason - The error message, shown as is.
 * @returns {object} The message, in the four languages.
 * @example
 * reconnectFailed('timeout');
 */
export function reconnectFailed(reason) {
  return {
    en: `Reconnection failed: ${reason}`,
    fr: `Échec de la reconnexion : ${reason}`,
    de: `Neuverbindung fehlgeschlagen: ${reason}`,
    es: `Error de reconexión: ${reason}`,
  };
}

/**
 * Result of the "set a node key" action.
 * @param {string} node - The node name.
 * @param {boolean} connected - Whether the node answered with that key.
 * @returns {object} The message, in the four languages.
 * @example
 * nodeKeySet('salon', true);
 */
export function nodeKeySet(node, connected) {
  if (connected) {
    return {
      en: `Key saved for "${node}": the node is connected.`,
      fr: `Clé enregistrée pour « ${node} » : le nœud est connecté.`,
      de: `Schlüssel für „${node}“ gespeichert: Der Knoten ist verbunden.`,
      es: `Clave guardada para «${node}»: el nodo está conectado.`,
    };
  }
  return {
    en: `Key saved for "${node}", but the node did not answer. Check that the name matches \`esphome: name:\` (or the address typed under "Nodes added by hand"), that the key is the one of its YAML, and that it is powered on.`,
    fr: `Clé enregistrée pour « ${node} », mais le nœud n'a pas répondu. Vérifiez que le nom correspond à \`esphome: name:\` (ou à l'adresse saisie dans « Nœuds ajoutés à la main »), que la clé est celle de son YAML, et qu'il est allumé.`,
    de: `Schlüssel für „${node}“ gespeichert, aber der Knoten hat nicht geantwortet. Prüfen Sie, ob der Name \`esphome: name:\` entspricht (oder der unter „Manuell hinzugefügte Knoten“ eingegebenen Adresse), ob der Schlüssel der aus seiner YAML ist und ob er eingeschaltet ist.`,
    es: `Clave guardada para «${node}», pero el nodo no ha respondido. Compruebe que el nombre corresponde a \`esphome: name:\` (o a la dirección escrita en «Nodos añadidos a mano»), que la clave es la de su YAML y que está encendido.`,
  };
}

/**
 * Result of the "remove a node key" action.
 * @param {string} node - The node name.
 * @param {boolean} removed - False when the node had no specific key.
 * @returns {object} The message, in the four languages.
 * @example
 * nodeKeyRemoved('salon', true);
 */
export function nodeKeyRemoved(node, removed) {
  if (!removed) {
    return {
      en: `"${node}" had no specific key: nothing changed.`,
      fr: `« ${node} » n'avait pas de clé spécifique : rien n'a changé.`,
      de: `„${node}“ hatte keinen eigenen Schlüssel: Nichts wurde geändert.`,
      es: `«${node}» no tenía clave específica: no ha cambiado nada.`,
    };
  }
  return {
    en: `Key of "${node}" removed: the node now uses the default key.`,
    fr: `Clé de « ${node} » supprimée : le nœud utilise maintenant la clé par défaut.`,
    de: `Schlüssel von „${node}“ entfernt: Der Knoten verwendet jetzt den Standardschlüssel.`,
    es: `Clave de «${node}» eliminada: el nodo usa ahora la clave por defecto.`,
  };
}

/**
 * Refusal of a node key action, before anything is saved.
 * @param {string} code - `invalid_node` or `invalid_key`.
 * @returns {object} The message, in the four languages.
 * @example
 * nodeKeyRefused('invalid_key');
 */
export function nodeKeyRefused(code) {
  if (code === 'invalid_key') {
    return {
      en: 'Nothing saved: an ESPHome key is 44 characters of base64 ending with "=", as written under `api: encryption: key:`.',
      fr: "Rien n'a été enregistré : une clé ESPHome fait 44 caractères en base64 et se termine par « = », telle qu'écrite sous `api: encryption: key:`.",
      de: 'Nichts gespeichert: Ein ESPHome-Schlüssel besteht aus 44 Base64-Zeichen und endet mit „=“, so wie unter `api: encryption: key:` angegeben.',
      es: 'No se ha guardado nada: una clave ESPHome tiene 44 caracteres en base64 y termina en «=», tal como figura en `api: encryption: key:`.',
    };
  }
  return {
    en: 'Nothing saved: type the node name from `esphome: name:` (or the address of a node added by hand), without spaces.',
    fr: "Rien n'a été enregistré : saisissez le nom du nœud de `esphome: name:` (ou l'adresse d'un nœud ajouté à la main), sans espace.",
    de: 'Nichts gespeichert: Geben Sie den Knotennamen aus `esphome: name:` ein (oder die Adresse eines manuell hinzugefügten Knotens), ohne Leerzeichen.',
    es: 'No se ha guardado nada: escriba el nombre del nodo de `esphome: name:` (o la dirección de un nodo añadido a mano), sin espacios.',
  };
}

/**
 * Failure to save a node key in Gladys.
 * @param {string} reason - The error message, shown as is.
 * @returns {object} The message, in the four languages.
 * @example
 * nodeKeySaveFailed('timeout');
 */
export function nodeKeySaveFailed(reason) {
  return {
    en: `Saving the key failed: ${reason}`,
    fr: `Échec de l'enregistrement de la clé : ${reason}`,
    de: `Speichern des Schlüssels fehlgeschlagen: ${reason}`,
    es: `Error al guardar la clave: ${reason}`,
  };
}

/**
 * Result of the "list the node keys" action.
 * @param {Array<{ node: string, key: string, valid?: boolean, connected: boolean }>} entries - The
 * nodes with a specific key, their key already masked.
 * @param {boolean} hasDefault - Whether a default key is set.
 * @returns {object} The message, in the four languages.
 * @example
 * nodeKeysList([{ node: 'salon', key: 'kBv1…=', connected: true }], true);
 */
export function nodeKeysList(entries, hasDefault) {
  const texts = {
    en: {
      none: 'No node has a specific key.',
      on: 'connected',
      off: 'not connected',
      invalid: 'invalid key (44 base64 characters ending with "=" expected)',
      title: 'Nodes with a specific key:',
      def: hasDefault
        ? 'The other nodes use the default key.'
        : 'No default key: the other nodes connect without encryption.',
    },
    fr: {
      none: "Aucun nœud n'a de clé spécifique.",
      on: 'connecté',
      off: 'non connecté',
      invalid: 'clé invalide (44 caractères base64 finissant par « = » attendus)',
      title: 'Nœuds avec une clé spécifique :',
      def: hasDefault
        ? 'Les autres nœuds utilisent la clé par défaut.'
        : 'Aucune clé par défaut : les autres nœuds se connectent sans chiffrement.',
    },
    de: {
      none: 'Kein Knoten hat einen eigenen Schlüssel.',
      on: 'verbunden',
      off: 'nicht verbunden',
      invalid: 'ungültiger Schlüssel (44 Base64-Zeichen mit „=“ am Ende erwartet)',
      title: 'Knoten mit eigenem Schlüssel:',
      def: hasDefault
        ? 'Die anderen Knoten verwenden den Standardschlüssel.'
        : 'Kein Standardschlüssel: Die anderen Knoten verbinden sich ohne Verschlüsselung.',
    },
    es: {
      none: 'Ningún nodo tiene clave específica.',
      on: 'conectado',
      off: 'no conectado',
      invalid: 'clave no válida (se esperan 44 caracteres base64 terminados en «=»)',
      title: 'Nodos con una clave específica:',
      def: hasDefault
        ? 'Los demás nodos usan la clave por defecto.'
        : 'Sin clave por defecto: los demás nodos se conectan sin cifrado.',
    },
  };
  const message = {};
  for (const [language, text] of Object.entries(texts)) {
    const lines = entries.map(
      ({ node, key, valid = true, connected }) =>
        `• ${node} — ${key} — ${valid ? '' : `${text.invalid} — `}${connected ? text.on : text.off}`,
    );
    message[language] = [entries.length ? text.title : text.none, ...lines, text.def].join('\n');
  }
  return message;
}
