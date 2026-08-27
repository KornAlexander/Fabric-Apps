// Airport IQ assistant — backend base URL.
// Points the chat + voice widget at the thin Foundry backend (its own Azure
// Container App). Override locally with ?api=http://localhost:8080 for dev.
(function () {
  var override = new URLSearchParams(location.search).get('api');
  if (override) {
    window.AIRPORT_IQ_API_BASE = override.replace(/\/$/, '');
  } else if (!window.AIRPORT_IQ_API_BASE) {
    // Deployed Airport IQ chat/voice backend (Azure Container App, North Europe).
    window.AIRPORT_IQ_API_BASE = 'https://aiq-chat-backend.agreeablecliff-f2524c1e.northeurope.azurecontainerapps.io';
  }
})();
