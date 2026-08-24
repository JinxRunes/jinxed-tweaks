# Jinxed Tweaks

Foundry VTT module that loads late and patches other modules only when they are installed and active in the world. No hard dependencies — if a target module is off, its tweak is skipped.

Built for Foundry **v14** (verified against 14.366).

## Install

Drop the folder into `Data/modules/` as `jinxed-tweaks`, or install from a release ZIP with `module.json` at the root. Enable it in Module Settings. Keep it near the end of the load order (soft optional dependencies in the manifest help with that).

## What it does

- **Compatibility layer** — small fixes and overrides for modules like Campaign Codex, Midi-QOL, DAE, Argon Combat HUD, DDB Importer, and others, gated on `game.modules.get(id)?.active`.
- **Core tweaks** — nameplate placement, token HUD options, sidebar behavior, load tracing, and similar quality-of-life patches under `scripts/tweaks/core-*.mjs`.
- **Campaign Codex** — Fandom wiki import, hub folders, Organizations sheet type, sidebar delete, auto-linking, and related UI fixes (requires Campaign Codex active).
- **Hot reload** — CSS, JS, and language files reload in dev without restarting Foundry.

Each tweak logs `jinxed-tweaks | Applied …` or `Skipped …` in the console on world load.

## Layout

```text
jinxed-tweaks/
├── module.json
├── languages/en.json
├── styles/tweaks.css
├── templates/          # Handlebars overrides where needed
└── scripts/
    ├── main.mjs        # Loader and lifecycle
    └── tweaks/         # One file (or small group) per target module
        └── registry.mjs
```

## Notes

- Module id: `jinxed-tweaks`
- The public repo omits the optional `scripts/tweaks/core-cdn.mjs` overlay used on the jinx.gg Foundry host (CDN media rewrite). `main.mjs` loads it when present; VPS deploys keep that file locally.
- Tweaks run on `init`, `setup`, or `ready` (mostly `ready`), deferred one tick so other modules register first.
- This module is tailored to a specific Foundry setup; optional relationships in `module.json` reflect modules commonly present on that server.

## License

MIT — see [LICENSE](LICENSE).
