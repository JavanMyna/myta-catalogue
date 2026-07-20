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
  var vcr = document.getElementById("vcr");
  var room = document.getElementById("room");
  var panelsWrap = document.getElementById("panels");
  var lightbox = document.getElementById("lightbox");
  var lightboxImg = lightbox ? lightbox.querySelector("img") : null;
  var lightboxCaption = document.getElementById("lightbox-caption");
  var musicPanel = document.getElementById("panel-music");
  var musicTracks = document.getElementById("music-tracks");

  // Images to warm into the cache when the user clicks to enter (see
  // enterSite). Curated, not exhaustive — kept tight on purpose.
  //
  // What's warmed here vs. left to lazy-load:
  //   - corkBoard.jpg / shatteredGlass.jpg: <img class="full-img"> panels
  //     whose entire content is one big image shown the moment the panel
  //     opens. Warming here makes those panels instant.
  //   - All other panel thumbnails already have loading="lazy" + a fixed
  //     aspect-ratio slot (CSS .panel-thumb), so they fetch as the user
  //     scrolls and don't shift layout. Warming them on enterSite was
  //     15+MB of bandwidth competing with the audio pipeline (Part 1 brief)
  //     for no perceptible UX gain — dropped from this list.
  //   - The About portrait (fred01.jpg) is also a small 220px box fetched
  //     on first visit to the About panel; not worth warming either.
  var PRELOAD_IMAGES = [
    "assets/misc/corkBoard.jpg",
    "assets/art/shatteredGlass.jpg"
  ];

  // ---- SFX system (Feature 3) ----------------------------------------
  // One-shot UI sounds created as preloaded Audio() nodes so the first
  // play has no delay. Each node is a SINGLE stream, so rapid taps can never
  // "stack" overlapping audio — replaying just restarts the same stream.
  // playSfx() additionally debounces taps that arrive within guardMs so
  // machine-gunning doesn't constantly cut the sound back to its start.
  //
  // Current key map (Brief 02 swaps applied — see report):
  //   open        -> clickMouse3.mp3   (was clickMouse.wav)
  //   close       -> bookClose.mp3     (was clickMouse2.wav)
  //   switch on   -> clickSwitchOpen.mp3   (was the single clickSwitch.mp3)
  //   switch off  -> clickSwitchClose.mp3  (new key, paired with the toggle)
var sfxOpen        = new Audio("assets/sfx/clickMouse3.mp3");
var sfxClose       = new Audio("assets/sfx/bookClose.mp3");
var sfxSwitchOpen  = new Audio("assets/sfx/clickSwitchOpen.mp3");
var sfxSwitchClose = new Audio("assets/sfx/clickSwitchClose.mp3");
// Image-zoom sounds: click image -> zoom in, close/backdrop -> zoom out.
var sfxZoomIn  = new Audio("assets/sfx/clickMouse.wav");
var sfxZoomOut = new Audio("assets/sfx/clickCamera.wav");
[sfxOpen, sfxClose, sfxSwitchOpen, sfxSwitchClose, sfxZoomIn, sfxZoomOut].forEach(function (a) {
  a.preload = "auto"; a.volume = 0.35;
});

  // play() that never throws — browsers may block autoplay and reject the
  // returned Promise even after a user gesture; we want to fail silently.
  function playSafely(audio) {
    if (!audio) return;
    try {
      var p = audio.play();
      if (p && typeof p.then === "function") {
        p.catch(function (err) { console.log("Audio blocked:", err); });
      }
    } catch (err) {
      console.log("Audio threw:", err);
    }
  }

  // Play a one-shot UI sound with a debounce guard.
  function playSfx(audio, guardMs) {
    if (!audio) return;
    guardMs = guardMs || 120;
    var now = (window.performance && performance.now) ? performance.now() : Date.now();
    if (audio._t && now - audio._t < guardMs) return;   // too soon: ignore
    audio._t = now;
    try { audio.currentTime = 0; } catch (e) {}         // rewind so a re-tap restarts
    audio.loop = false;
    playSafely(audio);
  }

  // ---- Ambient room tone (Brief 02 §5, revised) -----------------------
  // A quiet loop that plays while the site is idle. It is only interrupted
  // by MUSIC — UI sfx (panel open/close, light switch, the VCR insert) play
  // OVER it and never pause it, so button clicks don't cause an awkward
  // stop/start of the bed. Only the OST, the shuffle player, and the
  // music-panel song cards register with the tracker.
  //
  // A central Set (activeAudio) holds the music elements currently producing
  // sound; when it empties, room tone fades in; the instant any music starts
  // it fades out and pauses (resuming position, not restarting). Room tone
  // itself is excluded from the set — it would otherwise keep the set
  // non-empty and block itself from starting.
  //
  // A short 250ms debounce on START prevents the bed from blipping during
  // the 3s OST-fade-to-track transition (where the set briefly hits zero).
  // STOP is instant — no debounce — so music cuts the bed the moment it begins.
  var roomTone = new Audio("assets/sfx/loop_roomTone.mp3");
  roomTone.loop = true;
  roomTone.preload = "none";           // defer the fetch — the bed can't play
                                       // before enterSite() sets audioUnlocked
                                       // anyway, so preloading it at page parse
                                       // only competes with the LCP mainPic.jpg
                                       // and the VCR SFX the visitor is about to
                                       // need. enterSite() flips this to "auto"
                                       // on the first user gesture so the 595KB
                                       // bed is buffered well before the OST
                                       // ends and the bed needs to fade in.
  roomTone.volume = 0;                 // fade in/out drives the real volume
  var ROOM_TONE_VOL = 0.12;            // low — it's a bed, not foreground
  var activeAudio = new Set();         // audio elements currently making sound
  var roomToneStartTimer = null;
  var audioUnlocked = false;           // gate: don't try until after click-to-enter
  // Shared audio state: a YouTube embed is currently playing, so the site
  // must stay silent. Flipped by audioDirector (section 9b); gates
  // startRoomTone() and startOst() so no queued audio can sneak back in.
  var videoSuppressed = false;

  // Smooth volume ramp (requestAnimationFrame). targetVol is the goal,
  // onDone fires once the ramp completes. Used for room-tone fades.
  function fadeVolume(audio, targetVol, durationMs, onDone) {
    if (!audio) { if (onDone) onDone(); return; }
    var startVol = audio.volume;
    var start = performance.now();
    function step(now) {
      var t = (now - start) / durationMs;
      if (t >= 1) {
        audio.volume = targetVol;
        if (onDone) onDone();
        return;
      }
      audio.volume = startVol + (targetVol - startVol) * t;
      requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

  // Wire an audio element into the central tracker. Call once per element.
  function trackAudio(el) {
    if (!el || el === roomTone) return;
    el.addEventListener("play",  function () { audioStarted(el); });
    el.addEventListener("pause", function () { audioStopped(el); });
    el.addEventListener("ended", function () { audioStopped(el); });
  }

  function audioStarted(el) {
    if (el === roomTone) return;
    activeAudio.add(el);
    stopRoomTone();                    // anything playing -> cut the bed instantly
  }
  function audioStopped(el) {
    if (el === roomTone) return;
    activeAudio.delete(el);
    // tidy: drop any paused/ended elements still lurking in the set
    activeAudio.forEach(function (a) {
      if (a.paused) activeAudio.delete(a);
    });
    if (activeAudio.size === 0) startRoomTone();
  }

  function startRoomTone() {
    if (!audioUnlocked || !roomTone) return;
    if (videoSuppressed) return;       // a YouTube video is playing — stay silent
    if (roomToneStartTimer) return;    // already pending
    roomToneStartTimer = window.setTimeout(function () {
      roomToneStartTimer = null;
      if (activeAudio.size !== 0) return;  // something started during the debounce
      if (videoSuppressed) return;     // re-check inside the debounce window
      var p = roomTone.play();              // resume from paused position
      if (p && typeof p.then === "function") p.catch(function () {});
      fadeVolume(roomTone, ROOM_TONE_VOL, 220);
    }, 250);
  }
  function stopRoomTone() {
    if (roomToneStartTimer) { window.clearTimeout(roomToneStartTimer); roomToneStartTimer = null; }
    if (!roomTone || roomTone.paused) return;
    fadeVolume(roomTone, 0, 180, function () { roomTone.pause(); });
  }

  // Register the MUSIC sources with the tracker. SFX (sfxOpen/Close/switch,
  //   vcr) are deliberately NOT tracked — they play over the bed and never
  //   stop it, so clicking buttons no longer causes the awkward stop/start.
  // (Music-panel <audio> cards are dynamic — handled by capture listeners in
  //  the music panel block below; the shuffle player is tracked where it's
  //  declared, also below.)
  trackAudio(ost);

  // ---- 4b) Gallery metadata (from the old MynaCatalogue script.js) ------
  // Maps image filenames to titles/medium/date/desc so the lightbox can show
  // a caption with the story behind each piece.
  var artData = {
    "antformicidae.jpg": { t:"Antformicidae", med:"Sketches", date:"2025", desc:"Something my best friend said to me that sticked throughout my matrics journey." },
    "art_2024sukanDay.jpg": { t:"Sukan Day", med:"Sketches", date:"2024" },
    "art_churchObservation.jpg": { t:"Church Observation", med:"Sketches", date:"2025" },
    "art_classmate01.jpg": { t:"Classmate 01", med:"Sketches", date:"2024" },
    "art_classmate02.jpg": { t:"Classmate 02", med:"Sketches", date:"2024" },
    "art_highschoolClass5Amanah.jpg": { t:"5 Amanah Highschool class", med:"Sketches", date:"2025" },
    "art_jejaka313.jpg": { t:"Jejaka 3.13", med:"Poster", date:"2025", desc:"A poster drawing of my roommates in matrics" },
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
    "art_workingGrandma.jpg": { t:"Working grandmother", med:"Sketches", date:"2025" },
    "comic_chineseHumor.jpg": { t:"Chinese Humor", med:"Comic", date:"2025", desc:"I was in the local massive pet store and I overheard a conversation from a family." },
    "comic_lightningStrike.jpg": { t:"Lightning strike", med:"Comic", date:"2025", desc:"Drew by my lil brother who was accompanying me at a library" },
    "shatteredGlass.jpg": { t:"Shattered Glass", med:"Sketches", date:"2025", desc:"I made this when I was burnt out in matrics." }
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

  // ---- 1) Splash click: VCR insert SFX, then OST (Dazed) on its `ended` -
  // Feature 1: click-to-enter plays the cassette-insert SFX first, and the
  // background OST starts only when that SFX fires its `ended` event — no
  // fixed setTimeout, because durations drift. Both files are preloaded
  // (see <link rel="preload"> in index.html + preload="auto" on the
  // <audio> tags) so there's no gap before the SFX starts.
  var entryStarted = false; // guard against double-clicks

  function enterSite() {
    if (entryStarted) return;
    entryStarted = true;
    audioUnlocked = true;   // room-tone bed may now start when the site is idle

    // The music bar is always visible from the moment the visitor enters —
    // it no longer waits for the OST to end and never hides again.
    showShufflePlayer();

    // Now that we have a user gesture, kick off the room-tone bed fetch. It
    // was left at preload="none" at page parse so its 595KB wouldn't compete
    // with mainPic.jpg / the VCR SFX on first paint. The bed can't actually
    // play until audioUnlocked is true AND no other music is playing, so by
    // the time it's needed (OST ends / a track ends) it has had the whole
    // VCR intro window to finish loading. (Fix #3, performance pass.)
    if (roomTone) {
      try { roomTone.preload = "auto"; roomTone.load(); } catch (e) {}
    }

    // Preload a curated subset of images so visiting common panels feels
    // instant. We warm the browser cache with `new Image()` (no DOM insert)
    // for: the two full-size panel images (corkboard, shattered glass — shown
    // big the moment their panel opens), the about photo, and the first few
    // art thumbnails (top of the drawings grid, which uses loading="lazy" so
    // it would otherwise fetch on first open). The rest stay lazy. Tunable
    // via PRELOAD_IMAGES below.
    PRELOAD_IMAGES.forEach(function (src) {
      var img = new Image();
      img.src = src;
    });

    // Show the loading indicator immediately so the click is never silent —
    // a first-time visitor on a slow connection otherwise sees an inert
    // splash while the VCR SFX finishes decoding. CSS (.is-loading) hides
    // the "click to enter" / "headphones" lines and reveals .splash-loading
    // (already in the DOM, just hidden) until we kick off the audio.
    var loadingEl = splash.querySelector(".splash-loading");
    splash.classList.add("is-loading");
    if (loadingEl) loadingEl.hidden = false;

    // Begin the visual + audio entry sequence. Called once the VCR SFX is
    // far enough along to start without an audible stall (readyState >= 3,
    // HAVE_FUTURE_DATA) — or immediately if it's already there (cached).
    function beginSequence() {
      splash.classList.remove("is-loading");
      if (loadingEl) loadingEl.hidden = true;

      // Keep the existing visual entry transition: fade the splash out, then
      // remove it from layout. Runs concurrently with the VCR SFX.
      splash.classList.add("is-hidden"); // fade out (CSS opacity transition)
      var hideSplash = function () { splash.classList.add("is-gone"); };
      splash.addEventListener("transitionend", hideSplash, { once: true });
      window.setTimeout(hideSplash, 700); // fallback if transitionend doesn't fire

      // Audio sequence: VCR SFX -> (on ended) -> OST.
      if (vcr) {
        try { vcr.currentTime = 0; } catch (e) {}
        vcr.loop = false;
        // Start the OST when the SFX finishes. { once: true } so it runs once.
        vcr.addEventListener("ended", startOst, { once: true });
        playSafely(vcr);
      } else {
        // No SFX element present (shouldn't happen): fall back to just the OST.
        startOst();
      }
    }

    // Start the sequence as soon as the VCR SFX has enough buffered data. For
    // returning visitors the file is cached and readyState is already 4
    // (HAVE_ENOUGH_DATA), so this fires synchronously and there's no new
    // delay. For first-time visitors on a slow link, the browser decodes
    // what it has before playing, and the loading indicator bridges the gap.
    if (vcr && vcr.readyState < 3) {
      var armed = false;
      function onVfxReady() {
        if (armed) return;
        armed = true;
        vcr.removeEventListener("canplaythrough", onVfxReady);
        vcr.removeEventListener("canplay", onVfxReady);
        beginSequence();
      }
      vcr.addEventListener("canplaythrough", onVfxReady);
      vcr.addEventListener("canplay", onVfxReady);
      // Safety: never let a stalled load hold the visitor at the splash
      // forever. 4s is well past the point where "loading…" has stopped
      // looking responsive; play whatever we have (playSafely fails silently).
      window.setTimeout(onVfxReady, 4000);
    } else {
      // Already buffered (cached visit) or no SFX tag — go immediately so
      // returning visitors still feel an instant response.
      beginSequence();
    }
  }

  // Start the background OST once, not looped.
  function startOst() {
    if (!ost) return;
    // Don't start over a YouTube video, or over music the visitor already
    // started from the always-visible bar during the VCR intro. The OST is
    // a one-time thing — once pre-empted, it stays off.
    if (videoSuppressed || activeAudio.size > 0) return;
    try { ost.currentTime = 0; } catch (e) {}
    ost.loop = false;
    playSafely(ost);
  }

  splash.addEventListener("click", enterSite);
  splash.addEventListener("keydown", function (e) {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); enterSite(); }
  });

  // ---- 1b) Light switch: toggle the room lights on AND off (Feature 4) --
  // The room starts dark (.is-dark on #room). Toggling the switch flips that
  // class: removing it brightens the image + un-dims hotspot dots; adding it
  // back reverses exactly that (brightness, dot dim, stronger scanlines — all
  // driven by .is-dark in CSS). State is kept in a `lightsOn` boolean so the
  // switch stays in sync even if the room is re-rendered by other code.
  var lightSwitch = document.getElementById("light-switch");
  var lightsOn = false; // starts OFF (room is dark until first click)

  function setLights(on) {
    lightsOn = on;
    if (on) room.classList.remove("is-dark");
    else    room.classList.add("is-dark");
    if (lightSwitch) lightSwitch.setAttribute("aria-pressed", on ? "true" : "false");
    // Brief 02 §2: distinct on/off switch SFX. clickSwitchOpen when turning on,
    // clickSwitchClose when turning off — paired with the toggle logic.
    playSfx(on ? sfxSwitchOpen : sfxSwitchClose, 160);
  }

  if (lightSwitch && room) {
    lightSwitch.addEventListener("click", function (e) {
      e.stopPropagation(); // don't let it bubble to the room click handler
      setLights(!lightsOn);
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

    // Guard: if this panel is already open, don't open it again — otherwise
    // a rapid double-click would stack a second backdrop (and the open SFX).
    if (!panel.hidden) return;

    var backdrop = document.createElement("div");
    backdrop.className = "panel-backdrop";
    document.body.appendChild(backdrop);
    panel._backdrop = backdrop;

    panel.hidden = false;
    backdrop.addEventListener("click", function () { closePanel(panel); });
    updateScrollLock();

    // Feature 3: subtle open click. Debounced so double-taps don't machine-gun.
    playSfx(sfxOpen, 120);

    // Feature 2: lazily fetch the live visitor count when this panel opens.
    if (id === "panel-visitors") loadVisitorCount();
    // Brief 04 §4: one-time typewriter reveal on the INSPIRATION wing
    // descriptions when the credits panel first opens — echoes mxrza.xyz's
    // "computer vibe". Session-guarded so it runs at most once per page load.
    if (id === "panel-credits") runCreditsTypewriter();
  }

  room.addEventListener("click", function (e) {
    var spot = e.target.closest(".hotspot");
    if (!spot) return;
    // The light switch is its own handler (above) with stopPropagation, so it
    // never reaches here. Other hotspots open a panel.
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
    // Feature 3: subtle close click, distinct take from the open sound.
    playSfx(sfxClose, 120);
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
    playSfx(sfxZoomIn, 120);
    updateScrollLock();
  });

  // ---- 4b) Project card: expandable full description ------------------
  // Reuses the song-card .is-expanded toggle convention. One delegated
  // listener on #panels catches all ".project-more" button clicks and flips
  // .is-expanded on the enclosing .project-item. CSS reveals .project-full.
  panelsWrap.addEventListener("click", function (e) {
    var moreBtn = e.target.closest(".project-more");
    if (!moreBtn) return;
    var item = moreBtn.closest(".project-item");
    if (!item) return;
    var open = item.classList.toggle("is-expanded");
    moreBtn.setAttribute("aria-expanded", open ? "true" : "false");
  });

  function closeLightbox() {
    if (!lightbox) return;
    playSfx(sfxZoomOut, 120);
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

  // ---- 6b) Timeline panel (Brief 02 §1 / Brief 03) ---------------------
  // Two sections in one panel: the long arc (yearly, 2020-2025) and the
  // recent sprint (monthly, 2026). Entries live here as a single data
  // block so editing dates/wording never means touching layout/markup.
  // Render preserves the existing list-label/list-desc class structure
  // (Brief 03 explicitly supersedes the timeline-entry/timeline-date
  // classes suggested in Brief 02).
  var TIMELINE = {
    long: [
      { label: "Wanted to become a programmer : Started coding in python (but was stuck in Tutorial hell)", when: "2020" },
      { label: "Wanted to become an animator : Bought my first drawing tablet", when: "2021" },
      { label: "Wanted to become a psychologist (But didnt want to become a therapist)", when: "2022" },
      { label: "Started teaching myself guitar", when: "2023" },
      { label: "Wanted to become a music composer & artist : Felt discouraged because the future isn't that sustainable", when: "2024" },
      { label: "Wanted to become a paramedic : But pressured to become a doctor", when: "2025" }
    ],
    recent: [
      { label: "On the last week of upu submission, made the decision to go for Computer Science Software Engineering", when: "2026 March" },
      { label: "Just after finishing matrics, taught myself how to code basic python", when: "2026 May" },
      { label: "Got into web developing (started learning basic JS, HTML, CSS)", when: "2026 June" },
      { label: "I had a lot of ideas and I utilized AI to make it into a reality.", when: "2026 July" }
    ]
  };

  function renderTimeline() {
    var longEl  = document.getElementById("timeline-long");
    var recEl   = document.getElementById("timeline-recent");
    if (!longEl || !recEl) return;

    function fill(ul, entries) {
      var html = "";
      for (var i = 0; i < entries.length; i++) {
        html += '<li><span class="timeline-node"></span>' +
                '<span class="list-label"></span>' +
                '<span class="list-desc"></span></li>';
      }
      ul.innerHTML = html;
      var lis = ul.children;
      for (var j = 0; j < entries.length; j++) {
        lis[j].querySelector(".list-label").textContent = entries[j].label;
        lis[j].querySelector(".list-desc").textContent  = entries[j].when;
      }
    }
    fill(longEl, TIMELINE.long);
    fill(recEl,  TIMELINE.recent);
  }

  renderTimeline();

  // ---- 6c) Credits typewriter (Brief 04 §4) -----------------------------
  // A one-time (per session) typewriter reveal on the INSPIRATION wing
  // plaque descriptions when the credits panel first opens. Echoes
  // mxrza.xyz's "computer vibe" without being looped or gimmicky. Targets
  // are the <p class="plaque-body" data-typewriter> elements — the full text
  // is captured from the DOM at run time so there's one source of truth
  // (the HTML), and the CSS min-height on .plaque-body keeps the plaque
  // from reflowing as characters stream in.
  //
  // Session guard (creditsTypewritered) means it fires at most once even if
  // the user closes and reopens the panel. If the user closes mid-type the
  // setTimeout chain keeps draining into the hidden element, so by the next
  // open the text is guaranteed to be complete.
  var creditsTypewritered = false;

  function runCreditsTypewriter() {
    if (creditsTypewritered) return;
    var panel = document.getElementById("panel-credits");
    if (!panel) return;
    var targets = Array.prototype.slice.call(panel.querySelectorAll("[data-typewriter]"));
    if (!targets.length) { creditsTypewritered = true; return; }
    creditsTypewritered = true;

    // Stash the full string on each target so a future call (e.g. if the guard
    // were ever removed) wouldn't read a half-typed value as the source.
    targets.forEach(function (el) {
      if (!el.getAttribute("data-full")) el.setAttribute("data-full", el.textContent);
    });

    var TYPE_MS = 26;     // per character — mxrza-style brisk, not theater-slow
    var GAP_MS = 140;     // pause between plaques

    function typeEl(el, done) {
      var full = el.getAttribute("data-full");
      el.textContent = "";
      var i = 0;
      function tick() {
        if (i >= full.length) { el.textContent = full; if (done) done(); return; }
        i++;
        el.textContent = full.slice(0, i);
        window.setTimeout(tick, TYPE_MS);
      }
      tick();
    }

    function next() {
      if (targets.length === 0) return;
      var el = targets.shift();
      typeEl(el, function () { window.setTimeout(next, GAP_MS); });
    }
    next();
  }

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

      // A manually-started track is a restart: clear the bar's
      // "stopped by video" state.
      clearPlayerStoppedUI();

      // b) Is the OST making sound right now?
      var ostIsAudible = ost && !ost.paused && ost.volume > 0;

      if (!ostIsAudible) {
        return; // nothing to fade — let the track play immediately
      }

      // OST is audible: pause this track, fade the OST, then replay the track.
      track.pause();
      fadeOutAndPause(ost, 3000);
      window.setTimeout(function () {
        if (videoSuppressed) return; // a YouTube video started during the fade — stay silent
        track._delayedReplay = true;
        var p = track.play();
        if (p && typeof p.then === "function") {
          p.catch(function () { track._delayedReplay = false; });
        }
        // After the OST fades, show the shuffle player bar.
        showShufflePlayer();
      }, 3000);
    }, true); // capture phase (play events don't bubble)

    // Room-tone tracker: music-panel <audio> cards are created dynamically by
    // renderSongs(), so we catch their play/pause/ended events here on the
    // container (capture phase — these events don't bubble). (Brief 02 §5)
    ["play", "pause", "ended"].forEach(function (evtName) {
      musicPanel.addEventListener(evtName, function (e) {
        if (e.target.tagName !== "AUDIO") return;
        if (evtName === "play") audioStarted(e.target);
        else                    audioStopped(e.target);
      }, true);
    });
  }
  // ---- 9) Shuffle music player -----------------------------------------
  // A small fixed bar at the bottom of the screen. Revealed the moment the
  // visitor enters the site (enterSite) and always visible afterwards —
  // regardless of playback state. Plays songs in random order. Also serves
  // as the manual restart point after a YouTube embed stops site music.
  var shufflePlayer = document.getElementById("shuffle-player");
  var shuffleAudio = document.getElementById("shuffle-audio");
  // Register the shuffle player with the room-tone tracker (Brief 02 §5).
  trackAudio(shuffleAudio);
  var shufflePlayBtn = document.getElementById("shuffle-play");
  var shufflePrevBtn = document.getElementById("shuffle-prev");
  var shuffleNextBtn = document.getElementById("shuffle-next");
  var shuffleLabel = document.getElementById("shuffle-label");
  var shuffleOrder = [];          // array of song indices, shuffled
  var shufflePos = 0;             // current position in shuffleOrder
  var shuffleShowing = false;

  function showShufflePlayer() {
    if (shuffleShowing || !shufflePlayer) return;
    shuffleShowing = true;
    // Build the shuffle order once, on entry.
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
    // Pressing play on the bar is a manual (re)start: clear any
    // "stopped by video" state first.
    clearPlayerStoppedUI();
    // The bar is always visible now, so it can be started while the
    // one-time OST is still audible — hand over with a short fade instead
    // of letting them overlap. The OST never comes back on its own.
    if (ost && !ost.paused && ost.volume > 0) fadeOutAndPause(ost, 1200);
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
  // No close button: the bar is persistent by design (always visible).

  // When the current shuffle track ends, move to the next one automatically.
  if (shuffleAudio) {
    shuffleAudio.addEventListener("ended", shuffleNext);
  }

  // ---- 9b) Shared audio state manager: YouTube embeds vs. site music -----
  // One small object owns the "a YouTube embed is playing" state, so the YT
  // wiring and the audio elements never reach into each other. Everything
  // lives in this IIFE closure — no globals beyond the one callback the
  // IFrame API itself requires (see 9c).
  //
  //   stopAllForVideo()  (YT PLAYING)  — cut the room-tone bed, HARD-STOP the
  //      one-time OST (pause AND rewind to 0 — stop, not pause), pause the
  //      shuffle bar (keeps its position) and any music-panel track, then
  //      flip the bar to its "stopped" visual state.
  //   releaseVideo()     (YT PAUSED/ENDED) — lift the suppression so the idle
  //      room-tone bed may return, but DO NOT resume any music. The visitor
  //      restarts it manually from the bar.
  //
  // The shared videoSuppressed flag (declared with the room-tone vars) also
  // gates startRoomTone() and startOst(), so nothing queued (the VCR-intro
  // OST start, the 3s OST-fade delayed replay, the room-tone debounce) can
  // fire audio while a video is up.
  var audioDirector = {
    stopAllForVideo: function () {
      videoSuppressed = true;            // FIRST — blocks the room-tone restart
      stopRoomTone();                    // cut the ambient bed instantly
      if (ost) {
        if (!ost.paused) ost.pause();
        try { ost.currentTime = 0; } catch (e) {}  // STOP, not pause
      }
      if (shuffleAudio && !shuffleAudio.paused) shuffleAudio.pause();
      if (musicPanel) {
        var tracks = musicPanel.querySelectorAll("audio");
        for (var i = 0; i < tracks.length; i++) {
          if (!tracks[i].paused) tracks[i].pause();
        }
      }
      setPlayerStoppedUI(true);
    },
    releaseVideo: function () {
      if (!videoSuppressed) return;
      videoSuppressed = false;
      // If the visitor already restarted music manually mid-video, leave
      // the bar and the bed alone.
      if (activeAudio.size === 0) {
        setPlayerStoppedUI(false);       // stays "stopped"; hint -> press play
        startRoomTone();                 // only the idle bed may come back
      }
    }
  };

  // The bar's "stopped" visual state (CSS .is-stopped: dashed dim border +
  // a blinking square before the label). videoPlaying=true while the embed
  // is actively playing; false once it pauses/ends — the music stays
  // stopped either way until the visitor presses play (no auto-resume).
  function setPlayerStoppedUI(videoPlaying) {
    if (!shufflePlayer) return;
    shufflePlayer.classList.add("is-stopped");
    if (shufflePlayBtn) shufflePlayBtn.textContent = "play";
    if (shuffleLabel) {
      shuffleLabel.textContent = videoPlaying
        ? "stopped — video playing"
        : "stopped — press play to restart";
    }
  }
  function clearPlayerStoppedUI() {
    if (!shufflePlayer || !shufflePlayer.classList.contains("is-stopped")) return;
    shufflePlayer.classList.remove("is-stopped");
    // Restore an honest label now that the "stopped" message is gone.
    if (shuffleLabel) {
      var cur = shuffleCurrentSong();
      shuffleLabel.textContent = (shuffleAudio.src && cur) ? ("shuffle: " + cur.title) : "shuffle";
    }
  }

  // ---- 9c) Journal video embeds: stop site music while a YT video plays --
  // Uses the YouTube IFrame API (YT.Player) to watch play state. Two
  // hardening steps vs. the previous version:
  //   1) The embed src must carry an `origin` param matching this page's
  //      origin, or some browsers silently never deliver API events. We
  //      append it once here (http/https only) rather than hardcoding one
  //      domain in index.html — the site is served from several.
  //   2) window.onYouTubeIframeAPIReady is the single global the IFrame API
  //      itself requires; everything it calls lives in the closure.
  // ytPlaying tracks each player individually so TWO playing videos don't
  // release the suppression when only one of them pauses/ends.
  var ytEmbeds = document.querySelectorAll("iframe.yt-embed");
  if (ytEmbeds.length) {
    var ytPlaying = new Set();           // YT.Player instances currently playing

    if (location.protocol === "http:" || location.protocol === "https:") {
      ytEmbeds.forEach(function (frame) {
        if (frame.src.indexOf("origin=") === -1) {
          frame.src += (frame.src.indexOf("?") === -1 ? "?" : "&") +
            "origin=" + encodeURIComponent(location.origin);
        }
      });
    }

    var ytTag = document.createElement("script");
    ytTag.src = "https://www.youtube.com/iframe_api";
    document.head.appendChild(ytTag);

    window.onYouTubeIframeAPIReady = function () {
      ytEmbeds.forEach(function (frame) {
        new YT.Player(frame.id, {
          events: {
            onStateChange: function (e) {
              if (e.data === YT.PlayerState.PLAYING) {
                ytPlaying.add(e.target);
                audioDirector.stopAllForVideo();
              } else if (e.data === YT.PlayerState.PAUSED ||
                         e.data === YT.PlayerState.ENDED) {
                ytPlaying.delete(e.target);
                if (ytPlaying.size === 0) audioDirector.releaseVideo();
              }
              // BUFFERING / CUED deliberately keep the suppression — a seek
              // shouldn't drop the stopped state or restart anything.
            }
          }
        });
      });
    };
  }

  // ---- 10) GoatCounter visitor count (Feature 2) ------------------------
  // GoatCounter exposes a public, auth-free JSON endpoint for exactly this:
  //   https://<code>.goatcounter.com/counter/TOTAL.json  ->  { "count": "1,234" }
  // The special path TOTAL (case-sensitive, no leading slash) gives the
  // site-WIDE total instead of a single page's. The number is cached up to
  // ~4h on GoatCounter's side, so it won't update in real time.
  //
  // We derive the GoatCounter base URL from the page's own count-script tag
  // (data-goatcounter="https://mynko.goatcounter.com/count") rather than
  // hardcoding the code, so this keeps working if the site is re-pointed.
  // Anything beyond total pageviews (referrers/locations/browsers) needs the
  // authenticated /api/v0/stats/* endpoints + a Bearer token — see the TODO
  // in index.html; that must live in a serverless proxy, never client-side.
  var visitorCountEl = document.getElementById("visitor-count");
  var visitorWarnEl  = document.getElementById("visitor-warn");
  var visitorCountLoaded = false;

  function loadVisitorCount() {
    if (!visitorCountEl || visitorCountLoaded) return;
    visitorCountLoaded = true; // fetch at most once per page load
    visitorCountEl.textContent = "...";
    visitorCountEl.classList.remove("is-error");
    if (visitorWarnEl) visitorWarnEl.hidden = true;

    var gcScript = document.querySelector("script[data-goatcounter]");
    var gcBase = "https://mynko.goatcounter.com";
    if (gcScript) {
      var attr = gcScript.getAttribute("data-goatcounter") || "";
      gcBase = attr.replace(/\/count\/?$/, "") || gcBase;
    }
    var url = gcBase + "/counter/TOTAL.json";

    fetch(url, { cache: "no-store" })
      .then(function (r) {
        if (!r.ok) throw new Error("GC " + r.status);
        return r.json();
      })
      .then(function (d) {
        var n = d && d.count ? String(d.count) : "";
        visitorCountEl.textContent = n || "—";
        if (!n) { visitorCountEl.classList.add("is-error"); if (visitorWarnEl) visitorWarnEl.hidden = false; }
      })
      .catch(function (err) {
        // CORS off or setting disabled — fail to a quiet "—" rather than crashing.
console.log("GoatCounter count failed:", err);
        visitorCountEl.textContent = "\u2014";
        visitorCountEl.classList.add("is-error");
        if (visitorWarnEl) visitorWarnEl.hidden = false;
      });
  }

  // ---- 11) Functional clock (UTC+8) -------------------------------------
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
