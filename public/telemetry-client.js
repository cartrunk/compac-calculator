(function () {
  'use strict';

  // Soft behavioral/environment signals only. Anything read here is
  // readable and spoofable by the page it runs in — a stealth-patched
  // headless browser can fake most of it. It's one input among several on
  // the server, weighted accordingly (see src/fingerprint/scoring.js).

  var startedAt = Date.now();
  var mouseMoves = 0;
  var hadInteraction = false;
  var timeToFirstInteractionMs = null;

  document.addEventListener(
    'mousemove',
    function () {
      mouseMoves++;
    },
    { passive: true }
  );

  function onFirstInteraction() {
    if (hadInteraction) return;
    hadInteraction = true;
    timeToFirstInteractionMs = Date.now() - startedAt;
  }
  ['click', 'keydown', 'touchstart', 'scroll'].forEach(function (evt) {
    document.addEventListener(evt, onFirstInteraction, { passive: true, once: true });
  });

  function report() {
    var payload = {
      webdriver: !!navigator.webdriver,
      mouseMoves: mouseMoves,
      hadInteraction: hadInteraction,
      timeToFirstInteractionMs: timeToFirstInteractionMs,
      languages: navigator.languages ? Array.prototype.slice.call(navigator.languages) : [],
      hardwareConcurrency: navigator.hardwareConcurrency,
      screenWidth: window.screen ? window.screen.width : null,
      screenHeight: window.screen ? window.screen.height : null,
    };

    try {
      var blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
      if (navigator.sendBeacon) {
        navigator.sendBeacon('/__telemetry/report', blob);
      } else {
        fetch('/__telemetry/report', { method: 'POST', body: blob, keepalive: true });
      }
    } catch (e) {
      // Telemetry is best-effort; never let it throw into the host page.
    }
  }

  // Report once shortly after load (covers pages a bot never interacts
  // with at all) and again on unload (covers interaction that happened
  // after the first report).
  setTimeout(report, 1500);
  window.addEventListener('pagehide', report);
})();
