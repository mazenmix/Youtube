(() => {
  'use strict';
  if (window.__mxYTPlayerPatch) return;
  window.__mxYTPlayerPatch = true;
  const ADS = ['adPlacements', 'playerAds', 'adSlots', 'adBreakHeartbeatParams', 'adBreakParams', 'adBreaks', 'adPlacement', 'adSlot'];

  function cleanResponse(response) {
    if (!response || typeof response !== 'object') return response;
    try {
      for (const key of ADS) {
        if (Object.prototype.hasOwnProperty.call(response, key)) delete response[key];
      }
      if (response.playerResponse && typeof response.playerResponse === 'object') {
        cleanResponse(response.playerResponse);
      }
      if (typeof response.player_response === 'string') {
        try {
          const parsed = JSON.parse(response.player_response);
          cleanResponse(parsed);
          response.player_response = JSON.stringify(parsed);
        } catch (_) {}
      }
    } catch (_) {}
    return response;
  }
  try {
    let initial = cleanResponse(window.ytInitialPlayerResponse);
    Object.defineProperty(window, 'ytInitialPlayerResponse', {
      configurable: true,
      enumerable: true,
      get() { return initial; },
      set(value) { initial = cleanResponse(value); }
    });
  } catch (_) {}
})();