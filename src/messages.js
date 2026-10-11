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
