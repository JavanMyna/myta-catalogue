/* ============================================================
   MitaCatalogue — js/signWall.js
   Sign Wall (guestbook). Vanilla JS, no framework — same style as
   script.js. Talks to Supabase over the browser via the client
   initialized in js/supabaseClient.js (window.sb).

   Responsibilities:
     - Build a Minecraft-block-style grid wall (data-driven in JS).
     - On panel open, fetch approved signs from Supabase and render
       them at their stored grid coordinates (same % positioning
       pattern the hotspot system uses).
     - Click an empty cell  -> open a placement modal (60-char limit,
       mimicking Minecraft's 4-line x 15-char sign).
     - Submit -> client-side profanity + length + honeypot + 24h
       localStorage rate-limit checks -> optimistic render -> persist
       via Supabase insert. Roll back on DB error.
     - Occupied cells can't be double-placed on.
     - Graceful empty/error/loading states; no console errors when
       Supabase is unconfigured or cold-starts.

   Security notes:
     - All user text goes in via textContent (never innerHTML), mirroring
       the script.js security habit. Even though the wall renders
       attacker-controlled strings, they can't inject markup.
     - The Supabase anon key is public by design; RLS + the CHECK
       constraint (see sql/signs_schema.sql) are the real enforcement.
     - Client-side profanity / rate-limit / honeypot are bypassable by a
       determined user — they are the v1 "raise the bar" layer, not the
       security boundary. The DB CHECK on char_length is the one
       server-side guarantee for MVP. A Supabase Edge Function for
       server-side profanity re-check + hashed-IP rate limiting is the
       documented fast-follow (out of scope for MVP).
   ============================================================ */

(function () {
  "use strict";

  // ---- Config ----------------------------------------------------------
  // Grid dimensions. 12 x 8 = 96 cells; signs render centered in a cell
  // using the same % + translate(-50%,-50%) pattern as the room hotspots.
  var GRID_COLS = 12;
  var GRID_ROWS = 8;
  var MAX_CHARS = 60; // matches the DB CHECK constraint in signs_schema.sql

  // localStorage flag for the 24h, one-sign-per-browser rate limit.
  var RATE_KEY = "signWall_lastSubmit";
  var RATE_MS = 24 * 60 * 60 * 1000;

  // v1 profanity list. Small on purpose — this is a bar-raiser, not a real
  // filter. The Edge Function fast-follow would re-check server-side.
  var PROFANITY = [
    "fuck", "shit", "bitch", "asshole", "cunt", "dick", "piss", "slut", "whore", "nigger", "faggot", "retard"
  ];

  // ---- DOM hooks -------------------------------------------------------
  var panel = document.getElementById("panel-signwall");
  if (!panel) return; // panel markup missing — nothing to do, fail silent

  var wallEl = panel.querySelector(".wall");
  var blocksEl = panel.querySelector(".wall-blocks");
  var overlayEl = panel.querySelector(".wall-overlay");
  var loadingEl = panel.querySelector(".wall-loading");
  var emptyEl = panel.querySelector(".wall-empty");
  var errorEl = panel.querySelector(".wall-error");
  var disabledEl = panel.querySelector(".wall-disabled");
  if (!wallEl || !blocksEl || !overlayEl) return;

  // ---- state -----------------------------------------------------------
  var placed = new Map();   // "x,y" -> { id, text, gx, gy, el, optimistic }
  var modalOpen = false;    // Esc handler rewires when this is true
  var pendingCell = null;   // { gx, gy } for the cell currently in the modal
  var fetching = false;

  // ---- helpers ---------------------------------------------------------
  function cellKey(gx, gy) { return gx + "," + gy; }

  // Convert a click event into grid coordinates, or null if outside the grid.
  function eventCell(e) {
    var rect = wallEl.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    var fx = (e.clientX - rect.left) / rect.width;
    var fy = (e.clientY - rect.top) / rect.height;
    if (fx < 0 || fx > 1 || fy < 0 || fy > 1) return null; // click on padding
    var gx = Math.floor(fx * GRID_COLS);
    var gy = Math.floor(fy * GRID_ROWS);
    if (gx < 0 || gx >= GRID_COLS || gy < 0 || gy >= GRID_ROWS) return null;
    return { gx: gx, gy: gy };
  }

  // % position of the CENTER of a cell — same translate(-50%,-50%) convention
  // the room hotspots use (see style.css .hotspot), so signs align with cells
  // at any zoom level.
  function cellCenterPct(gx, gy) {
    return {
      left: ((gx + 0.5) / GRID_COLS) * 100,
      top: ((gy + 0.5) / GRID_ROWS) * 100
    };
  }

  function containsProfanity(text) {
    var s = text.toLowerCase();
    for (var i = 0; i < PROFANITY.length; i++) {
      // word-boundary-ish check so "class" doesn't trip "ass"
      if (new RegExp("\\b" + PROFANITY[i] + "\\b").test(s)) return true;
    }
    return false;
  }

  function rateLimited() {
    var t = parseInt(localStorage.getItem(RATE_KEY) || "0", 10);
    return !!(t && (Date.now() - t) < RATE_MS);
  }

  function rateRemainingMs() {
    var t = parseInt(localStorage.getItem(RATE_KEY) || "0", 10);
    if (!t) return 0;
    return Math.max(0, RATE_MS - (Date.now() - t));
  }

  // fmt a remaining duration as "Xh Ym" for the rate-limit notice.
  function fmtRemaining(ms) {
    var m = Math.ceil(ms / 60000);
    if (m < 60) return m + "m";
    var h = Math.floor(m / 60);
    var rem = m % 60;
    return rem ? h + "h " + rem + "m" : h + "h";
  }

  // ---- block grid (visual only, no per-cell listeners) ------------------
  // Build the Minecraft-style plank wall once. 96 divs is cheap; one click
  // listener lives on the wall container itself (see "click surface").
  function buildBlocks() {
    if (blocksEl.childElementCount) return; // already built
    var frag = document.createDocumentFragment();
    for (var y = 0; y < GRID_ROWS; y++) {
      for (var x = 0; x < GRID_COLS; x++) {
        var b = document.createElement("div");
        b.className = "block";
        b.setAttribute("data-x", x);
        b.setAttribute("data-y", y);
        // subtle per-cell shade variation for a pixel-art plank texture
        b.classList.add("block-shade-" + ((x * 3 + y * 7) % 4));
        frag.appendChild(b);
      }
    }
    blocksEl.appendChild(frag);
  }

  // ---- rendering signs --------------------------------------------------
  // Render one sign sprite into the overlay layer. textContent only — never
  // innerHTML — so a visitor can't inject markup into the wall.
  function renderSign(sign) {
    if (placed.has(cellKey(sign.gx, sign.gy))) return; // cell already taken
    var pos = cellCenterPct(sign.gx, sign.gy);

    var el = document.createElement("div");
    el.className = "sign" + (sign.optimistic ? " is-optimistic" : "");
    el.style.left = pos.left + "%";
    el.style.top = pos.top + "%";

    var board = document.createElement("div");
    board.className = "sign-board";

    var text = document.createElement("span");
    text.className = "sign-text";
    text.textContent = sign.text; // safe: no HTML injection
    board.appendChild(text);

    el.appendChild(board);
    overlayEl.appendChild(el);

    placed.set(cellKey(sign.gx, sign.gy), {
      id: sign.id,
      text: sign.text,
      gx: sign.gx,
      gy: sign.gy,
      el: el,
      optimistic: !!sign.optimistic
    });
  }

  function removeSign(gx, gy) {
    var key = cellKey(gx, gy);
    var s = placed.get(key);
    if (!s) return;
    if (s.el && s.el.parentNode) s.el.parentNode.removeChild(s.el);
    placed.delete(key);
  }

  function updateEmptyState() {
    if (!emptyEl) return;
    emptyEl.hidden = placed.size !== 0;
  }

  // ---- fetch from Supabase ---------------------------------------------
  var stateEls = null; // built lazily so missing markup doesn't blow up
  function stateMap() {
    if (!stateEls) stateEls = { loading: loadingEl, empty: emptyEl, error: errorEl, disabled: disabledEl };
    return stateEls;
  }
  function showState(which) {
    var map = stateMap();
    Object.keys(map).forEach(function (k) { if (map[k]) map[k].hidden = true; });
    if (which && map[which]) map[which].hidden = false;
  }

  function fetchSigns() {
    // First-time / cold-start path: a friendly loading state instead of a
    // blank flash (free-tier Supabase projects pause after inactivity).
    if (fetching) return;
    if (!window.sb) { showState("disabled"); return; }
    fetching = true;
    showState("loading");

    window.sb
      .from("signs")
      .select("id,text,grid_x,grid_y")
      .eq("approved", true)
      .order("created_at", { ascending: false })
      .then(function (res) {
        fetching = false;
        if (res && res.error) {
          console.log("[signWall] fetch error:", res.error);
          showState("error");
          return;
        }
        var rows = (res && res.data) ? res.data : [];

        // Clear any optimistic signs from a previous session (reload safety).
        placed.clear();
        overlayEl.textContent = "";

        for (var i = 0; i < rows.length; i++) {
          var r = rows[i];
          // Ensure unique cell: earlier rows win (DESC created_at => newest
          // first), identical cells from a race are deduped here.
          if (!placed.has(cellKey(r.grid_x, r.grid_y))) {
            renderSign({ id: r.id, text: r.text, gx: r.grid_x, gy: r.grid_y });
          }
        }
        if (placed.size === 0) showState("empty");
        else showState(null);
      })
      .catch(function (err) {
        fetching = false;
        console.log("[signWall] fetch threw:", err);
        showState("error");
      });
  }

  // ---- click surface ----------------------------------------------------
  // ONE listener on the wall container (not per cell) — keeps 50+ signs and
  // 96 blocks cheap and stress-test-clean. The overlay layer has
  // pointer-events:none in CSS so clicks pass through to this surface even
  // when a sign sprite sits under the cursor.
  wallEl.addEventListener("click", function (e) {
    if (!window.sb) return; // disabled (unconfigured) -> ignore clicks
    if (fetching) return;   // still loading -> ignore
    if (modalOpen) return;  // modal already up -> ignore stray clicks
    var cell = eventCell(e);
    if (!cell) return;
    if (placed.has(cellKey(cell.gx, cell.gy))) return; // occupied -> ignore

    if (rateLimited()) {
      toast("one sign per day — come back in " + fmtRemaining(rateRemainingMs()));
      return;
    }
    openModal(cell);
  });

  // tiny transient toast that floats over the wall for ~2.5s
  var toastTimer = null;
  function toast(msg) {
    var t = panel.querySelector(".wall-toast");
    if (!t) return;
    t.textContent = msg;
    t.hidden = false;
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, 2500);
  }

  // ---- placement modal --------------------------------------------------
  // Injected once into <body> so it floats above everything (z-index above
  // the signwall panel + its backdrop, matching how the lightbox works).
  var modalEl = null;
  var textareaEl = null;
  var counterEl = null;
  var honeypotEl = null;
  var errorElModal = null;
  var submitBtnEl = null;

  function buildModal() {
    if (modalEl) return;
    modalEl = document.createElement("div");
    modalEl.className = "signmodal";
    modalEl.hidden = true;
    modalEl.setAttribute("role", "dialog");
    modalEl.setAttribute("aria-modal", "true");
    modalEl.setAttribute("aria-labelledby", "signmodal-title");

    // rows=4 cols=15 visually mimics a Minecraft sign's 4 lines x 15 chars.
    // maxlength=60 is the client-side mirror of the DB CHECK constraint.
    modalEl.innerHTML =
      '<div class="signmodal-frame">' +
        '<div class="signmodal-bar">' +
          '<span class="signmodal-title" id="signmodal-title">leave a sign</span>' +
          '<button type="button" class="signmodal-close" data-close aria-label="Close">x</button>' +
        '</div>' +
        '<div class="signmodal-body">' +
          '<p class="signmodal-hint">60 chars max · 1 sign per day</p>' +
          // Honeypot: hidden from humans, attractive to bots. Silently dropped
          // on submit; never labelled visibly.
          '<input class="signmodal-hp" type="text" name="website" tabindex="-1" autocomplete="off" aria-hidden="true">' +
          '<textarea class="signmodal-text" rows="4" cols="15" maxlength="' + MAX_CHARS + '" placeholder="your message"></textarea>' +
          '<div class="signmodal-foot">' +
            '<span class="signmodal-counter" aria-live="polite">0 / ' + MAX_CHARS + '</span>' +
            '<span class="signmodal-error" role="alert"></span>' +
          '</div>' +
          '<div class="signmodal-actions">' +
            '<button type="button" class="signmodal-cancel" data-close>cancel</button>' +
            '<button type="button" class="signmodal-submit">place</button>' +
          '</div>' +
        '</div>' +
      '</div>';

    document.body.appendChild(modalEl);

    textareaEl = modalEl.querySelector(".signmodal-text");
    counterEl = modalEl.querySelector(".signmodal-counter");
    honeypotEl = modalEl.querySelector(".signmodal-hp");
    errorElModal = modalEl.querySelector(".signmodal-error");
    submitBtnEl = modalEl.querySelector(".signmodal-submit");
    submitBtnEl.disabled = true; // nothing to submit yet

    // char counter
    textareaEl.addEventListener("input", function () {
      var n = textareaEl.value.length;
      counterEl.textContent = n + " / " + MAX_CHARS;
      counterEl.classList.toggle("is-warn", n > MAX_CHARS - 5);
      submitBtnEl.disabled = (n === 0);
      errorElModal.textContent = "";
    });

    // Enter submits; Shift+Enter inserts a newline for multi-line messages.
    textareaEl.addEventListener("keydown", function (e) {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        submitSign();
      }
    });

    // Submit button. submitSign is a function declaration (hoisted), so
    // referencing it here is safe even though it reads as forward.
    submitBtnEl.addEventListener("click", submitSign);

    // close buttons + backdrop click
    modalEl.addEventListener("click", function (e) {
      if (e.target.closest("[data-close]")) { closeModal(); return; }
      if (!e.target.closest(".signmodal-frame")) closeModal(); // backdrop
    });
  }

  function openModal(cell) {
    buildModal();
    pendingCell = cell;
    modalOpen = true;
    textareaEl.value = "";
    honeypotEl.value = "";
    counterEl.textContent = "0 / " + MAX_CHARS;
    counterEl.classList.remove("is-warn");
    errorElModal.textContent = "";
    submitBtnEl.disabled = true;
    submitBtnEl.textContent = "place";
    modalEl.hidden = false;
    // focus the textarea shortly after unhide so screen readers announce it
    setTimeout(function () { if (textareaEl) textareaEl.focus(); }, 30);
  }

  function closeModal() {
    if (!modalEl) return;
    modalEl.hidden = true;
    modalOpen = false;
    pendingCell = null;
  }

  function modalError(msg) {
    if (!errorElModal) return;
    errorElModal.textContent = msg;
    submitBtnEl.disabled = true; // re-enable on next input
  }

  // ---- submit / persist -------------------------------------------------
  function submitSign() {
    if (!pendingCell || !window.sb) return;

    // Honeypot: silently "succeed" without persisting. Looks like a real
    // insert to a naive bot, so it doesn't retry harder.
    if (honeypotEl.value && honeypotEl.value.length > 0) {
      closeModal();
      return;
    }

    var text = textareaEl.value;
    // Trim trailing whitespace; reject empty / whitespace-only.
    var trimmed = text.replace(/\s+$/g, "");
    if (trimmed.length === 0) { modalError("type something first"); return; }
    if (trimmed.length > MAX_CHARS) { modalError("too long"); return; }
    if (containsProfanity(trimmed)) { modalError("let's keep it clean"); return; }
    if (rateLimited()) {
      modalError("one per day — come back in " + fmtRemaining(rateRemainingMs()));
      return;
    }
    // Re-check occupancy in case a race filled the cell while modal was open.
    if (placed.has(cellKey(pendingCell.gx, pendingCell.gy))) {
      modalError("that spot was just taken — pick another");
      return;
    }

    submitBtnEl.disabled = true;
    submitBtnEl.textContent = "placing...";

    // Optimistic UI: render immediately so the visitor sees their sign before
    // the network round-trip resolves.
    var optimistic = {
      id: null,
      text: trimmed,
      gx: pendingCell.gx,
      gy: pendingCell.gy,
      optimistic: true
    };
    renderSign(optimistic);
    updateEmptyState();
    var cellForRollback = pendingCell; // capture before closeModal
    closeModal();

    // Persist. The DB CHECK + RLS are the real server-side enforcement; the
    // client-side guards above are convenience/bypassable.
    window.sb
      .from("signs")
      .insert({
        text: trimmed,
        grid_x: optimistic.gx,
        grid_y: optimistic.gy
      })
      .select("id,text,grid_x,grid_y")
      .single()
      .then(function (res) {
        if (res && res.error) {
          rollback(cellForRollback, "couldn't place your sign");
          return;
        }
        // confirm the row: swap the optimistic sprite for the real one
        var row = res.data || {};
        removeSign(optimistic.gx, optimistic.gy);
        renderSign({
          id: row.id,
          text: row.text,
          gx: row.grid_x,
          gy: row.grid_y
        });
        updateEmptyState();
        // record the 24h rate-limit stamp NOW (only on confirmed success)
        try { localStorage.setItem(RATE_KEY, String(Date.now())); } catch (e) {}
      })
      .catch(function (err) {
        console.log("[signWall] insert threw:", err);
        rollback(cellForRollback, "couldn't place your sign");
      });
  }

  function rollback(cell, msg) {
    if (cell) removeSign(cell.gx, cell.gy);
    updateEmptyState();
    if (msg) toast(msg);
  }

  // ---- Esc handling: modal first, then let the panel close -------------
  // script.js listens for Esc (bubble phase) to close the open panel. If our
  // modal is open, Esc should close ONLY the modal — capture phase fires
  // before script.js's handler, and stopPropagation prevents the panel from
  // also closing (which would leave the modal orphaned over the room).
  document.addEventListener("keydown", function (e) {
    if (e.key !== "Escape") return;
    if (modalOpen) {
      closeModal();
      e.stopPropagation();
    }
  }, true); // capture phase

  // ---- panel open: lazy fetch + enable interaction ----------------------
  // Mirror the clock panel pattern (script.js): a MutationObserver on the
  // panel's `hidden` attribute fires the fetch every time the guestbook
  // opens, so a returning visitor picks up signs left by other people since
  // their last visit.
  buildBlocks();

  var wallObserver = new MutationObserver(function () {
    if (!panel.hidden) fetchSigns();
  });
  wallObserver.observe(panel, { attributes: true, attributeFilter: ["hidden"] });

  // Initial state while the panel has never been opened: nothing rendered,
  // no cross-origin fetch fired for visitors who never open the guestbook.
})();