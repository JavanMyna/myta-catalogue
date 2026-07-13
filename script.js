/* ============================================================
   MitaCatalogue — script.js
   Vanilla JS. No frameworks. Three jobs:
     1) Click the splash -> unlock + play audio, hide splash.
     2) Click a hotspot -> open the matching panel.
     3) Close the panel (x button, backdrop, or Esc).
   ============================================================ */

(function () {
  "use strict";

  // Grab the elements we touch by id. If an id is missing, we fail loudly
  // in the console (which helps you debug) instead of silently breaking.
  var splash = document.getElementById("splash");
  var ost = document.getElementById("ost");
  var room = document.getElementById("room");
  var panelsWrap = document.getElementById("panels");

  // ---- 1) Splash click: hide splash + start audio ----------------------
  // "once: true" means this listener removes itself after firing, so you
  // can't accidentally start the track twice by double-clicking.
  function enterSite() {
    // Guard: if already entering, don't run twice (double-click).
    if (splash.classList.contains("is-hidden")) return;

    splash.classList.add("is-hidden"); // fade out (CSS opacity transition)

    // Fully remove the splash from layout after the fade, so it stops
    // blocking the room below on mobile. We use TWO triggers to be safe:
    //   - transitionend fires as soon as the fade finishes (fast path)
    //   - setTimeout fires after 700ms no matter what (fallback)
    // Adding the same class twice is harmless, so this can't get stuck.
    var hideSplash = function () { splash.classList.add("is-gone"); };
    splash.addEventListener("transitionend", hideSplash, { once: true });
    window.setTimeout(hideSplash, 700);

    // Try to play the OST. .play() returns a Promise; if the browser still
    // refuses, we just log it instead of crashing the page.
    if (ost) {
      ost.loop = false; // play once, do not loop
      var p = ost.play();
      if (p && typeof p.then === "function") {
        p.catch(function (err) {
          console.log("Audio could not autoplay:", err);
        });
      }
    }
  }

  splash.addEventListener("click", enterSite);
  splash.addEventListener("keydown", function (e) {
    // Let keyboard users press Enter or Space to enter.
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      enterSite();
    }
  });

  // ---- 2) Open a panel from a hotspot ----------------------------------
  // "Event delegation": instead of attaching a click handler to every
  // hotspot, we attach ONE to the room and check what was clicked.
  // Easier to maintain and auto-includes any new hotspots we add later.
  function openPanel(id) {
    var panel = document.getElementById(id);
    if (!panel) {
      console.log("No panel with id:", id);
      return;
    }

    // Add a dark backdrop behind the panel (and remember it so we can
    // remove it on close).
    var backdrop = document.createElement("div");
    backdrop.className = "panel-backdrop";
    document.body.appendChild(backdrop);
    panel._backdrop = backdrop;

    panel.hidden = false;     // show the panel
    backdrop.addEventListener("click", function () { closePanel(panel); });
    updateScrollLock();
  }

  room.addEventListener("click", function (e) {
    var spot = e.target.closest(".hotspot"); // the hotspot, if we clicked one
    if (!spot) return;
    var panelId = spot.getAttribute("data-panel");
    if (!panelId) return; // TODO hotspots: no panel yet, ignore without erroring
    openPanel(panelId);
  });

  // ---- 3) Close a panel ------------------------------------------------
  function closePanel(panel) {
    if (!panel) return;
    panel.hidden = true;
    if (panel._backdrop) {
      panel._backdrop.remove();
      panel._backdrop = null;
    }
    updateScrollLock();
  }

  // Helper: lock/unlock body scroll depending on whether anything is open.
  // "Scroll lock" = setting overflow:hidden on <body> so the page behind a
  // panel can't scroll on mobile. We check BOTH panels and the lightbox.
  function updateScrollLock() {
    var anyPanelOpen = panelsWrap.querySelector(".panel:not([hidden])");
    var anyLightboxOpen = lightbox && !lightbox.hidden;
    if (anyPanelOpen || anyLightboxOpen) {
      document.body.classList.add("panel-open");
    } else {
      document.body.classList.remove("panel-open");
    }
  }

  // Delegate close-button clicks (the [x]) to the panels wrapper.
  panelsWrap.addEventListener("click", function (e) {
    var btn = e.target.closest("[data-close]");
    if (!btn) return;
    var panel = btn.closest(".panel");
    closePanel(panel);
  });

  // ---- 4) Lightbox: click a thumbnail -> show the full image -----------
  var lightbox = document.getElementById("lightbox");
  var lightboxImg = lightbox ? lightbox.querySelector("img") : null;

  // "Event delegation" again: one listener on the panels wrapper catches
  // clicks on any thumbnail inside any panel — including ones we add later.
  panelsWrap.addEventListener("click", function (e) {
    var thumb = e.target.closest("img.panel-thumb");
    if (!thumb) return;
    lightboxImg.src = thumb.src;
    lightboxImg.alt = thumb.alt;
    lightbox.hidden = false;
    updateScrollLock();
  });

  function closeLightbox() {
    if (!lightbox) return;
    lightbox.hidden = true;
    // Clear src so the big image is dropped from memory, not just hidden.
    lightboxImg.src = "";
    lightboxImg.alt = "";
    updateScrollLock();
  }

  // Click the dark backdrop closes the lightbox. Click on the image itself
  // does NOT close (cursor: default on the img tells the user this).
  lightbox.addEventListener("click", function (e) {
    if (e.target === lightboxImg) return;
    closeLightbox();
  });

  // ---- 5) Fade the main OST out when a music-panel track plays ---------
  // requestAnimationFrame runs a function once per screen redraw (~60×/sec),
  // which makes smooth volume fades without jerky timers.
  function fadeOutAndPause(audio, durationMs) {
    if (!audio || audio.paused) return; // already silent / paused: nothing to do
    var startVol = audio.volume;
    var start = performance.now();      // ms timestamp for math

    function step(now) {
      var t = (now - start) / durationMs;     // 0 -> 1 over the fade duration
      if (t >= 1) {
        audio.volume = 0;
        audio.pause();
        audio.volume = startVol;              // reset for any future replay
        return;
      }
      audio.volume = startVol * (1 - t);      // ease volume toward 0
      requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

  var musicPanel = document.getElementById("panel-music");

  // When a track is pressed: pause it immediately, fade the OST over 3s,
  // THEN start the track — so there's no overlap during the fade.
  // A flag on the track prevents the delayed replay from re-triggering this.
  if (musicPanel) {
    musicPanel.addEventListener("play", function (e) {
      if (e.target.tagName !== "AUDIO") return;
      var track = e.target;

      // This is our OWN delayed replay (set below) — let it play, don't intercept.
      if (track._delayedReplay) {
        track._delayedReplay = false;
        return;
      }

      // User just pressed play: pause the track right away, fade the OST,
      // then replay the track once the fade is done.
      track.pause();
      fadeOutAndPause(ost, 3000);
      window.setTimeout(function () {
        track._delayedReplay = true;
        var p = track.play();
        if (p && typeof p.then === "function") {
          p.catch(function () { track._delayedReplay = false; });
        }
      }, 3000);
    }, true); // <-- true = capture phase (play events don't bubble)
  }

  // ---- Esc closes whichever is open (panel OR lightbox) ---------------
  // Lightbox takes priority since it sits on top.
  document.addEventListener("keydown", function (e) {
    if (e.key !== "Escape") return;
    if (lightbox && !lightbox.hidden) { closeLightbox(); return; }
    var open = panelsWrap.querySelector(".panel:not([hidden])");
    if (open) closePanel(open);
  });
})();
