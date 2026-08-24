# Jinxed Tweaks

A Foundry VTT add-on that quietly fixes and improves other modules you already use. Turn it on once, keep it near the bottom of your module load order, and it only applies a tweak when that other module is also enabled — nothing hard-required, nothing breaks if a module is missing.

Built for Foundry **v14** (verified against 14.366).

## Install

1. Download or clone into `Data/modules/jinxed-tweaks`
2. Enable **Jinxed Tweaks** in **Manage Modules**
3. Load it **after** the modules you want it to patch (the manifest’s optional dependencies help with this)

## Features

### Tokens & the map

- **Smarter nameplates** — Names stay readable when tokens are crowded; they nudge aside instead of stacking on top of each other.
- **Token HUD extras (GM)** — Quick buttons to hide a token’s name, mirror its art left/right, and hide the hover/selection box.
- **DM map notes (GM)** — Draw an area on the map and attach a private note (rooms, loot, secrets). Players never see these. Works on any tool, not just Journal Notes.
- **Temporary elevation regions** — A new region behavior: walk in, get lifted to a set height; walk out, return to where you were. Handy for bridges, balconies, and lifts.
- **Night maps (with Levels)** — Optional “night” backgrounds and tile textures that swap in automatically when the scene gets dark.
- **Better occlusion** — Player characters get a sensible fog-of-war hole under roofs; overhead tiles can use a wider “see-through” radius so sails and awnings feel right.
- **Levels polish** — Tokens on floors below your current level fade out of the way so you are not clicking through the deck to reach the map.

### Campaign Codex

*Only when [Campaign Codex](https://foundryvtt.com/packages/campaign-codex) is installed.*

- **Wiki import (GM)** — Pull a Fandom wiki article straight into a codex entry. Pick the page, choose which sections to keep, replace or append your text.
- **Improve writing (GM, optional)** — Sparkles button on prose fields; optional OpenAI key in module settings for a light editorial pass.
- **Auto-linking** — Names of existing codex entries in your text become clickable links automatically.
- **Organizations** — A separate sheet type alongside Factions: guilds, churches, councils, etc., with their own hub category and journal button.
- **Hub folders (GM)** — In the Campaign Codex hub, right-click a category (e.g. People) to add folders and drag entries into them.
- **Known People on faction sheets** — Faction-style sheets get a proper member list and sidebar shortcuts, like city sheets already had.
- **UI cleanup** — “NPCs” reads as **People** where it matters; fewer redundant headers; location sheets get the same “new faction” button other types have.

### Combat & initiative

- **Argon Combat HUD** — Spell tooltips stay beside the spell instead of covering it; scrolling the description works; fewer stuck clicks.
- **Epic Rolls 5e** — When combat starts, initiative rolls can kick off automatically with the module’s cinematic presentation (GM).
- **Bossbar** — Big enemies (300+ HP, hostile, visible) get a boss HP bar automatically when combat begins.

### Characters, items & imports

- **D&D Beyond import** — Fewer failed imports from bloodied/encumbrance timing, backpack items wrongly skipped, and HP accidentally zeroed on sync.
- **DAE** — Cleans up old effect data that would spam errors or break on load.
- **Convenient Effects bridge** — Right-click conditions, drag-and-drop effects, and status icons play nicely with Convenient Effects, Active Token Effects, and radial effect rings.
- **Token Notes** — A player’s notes follow their **character** across every map copy of that token, not just one scene.

### Vision, lighting & atmosphere

- **Vision 5e** — Creatures you only hear or cannot see properly stay hidden (swirl ping, no nameplate peeking through invisibility).
- **Simple Timekeeping** — Day/night darkness transitions smoothly again when the calendar module is in use.
- **Simraki radial effects** — Condition rings around tokens: tooltips work, icons stay clickable, clusters spread out when tokens move together.

### General UI & quality of life

- **Sidebar memory** — Scene and actor folder open/closed state survives a refresh.
- **Cleaner canvas** — Default empty map background is a comfortable dark gray instead of light grey.
- **Hotbar** — Macro bar stays hidden until you hover near the bottom of the screen (still appears when dragging things to it).
- **Spotlight Omnisearch** — “Click to dismiss” and “don’t pop open on every login” actually stick to your user account.
- **Tidbits** — Smoother loading screen handoff so the map does not flash white before Tidbits finishes.
- **Less console noise** — Known harmless warnings from popular modules are filtered so real errors stand out.

## How it works

Jinxed Tweaks loads late and patches other modules in place — you do not configure each fix individually. On world load, the browser console shows lines like `jinxed-tweaks | Applied …` or `Skipped …` so you can see what ran.

Optional relationships in `module.json` list modules this package is designed to work alongside; that helps Foundry keep Jinxed Tweaks near the end of the load order.

## For developers

```text
jinxed-tweaks/
├── module.json
├── languages/en.json
├── styles/tweaks.css
├── templates/
└── scripts/
    ├── main.mjs
    └── tweaks/
        └── registry.mjs    ← list of tweaks
```

Tweak entries live in `scripts/tweaks/registry.mjs`. Each targets one module id and runs only when that module is active.

## Notes

- Module id: `jinxed-tweaks`
- Some hosting-specific overlays (for example a private CDN rewrite layer) are not in this public repo; `main.mjs` loads them automatically if the files are present on disk.
- MIT license — see [LICENSE](LICENSE).
