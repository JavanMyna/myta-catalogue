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
  }

  // Delegate close-button clicks (the [x]) to the panels wrapper.
  panelsWrap.addEventListener("click", function (e) {
    var btn = e.target.closest("[data-close]");
    if (!btn) return;
    var panel = btn.closest(".panel");
    closePanel(panel);
  });

  // Close the currently visible panel on Esc.
  document.addEventListener("keydown", function (e) {
    if (e.key !== "Escape") return;
    var open = panelsWrap.querySelector(".panel:not([hidden])");
    if (open) closePanel(open);
  });
})();
