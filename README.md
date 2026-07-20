# MytaCatalogue

An interactive, diorama-style personal portfolio. Instead of a scrolling homepage, the front door is a photo of my actual DIY shelf setup — click around the room to explore my music, photography, drawings, and projects.

> Successor to [Myna Catalogue](https://javanmyna.github.io/myna-catalogue/), rebuilt around a "clickable room" concept instead of a traditional layout.

## Live
https://javanmyna.github.io/myta-catalogue/

## Screenshots

<img width="1366" height="635" alt="image" src="https://github.com/user-attachments/assets/e8ea3d86-00e6-45b3-969e-7319da5758e8" />
<img width="1366" height="635" alt="image" src="https://github.com/user-attachments/assets/9045934d-d28e-4da9-ba11-4e499775cb59" />

## Concept

The homepage is a single photo of my desk/shelf. Objects in the photo are wired up as invisible clickable hotspots — the laptop opens Projects, the sketchbook opens Drawings, the camera opens a photo gallery, and so on. Click the light switch to turn the room lights on; most hotspots stay dim until you do.

Enter through a click-to-start splash screen (browsers block autoplay audio until a user gesture) — this triggers a VCR insert sound effect, followed by a one-time background OST that fades into a shuffle music player once you start browsing tracks.

## Features

- **Room with hotspots** — percentage-positioned buttons over the shelf photo, so they stay aligned at any screen size
- **Light switch** — toggles the room between dark/lit states
- **Projects panel** — links out to my other repos and live sites (Jess Boubie Craft, 7 Degrees, PSPM Analysis, the original Myna Catalogue)
- **Music panel** — tracks rendered from `songs.js`; I play Sundatang, Sompoton, and guitar
- **Passion Timeline** — a data-driven timeline (`TIMELINE` object in `script.js`) of how I got into building things, in place of a certificates list
- **Live clock** — UTC+8, updates in real time
- **Drawings, Photos, "My life" galleries** — lazy-loaded image grids with a lightbox for full-size viewing
- **Corkboard & Shattered Glass** — zoomed-in views of physical art pieces with writeups
- **Journal** — short, informal dated posts; playing a YouTube embed stops the site music (manual restart from the player bar, no auto-resume)
- **Visitor counter** — pulls total pageviews from GoatCounter's public endpoint, no auth required
- **Shuffle music player** — fixed bottom bar for play/pause/skip, always visible once you enter

Some hotspots (music, certificates/timeline, clock, drawings, about, journal, books, photos, visitors) are wired up; two are intentionally left as no-op placeholders for future objects in the shelf photo.

## Tech stack

Vanilla HTML, CSS, and JavaScript — no frameworks, no build step.

- **Fonts:** [Press Start 2P](https://fonts.google.com/specimen/Press+Start+2P) (headers/labels) + [Pixelify Sans](https://fonts.google.com/specimen/Pixelify+Sans) (body text) via Google Fonts
- **Analytics:** [GoatCounter](https://www.goatcounter.com/) (privacy-friendly, public pageview count only)

## Project structure

```
myta-catalogue/
├── index.html          # markup, hotspots, and panel content
├── style.css            # theme, layout, room/panel styling
├── script.js            # hotspot wiring, panels, clock, timeline, lightbox, shuffle player
├── songs.js              # music track data (single source of truth for the Music panel)
├── favicon/               # favicon set
└── assets/
    ├── misc/               # room photo, corkboard, devlog + project images
    ├── credits/            # credit images
    ├── music/              # OST + tracks
    ├── sfx/                # VCR insert sound effect
    ├── art/                # drawings/sketchbook images
    └── photography/
        ├── cats/
        ├── people/
        └── environment/
```

## Running locally

No build tools needed — it's static HTML/CSS/JS.

```bash
git clone https://github.com/JavanMyna/myta-catalogue.git
cd myta-catalogue
```

Then either open `index.html` directly in a browser, or serve it locally (recommended, so relative asset paths and preloads behave the same as in production):

```bash
python -m http.server 8000
# then visit http://localhost:8000
```

## Status

Actively being built — hotspot positions were mapped from a wireframe sketch onto the real desk photo, and panel content gets filled in incrementally. Sections marked `REPLACE` in `index.html` are where new entries (projects, drawings, books, journal posts) get added over time.

## Development Process

Most features start with a written brief where I outline the requirements, edge cases, and constraints. I then use na LLM to help implement the feature, review the generated code, test it and make any necessary fixes or improvements.

While AI helps speed up development, I still handle the debugging, verification and final decisions.

## Credits

Built by [JavanMyna](https://github.com/JavanMyna). Predecessor project: [Myna Catalogue](https://javanmyna.github.io/myna-catalogue/).
