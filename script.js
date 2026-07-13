/* ============================================================
   MitaCatalogue — script.js
   Vanilla JS. No frameworks. Jobs:
     1) Click the splash -> wait for OST to buffer, then play + hide splash.
     2) Click a hotspot -> open the matching panel.
     3) Close the panel (x button, backdrop, or Esc).
     4) Lightbox: click a thumbnail -> show the full image.
     5) Fade the main OST out when a music-panel track plays.
     6) Render song cards from songs.js with expandable details.
     7) Only one audio plays at a time.
   ============================================================ */

(function () {
  "use strict";

  var splash = document.getElementById("splash");
  var ost = document.getElementById("ost");
  var room = document.getElementById("room");
  var panelsWrap = document.getElementById("panels");
  var lightbox = document.getElementById("lightbox");
  var lightboxImg = lightbox ? lightbox.querySelector("img") : null;
  var musicPanel = document.getElementById("panel-music");
  var musicTracks = document.getElementById("music-tracks");

  // ---- 1) Splash click: buffer OST, then hide splash + play ------------
  // readyState 4 = HAVE_ENOUGH_DATA: the browser has downloaded enough to
  // play through without stopping. If we play before this, the audio stutters
  // because it's still loading. So we wait for it.
  var splashLoading = document.querySelector(".splash-loading");
  var entryStarted = false; // guard against double-clicks

  function enterSite() {
    if (entryStarted) return;
    entryStarted = true;

    // If the OST is already buffered enough, enter right away.
    if (!ost || ost.readyState >= 4) {
      doEntry();
      return;
    }

    // Not buffered yet: show "loading audio..." and wait.
    // The browser fires "canplaythrough" when it has enough data to play
    // without stopping. We listen once, then enter.
    if (splashLoading) splashLoading.hidden = false;
    splash.classList.add("is-loading");

    function onReady() { doEntry(); }

    ost.addEventListener("canplaythrough", onReady, { once: true });
    // Safety net: if the file is huge / network is slow, don't wait forever.
    // After 8 seconds, just enter and let it buffer while playing.
    window.setTimeout(function () {
      ost.removeEventListener("canplaythrough", onReady);
      if (!splash.classList.contains("is-hidden")) doEntry();
    }, 8000);
  }

  // doEntry = the actual "fade splash + play OST" logic.
  function doEntry() {
    splash.classList.remove("is-loading");
    if (splashLoading) splashLoading.hidden = true;
    splash.classList.add("is-hidden"); // fade out (CSS opacity transition)

    // Fully remove the splash from layout after the fade. Two triggers:
    //   transitionend = fires when the fade finishes (fast path)
    //   setTimeout = fires after 700ms no matter what (fallback)
    var hideSplash = function () { splash.classList.add("is-gone"); };
    splash.addEventListener("transitionend", hideSplash, { once: true });
    window.setTimeout(hideSplash, 700);

    // Play the OST. .play() returns a Promise; if the browser refuses,
    // we log it instead of crashing.
    if (ost) {
      ost.loop = false; // play once, do not loop
      var p = ost.play();
      if (p && typeof p.then === "function") {
        p.catch(function (err) { console.log("Audio could not autoplay:", err); });
      }
    }
  }

  splash.addEventListener("click", enterSite);
  splash.addEventListener("keydown", function (e) {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); enterSite(); }
  });

  // ---- 2) Open a panel from a hotspot ----------------------------------
  // "Event delegation": one listener on the room catches all hotspot clicks.
  function openPanel(id) {
    var panel = document.getElementById(id);
    if (!panel) { console.log("No panel with id:", id); return; }

    var backdrop = document.createElement("div");
    backdrop.className = "panel-backdrop";
    document.body.appendChild(backdrop);
    panel._backdrop = backdrop;

    panel.hidden = false;
    backdrop.addEventListener("click", function () { closePanel(panel); });
    updateScrollLock();
  }

  room.addEventListener("click", function (e) {
    var spot = e.target.closest(".hotspot");
    if (!spot) return;
    var panelId = spot.getAttribute("data-panel");
    if (!panelId) return; // TODO hotspots: no panel yet, ignore without erroring
    openPanel(panelId);
  });

  // ---- 3) Close a panel ------------------------------------------------
  function closePanel(panel) {
    if (!panel) return;
    panel.hidden = true;
    if (panel._backdrop) { panel._backdrop.remove(); panel._backdrop = null; }
    updateScrollLock();
  }

  // "Scroll lock" = overflow:hidden on <body> so the page behind a panel
  // can't scroll on mobile. We check BOTH panels and the lightbox.
  function updateScrollLock() {
    var anyPanelOpen = panelsWrap.querySelector(".panel:not([hidden])");
    var anyLightboxOpen = lightbox && !lightbox.hidden;
    if (anyPanelOpen || anyLightboxOpen) {
      document.body.classList.add("panel-open");
    } else {
      document.body.classList.remove("panel-open");
    }
  }

  panelsWrap.addEventListener("click", function (e) {
    var btn = e.target.closest("[data-close]");
    if (!btn) return;
    closePanel(btn.closest(".panel"));
  });

  // ---- 4) Lightbox: click a thumbnail -> show the full image -----------
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
    lightboxImg.src = "";
    lightboxImg.alt = "";
    updateScrollLock();
  }

  lightbox.addEventListener("click", function (e) {
    if (e.target === lightboxImg) return; // clicks on the image don't close
    closeLightbox();
  });

  // ---- 5) Fade the main OST out when a music-panel track plays ---------
  // requestAnimationFrame runs a function once per screen redraw (~60×/sec),
  // which makes smooth volume fades without jerky timers.
  function fadeOutAndPause(audio, durationMs) {
    if (!audio || audio.paused) return;
    var startVol = audio.volume;
    var start = performance.now();

    function step(now) {
      var t = (now - start) / durationMs;
      if (t >= 1) {
        audio.volume = 0;
        audio.pause();
        audio.volume = startVol; // reset for any future replay
        return;
      }
      audio.volume = startVol * (1 - t);
      requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

  // ---- 6) Render song cards from songs.js ------------------------------
  // window.SONGS is loaded by songs.js (included before script.js).
  // Each song becomes a "card" with:
  //   - a clickable title that toggles a details view
  //   - an audio player
  //   - a hidden details section with the story + a SoundCloud link
  //
  // "textContent" is used instead of innerHTML for any user-provided text
  // (story, title) to prevent HTML injection. It's a security habit.
  function renderSongs() {
    if (!musicTracks) return;
    var songs = window.SONGS || [];
    var html = "";

    for (var i = 0; i < songs.length; i++) {
      var s = songs[i];
      var src = s.fullSrc || ("assets/music/" + s.id + ".mp3");

      // Build the SoundCloud link (only if the track has a URL).
      // This is a normal <a> tag — the user must click it deliberately.
      // It does NOT auto-redirect when the song card is clicked.
      var linkHtml = "";
      if (s.soundcloudUrl) {
        linkHtml = '<a class="song-link" href="' + s.soundcloudUrl +
          '" target="_blank" rel="noopener">Listen on SoundCloud</a>';
      } else {
        linkHtml = '<span class="song-nolink">no SoundCloud link</span>';
      }

      // Each card is a <div>. The title is a <button> (accessible + clickable).
      // The details section is hidden by CSS until .is-expanded is added.
      html +=
        '<div class="song-card">' +
          '<button type="button" class="song-title">' +
            '<span class="song-title-text"></span>' +
          '</button>' +
          '<div class="song-meta"></div>' +
          '<audio controls preload="none" src="' + src + '"></audio>' +
          '<div class="song-details">' +
            '<p class="song-story"></p>' +
            linkHtml +
          '</div>' +
        '</div>';
    }

    musicTracks.innerHTML = html;

    // Now fill in the text via textContent (safe — no HTML injection).
    // We do this after innerHTML so we don't have to escape the strings.
    var cards = musicTracks.querySelectorAll(".song-card");
    for (var j = 0; j < cards.length; j++) {
      var song = songs[j];
      cards[j].querySelector(".song-title-text").textContent = song.title;
      cards[j].querySelector(".song-meta").textContent =
        song.type + " — " + song.category;

      var storyEl = cards[j].querySelector(".song-story");
      if (song.story) {
        storyEl.textContent = song.story;
      } else {
        storyEl.textContent = "Story coming soon.";
        storyEl.style.color = "var(--red-dim)";
      }
    }

    // Wire up the title-click to toggle details.
    // "Event delegation": one listener on the container catches all title clicks.
    musicTracks.addEventListener("click", function (e) {
      var titleBtn = e.target.closest(".song-title");
      if (!titleBtn) return;
      var card = titleBtn.closest(".song-card");
      card.classList.toggle("is-expanded");
    });
  }

  renderSongs();

  // ---- 7) One audio at a time + OST fade --------------------------------
  // When any <audio> in the music panel starts playing:
  //   a) Pause all OTHER tracks (one-audio-at-a-time).
  //   b) If the OST is audible, fade it over 3s then start the track.
  //      If the OST is already silent, start the track immediately.
  if (musicPanel) {
    musicPanel.addEventListener("play", function (e) {
      if (e.target.tagName !== "AUDIO") return;
      var track = e.target;

      // This is our OWN delayed replay — let it through, don't intercept.
      if (track._delayedReplay) {
        track._delayedReplay = false;
        return;
      }

      // a) Pause all other playing tracks.
      var allTracks = musicPanel.querySelectorAll("audio");
      for (var i = 0; i < allTracks.length; i++) {
        if (allTracks[i] !== track && !allTracks[i].paused) {
          allTracks[i].pause();
        }
      }

      // b) Is the OST making sound right now?
      var ostIsAudible = ost && !ost.paused && ost.volume > 0;

      if (!ostIsAudible) {
        return; // nothing to fade — let the track play immediately
      }

      // OST is audible: pause this track, fade the OST, then replay the track.
      track.pause();
      fadeOutAndPause(ost, 3000);
      window.setTimeout(function () {
        track._delayedReplay = true;
        var p = track.play();
        if (p && typeof p.then === "function") {
          p.catch(function () { track._delayedReplay = false; });
        }
      }, 3000);
    }, true); // capture phase (play events don't bubble)
  }

  // ---- Esc closes whichever is open (lightbox > panel) -----------------
  document.addEventListener("keydown", function (e) {
    if (e.key !== "Escape") return;
    if (lightbox && !lightbox.hidden) { closeLightbox(); return; }
    var open = panelsWrap.querySelector(".panel:not([hidden])");
    if (open) closePanel(open);
  });
})();
