// Airport IQ assistant — backend base URL.
// Points the chat + voice widget at the thin Foundry backend (its own Azure
// Container App). Override locally with ?api=http://localhost:8080 for dev.
// The deployed address is NOT in the repository: tools/build-fabric.mjs replaces the
// placeholder below with $AIRPORT_IQ_API_BASE when it assembles fabric-dist/.
(function () {
  var override = new URLSearchParams(location.search).get('api');
  var built = '__AIRPORT_IQ_API_BASE__';
  if (override) {
    window.AIRPORT_IQ_API_BASE = override.replace(/\/$/, '');
  } else if (!window.AIRPORT_IQ_API_BASE && /^https:\/\//.test(built)) {
    window.AIRPORT_IQ_API_BASE = built;
  }
})();
