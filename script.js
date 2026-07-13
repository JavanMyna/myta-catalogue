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
  var lightboxCaption = document.getElementById("lightbox-caption");
  var musicPanel = document.getElementById("panel-music");
  var musicTracks = document.getElementById("music-tracks");

  // ---- 4b) Gallery metadata (from the old MynaCatalogue script.js) ------
  // Maps image filenames to titles/medium/date/desc so the lightbox can show
  // a caption with the story behind each piece.
  var artData = {
    "antformicidae.jpg": { t:"Antformicidae", med:"Sketches", date:"2025", desc:"Something my best friend said to me that sticked throughout my matrics journey." },
    "art_2024sukanDay.jpg": { t:"Sukan Day", med:"Sketches", date:"2024" },
    "art_classmate01.jpg": { t:"Classmate 01", med:"Sketches", date:"2024" },
    "art_classmate02.jpg": { t:"Classmate 02", med:"Sketches", date:"2024" },
    "art_kmlcat.jpg": { t:"KML Cat", med:"Sketches", date:"2025", desc:"I seriously feel like everytime I eat in my college cafe, there's always times like this" },
    "art_kmlPoster.jpg": { t:"KML Poster", med:"Poster", date:"2025", desc:"I joined the college's art exhibition and put up the poster I drew weeks prior." },
    "art_miko.jpg": { t:"Miko", med:"Sketches", date:"2025", desc:"Mom sent me a cute pictures of cats and it made wanted to draw my cat in the same artstyle." },
    "art_perspectiveBed.jpg": { t:"Perspective Bed", med:"Perspective drawing", date:"2024" },
    "art_perspectiveBedroom.jpg": { t:"Perspective Bedroom", med:"Perspective drawing", date:"2024" },
    "art_perspectiveLivingroom.jpg": { t:"Perspective Living Room", med:"Perspective drawing", date:"2024" },
    "art_pov01.jpg": { t:"POV 01", med:"Sketches", date:"2024" },
    "art_ringo.jpg": { t:"Ringo", med:"Sketches", date:"2024" },
    "art_rkgk01.jpg": { t:"RKGK 01", med:"Sketches", date:"2024" },
    "art_rkgk02.jpg": { t:"RKGK 02", med:"Sketches", date:"2024" },
    "art_rkgk03.jpg": { t:"RKGK 03", med:"Sketches", date:"2024" },
    "art_rkgk04.jpg": { t:"RKGK 04", med:"Sketches", date:"2024" },
    "comic_chineseHumor.jpg": { t:"Chinese Humor", med:"Comic", date:"2025", desc:"I was in the local massive pet store and I overheard a conversation from a family." }
  };

  // Cat-specific titles (from the old script.js catTitle function)
  function catTitle(stem) {
    var s = stem.toLowerCase();
    if (s.indexOf("mmt") === 0) return "Miko & Mita";
    if (s.indexOf("mm") === 0) return "Miko & Mango";
    return titleFromStem(stem);
  }

  // filename stem -> human title (from the old script.js titleFromStem)
  function titleFromStem(stem) {
    var m = stem.match(/^([^\d]*?)(\d+)$/);
    var name = m ? m[1] : stem;
    var num = m ? m[2] : "";
    name = name.replace(/_/g, " ")
      .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
      .split(" ")
      .map(function(w) { return (w.length > 1 && w === w.toUpperCase()) ? w : w.charAt(0).toUpperCase() + w.slice(1); })
      .join(" ")
      .trim();
    return num ? name + " " + num : name;
  }

  // Extract the filename from a path like "assets/art/antformicidae.jpg"
  function basename(path) {
    var parts = path.split("/");
    return parts[parts.length - 1];
  }

  // Extract the stem (filename without extension) from a path
  function stemname(path) {
    var b = basename(path);
    return b.replace(/\.\w+$/, "");
  }

  // Look up metadata for a thumbnail src. Returns null if no metadata.
  function getThumbMeta(src) {
    var file = basename(src);

    // Art: direct lookup in artData
    if (src.indexOf("/art/") !== -1) {
      return artData[file] || null;
    }

    // Photography: build from stem
    if (src.indexOf("/photography/") !== -1) {
      var stem = stemname(src);
      if (src.indexOf("/cats/") !== -1) {
        return { t: catTitle(stem), med:"Photography", date:"", desc:"" };
      }
      return { t: titleFromStem(stem), med:"Photography", date:"", desc:"" };
    }

    return null;
  }

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

  // ---- 1b) Light switch: turn on the room lights -----------------------
  // The room starts dark (.is-dark on #room). Clicking the light switch
  // removes that class, which transitions the image to full brightness and
  // un-dims all the hotspot dots. One-way: once on, it stays on.
  var lightSwitch = document.getElementById("light-switch");
  if (lightSwitch && room) {
    lightSwitch.addEventListener("click", function (e) {
      e.stopPropagation(); // don't let it bubble to the room click handler
      room.classList.remove("is-dark");
    });
  }

  // ---- 1c) OST "ended": show shuffle player when OST finishes naturally -
  // The OST plays once (no loop). When it ends on its own (not faded by a
  // track), the shuffle player should appear so the user can keep listening.
  if (ost) {
    ost.addEventListener("ended", function () {
      showShufflePlayer();
    });
  }

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

  // ---- 4) Lightbox: click a thumbnail -> show the full image + caption -
  panelsWrap.addEventListener("click", function (e) {
    var thumb = e.target.closest("img.panel-thumb");
    if (!thumb) return;
    lightboxImg.src = thumb.src;
    lightboxImg.alt = thumb.alt;

    // Look up the gallery metadata and show a caption if we have one.
    var meta = getThumbMeta(thumb.src);
    if (meta && lightboxCaption) {
      var html = "";
      if (meta.t) html += '<span class="cap-title"></span>';
      if (meta.med) html += '<span class="cap-meta"></span>';
      if (meta.desc) html += '<span class="cap-desc"></span>';
      lightboxCaption.innerHTML = html;
      if (meta.t) lightboxCaption.querySelector(".cap-title").textContent = meta.t;
      if (meta.med) {
        var metaText = meta.med + (meta.date ? " \u00b7 " + meta.date : "");
        lightboxCaption.querySelector(".cap-meta").textContent = metaText;
      }
      if (meta.desc) lightboxCaption.querySelector(".cap-desc").textContent = meta.desc;
      lightboxCaption.hidden = false;
    } else if (lightboxCaption) {
      lightboxCaption.hidden = true;
    }

    lightbox.hidden = false;
    updateScrollLock();
  });

  function closeLightbox() {
    if (!lightbox) return;
    lightbox.hidden = true;
    lightboxImg.src = "";
    lightboxImg.alt = "";
    if (lightboxCaption) { lightboxCaption.innerHTML = ""; lightboxCaption.hidden = true; }
    updateScrollLock();
  }

  // Click the dark backdrop closes the lightbox. Click on the frame (image
  // or caption) does NOT close.
  lightbox.addEventListener("click", function (e) {
    if (e.target.closest(".lightbox-frame")) return;
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

      // Also pause the shuffle player so they don't overlap.
      if (shuffleAudio && !shuffleAudio.paused) {
        shuffleAudio.pause();
        if (shufflePlayBtn) shufflePlayBtn.textContent = "play";
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
        // After the OST fades, show the shuffle player bar.
        showShufflePlayer();
      }, 3000);
    }, true); // capture phase (play events don't bubble)
  }

  // ---- 8) Shuffle music player -----------------------------------------
  // A small fixed bar at the bottom of the screen. Appears after the OST
  // fades out (when a music track is first played). Plays songs in random
  // order. Non-invasive: sits at the bottom, doesn't block the room.
  var shufflePlayer = document.getElementById("shuffle-player");
  var shuffleAudio = document.getElementById("shuffle-audio");
  var shufflePlayBtn = document.getElementById("shuffle-play");
  var shufflePrevBtn = document.getElementById("shuffle-prev");
  var shuffleNextBtn = document.getElementById("shuffle-next");
  var shuffleCloseBtn = document.getElementById("shuffle-close");
  var shuffleLabel = document.getElementById("shuffle-label");
  var shuffleOrder = [];          // array of song indices, shuffled
  var shufflePos = 0;             // current position in shuffleOrder
  var shuffleShowing = false;

  function showShufflePlayer() {
    if (shuffleShowing || !shufflePlayer) return;
    shuffleShowing = true;
    // Build the shuffle order once, the first time the OST fades.
    shuffleOrder = [];
    var songs = window.SONGS || [];
    for (var i = 0; i < songs.length; i++) shuffleOrder.push(i);
    // Fisher-Yates shuffle: pick a random element and swap, for each position.
    for (var j = shuffleOrder.length - 1; j > 0; j--) {
      var k = Math.floor(Math.random() * (j + 1));
      var tmp = shuffleOrder[j]; shuffleOrder[j] = shuffleOrder[k]; shuffleOrder[k] = tmp;
    }
    shufflePos = 0;
    shufflePlayer.hidden = false;
  }

  function shuffleCurrentSong() {
    var songs = window.SONGS || [];
    if (shuffleOrder.length === 0) return null;
    return songs[shuffleOrder[shufflePos]] || null;
  }

  function shuffleLoad() {
    var s = shuffleCurrentSong();
    if (!s) return;
    shuffleAudio.src = s.fullSrc || ("assets/music/" + s.id + ".mp3");
    if (shuffleLabel) shuffleLabel.textContent = "shuffle: " + s.title;
  }

  function shufflePlay() {
    if (!shuffleAudio.src) shuffleLoad();
    // Pause any track currently playing in the music panel so they
    // don't overlap (Bug 2 fix: one audio at a time, across both systems).
    if (musicPanel) {
      var panelTracks = musicPanel.querySelectorAll("audio");
      for (var i = 0; i < panelTracks.length; i++) {
        if (!panelTracks[i].paused) panelTracks[i].pause();
      }
    }
    var p = shuffleAudio.play();
    if (p && typeof p.then === "function") {
      p.catch(function (err) { console.log("Shuffle play failed:", err); });
    }
    if (shufflePlayBtn) shufflePlayBtn.textContent = "pause";
  }

  function shufflePause() {
    shuffleAudio.pause();
    if (shufflePlayBtn) shufflePlayBtn.textContent = "play";
  }

  function shuffleToggle() {
    if (shuffleAudio.paused) shufflePlay(); else shufflePause();
  }

  function shuffleNext() {
    shufflePos = (shufflePos + 1) % shuffleOrder.length;
    shuffleLoad();
    shufflePlay();
  }

  function shufflePrev() {
    shufflePos = (shufflePos - 1 + shuffleOrder.length) % shuffleOrder.length;
    shuffleLoad();
    shufflePlay();
  }

  if (shufflePlayBtn) shufflePlayBtn.addEventListener("click", shuffleToggle);
  if (shuffleNextBtn) shuffleNextBtn.addEventListener("click", shuffleNext);
  if (shufflePrevBtn) shufflePrevBtn.addEventListener("click", shufflePrev);
  if (shuffleCloseBtn) shuffleCloseBtn.addEventListener("click", function () {
    shufflePause();
    shuffleAudio.src = "";
    if (shufflePlayer) shufflePlayer.hidden = true;
    shuffleShowing = false;
  });

  // When the current shuffle track ends, move to the next one automatically.
  if (shuffleAudio) {
    shuffleAudio.addEventListener("ended", shuffleNext);
  }

  // ---- 9) Functional clock (UTC+8) -------------------------------------
  // toLocaleTimeString with timeZone: "Asia/Kuala_Lumpur" gives UTC+8 time.
  // We update once per second with setInterval. The clock only runs while
  // the clock panel is open (to avoid wasting CPU when hidden).
  var clockDisplay = document.getElementById("clock-display");
  var clockTimer = null;

  function updateClock() {
    if (!clockDisplay) return;
    try {
      // Asia/Kuala_Lumpur is UTC+8 with no DST — stable year-round.
      var time = new Date().toLocaleTimeString("en-GB", {
        timeZone: "Asia/Kuala_Lumpur",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false
      });
      clockDisplay.textContent = time;
    } catch (err) {
      // Fallback if the browser doesn't support timeZone (very rare).
      clockDisplay.textContent = new Date().toUTCString();
    }
  }

  // Start/stop the clock when the clock panel opens/closes.
  // We hook into the existing panel-open mechanism by watching for
  // data-panel clicks that target the clock.
  var clockPanel = document.getElementById("panel-clock");
  if (clockPanel) {
    // Watch for when the clock panel becomes visible.
    var clockObserver = new MutationObserver(function () {
      if (!clockPanel.hidden && !clockTimer) {
        updateClock();
        clockTimer = window.setInterval(updateClock, 1000);
      } else if (clockPanel.hidden && clockTimer) {
        window.clearInterval(clockTimer);
        clockTimer = null;
      }
    });
    clockObserver.observe(clockPanel, { attributes: true, attributeFilter: ["hidden"] });
  }

  // ---- Esc closes whichever is open (lightbox > panel) -----------------
  document.addEventListener("keydown", function (e) {
    if (e.key !== "Escape") return;
    if (lightbox && !lightbox.hidden) { closeLightbox(); return; }
    var open = panelsWrap.querySelector(".panel:not([hidden])");
    if (open) closePanel(open);
  });
})();
