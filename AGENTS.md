# myta-catalogue — Agent Instructions

Standing context for this project. Loaded automatically every Pi session — task-specific instructions belong in the brief pasted at the start of each session, not here.

## Project Overview

Interactive, diorama-style personal portfolio. The homepage is a single photo of a real desk/shelf; objects in the photo are wired up as clickable hotspots that open panels (Projects, Music, Drawings, Photos, Journal, Timeline, etc.). Static site, no build step, hosted on GitHub Pages under a custom domain (`javanmyna.fyi`, per CNAME). A guestbook feature ("Sign Wall") was added after the README was last written and is backed by Supabase — treat the README's project description as slightly stale on that point, the code is the source of truth.

## Tech Stack

- Vanilla HTML / CSS / JavaScript — no framework, no bundler, no build step
- `script.js` — single IIFE: hotspot event delegation, panel open/close, audio/SFX handling, lightbox, shuffle music player, passion timeline
- `songs.js` — single source of truth for Music panel track data
- Supabase (Postgres + Auth-free, anonymous) for the Sign Wall guestbook — `js/supabaseClient.js` (client init) + `js/signWall.js` (guestbook logic)
- GoatCounter for pageview analytics (public endpoint, no auth)
- Google Fonts: Press Start 2P (headers/labels), Pixelify Sans (body)
- Python tooling in `tools/` (Pillow-based) — dev-only, not part of the site runtime

## Project Structure

```
index.html            # markup, hotspots, panel content — has REPLACE markers for new entries
style.css               # theme, layout, room/panel styling
script.js                 # hotspot wiring, panels, clock, timeline, lightbox, shuffle player
songs.js                    # music track data
css/signWall.css               # guestbook styling
js/supabaseClient.js             # Supabase client init (public anon key — see note below)
js/signWall.js                     # Sign Wall guestbook logic
sql/signs_schema.sql                 # guestbook schema + RLS, run manually in Supabase SQL editor — site never executes this
tools/audit_exif.py                    # read-only EXIF/GPS audit for images, run before committing new photos
tools/optimize_images.py                 # strips metadata, resizes (max 1200px), converts to WebP
assets/{art,credits,misc,music,photography,sfx}/  # all site media
favicon/
```

## Known Patterns — House Rules

- **Never commit an unprocessed photo.** New images going into `assets/photography/` or `assets/art/` must go through `tools/optimize_images.py` first (strips EXIF/GPS metadata, applies orientation correctly before stripping, resizes to a 1200px max side, converts to WebP). Run `tools/audit_exif.py` first if you want to see exactly what metadata a given file is carrying before deciding. This is a hard rule, not a suggestion — this project has already had committed images with GPS/EXIF metadata flagged before.
- **The Supabase anon key in `js/supabaseClient.js` is intentionally public** — it's a publishable key, not a secret. The real security boundary is the RLS policies in `sql/signs_schema.sql` (public read of approved signs only, insert-only with a server-side 60-char CHECK constraint, no update/delete policies at all). Do not add update/delete policies, and do not treat the client-side character-limit guard as the real enforcement — the DB constraint is. Flag any change to `sql/signs_schema.sql` explicitly since it's a data-exposure-risk file, same as Safe2Save's migration.
- **Reuse existing markup and code patterns — do not invent new ones.** New panel entries (projects, drawings, books, journal posts, corkboard writeups) go at the existing `<!-- REPLACE: ... -->` markers in `index.html`, following the surrounding markup exactly. New hotspots hook into the existing `openPanel()` delegation in `script.js` rather than adding separate click listeners.
- **Respect the lazy-load boundary.** Only images explicitly listed for preload (splash-adjacent thumbnails) skip `loading="lazy"`. Any new `<img class="panel-thumb">` added to a gallery should keep `loading="lazy"` unless there's a specific reason to preload it — don't remove the attribute by habit when copying an existing block.
- **Don't commit `desktop.ini` or other Windows filesystem metadata files** — one is already tracked in the repo root. Use relative/POSIX-style paths in any new file references regardless of what OS the edit was made on (this project has hit Windows-path-to-web-path conversion bugs before).
- **When reading this repo remotely (not from a local clone), prefer `raw.githubusercontent.com` over the GitHub API tree endpoint** — the tree endpoint rate-limits much faster on a repo this size (170MB+ of assets).

## Local Setup (for reference, not to be repeated by the agent)

No build step. Clone, then either open `index.html` directly or serve locally — serving is recommended so relative asset paths and preloads behave the same as production:

```bash
python -m http.server 8000
```