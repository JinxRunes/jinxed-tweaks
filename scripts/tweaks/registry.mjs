/**
 * Jinxed Tweaks registry.
 *
 * Each entry targets one Foundry module id. The tweak only runs when that
 * module is installed and active. Add new overwrite files under ./ and
 * register them here.
 *
 * @typedef {object} JinxTweak
 * @property {string} id                 Target module id (e.g. "midi-qol")
 * @property {string} [label]            Human-readable name for logs
 * @property {"init"|"setup"|"ready"} [when=ready]
 *   Lifecycle phase to apply the tweak. Prefer "ready" so other modules finish
 *   initializing first. Use "setup" only when an earlier overwrite is required.
 * @property {boolean} [immediate]
 *   If true with when:"init", run synchronously inside Hooks.once("init")
 *   (required for document subtype dataModels). Default tweaks are deferred.
 * @property {() => void|Promise<void>} apply
 */

import {applyEpicRolls5eTweaks} from "./epic-rolls-5e.mjs";
import {applyBossbarTweaks} from "./bossbar.mjs";
import {applyCoreKeybindingTweaks} from "./core-keybindings.mjs";
import {applyCoreSidebarTweaks} from "./core-sidebar.mjs";
import {applySidebarFolderStateTweaks} from "./core-sidebar-folder-state.mjs";
import {applyCoreHotbarTweaks} from "./core-hotbar.mjs";
import {applyCoreCanvasTweaks} from "./core-canvas.mjs";
import {applyCoreLeftClickReleaseTweaks} from "./core-left-click-release.mjs";
import {applyCoreHudTweaks} from "./core-hud.mjs";
import {applyCoreToolclipTweaks} from "./core-toolclips.mjs";
import {applyCoreCompatNoiseTweaks} from "./core-compat-noise.mjs";
import {applyCoreNameplateTweaks} from "./core-nameplates.mjs";
import {applyCoreOffLevelChromeTweaks} from "./core-offlevel-chrome.mjs";
import {applyCoreLoadThrottleTweaks} from "./core-load-throttle.mjs";
import {applyCoreLoadTraceTweaks} from "./core-load-trace.mjs";
import {applyCoreTokenFilterTweaks} from "./core-token-filters.mjs";
import {applyCoreLogoutTweaks} from "./core-logout.mjs";
import {applyLevelNightMapTweaks} from "./core-level-night-maps.mjs";
import {applyCoreTileRadialRadiusTweaks} from "./core-tile-radial-radius.mjs";
import {applyDaeTweaks, applyDaeInitTweaks} from "./dae.mjs";
import {applyTidbitsTweaks} from "./tidbits.mjs";
import {applySimpleTimekeepingTweaks} from "./simple-timekeeping.mjs";
import {applySpotlightOmnisearchTweaks, applySpotlightNoAutoOpenSetup} from "./spotlight-omnisearch.mjs";
import {applyConvenientEffectsTweaks} from "./convenient-effects.mjs";
import {applySimrakiRadialEffectsTweaks} from "./simraki-radial-effects.mjs";
import {applyVision5eTweaks} from "./vision-5e.mjs";
import {applyEnhancedCombatHudTweaks} from "./enhancedcombathud.mjs";
import {applyDdbImporterTweaks} from "./ddb-importer.mjs";
import {applyTokenNotesTweaks} from "./token-notes.mjs";
import {applyDmMapNotesTweaks} from "./dm-map-notes.mjs";
import {applyTemporaryElevationBehavior} from "./region-temporary-elevation.mjs";
import {applyTokenHideNameTweaks} from "./token-hide-name.mjs";
import {applyTokenMirrorHorizontalTweaks} from "./token-mirror-horizontal.mjs";
import {applyTokenHideHoverBorderTweaks} from "./token-hide-hover-border.mjs";
import {applyTokenDisplayBarsTweaks} from "./token-display-bars.mjs";
import {applyPcOcclusionRadiusTweaks} from "./core-pc-occlusion-radius.mjs";
import {applyCampaignCodexTweaks} from "./campaign-codex.mjs";

/** @type {JinxTweak[]} */
export const TWEAKS = [
  {
    id: "core",
    label: "Temporary Elevation Region Behavior",
    when: "init",
    immediate: true,
    apply: () => applyTemporaryElevationBehavior()
  },
  {
    id: "core",
    label: "Token Hide Name",
    when: "ready",
    apply: () => applyTokenHideNameTweaks()
  },
  {
    id: "core",
    label: "Token Mirror Horizontal",
    when: "ready",
    apply: () => applyTokenMirrorHorizontalTweaks()
  },
  {
    id: "core",
    label: "Token Hide Hover Border",
    when: "ready",
    apply: () => applyTokenHideHoverBorderTweaks()
  },
  {
    id: "core",
    label: "Token Display Bars None",
    when: "ready",
    apply: () => applyTokenDisplayBarsTweaks()
  },
  {
    id: "core",
    label: "PC Occlusion Radius",
    when: "ready",
    apply: () => applyPcOcclusionRadiusTweaks()
  },
  {
    id: "core",
    label: "Core Keybindings",
    when: "ready",
    apply: () => applyCoreKeybindingTweaks()
  },
  {
    id: "core",
    label: "Core Logout",
    when: "ready",
    apply: () => applyCoreLogoutTweaks()
  },
  {
    id: "core",
    label: "Core Sidebar",
    when: "ready",
    apply: () => applyCoreSidebarTweaks()
  },
  {
    id: "core",
    label: "Sidebar Folder State",
    when: "setup",
    apply: () => applySidebarFolderStateTweaks()
  },
  {
    id: "core",
    label: "Core Hotbar",
    when: "ready",
    apply: () => applyCoreHotbarTweaks()
  },
  {
    id: "core",
    label: "Core Canvas",
    when: "init",
    apply: () => applyCoreCanvasTweaks()
  },
  {
    id: "core",
    label: "Core Left-Click Release",
    when: "ready",
    apply: () => applyCoreLeftClickReleaseTweaks()
  },
  {
    id: "core",
    label: "Core HUD",
    when: "ready",
    apply: () => applyCoreHudTweaks()
  },
  {
    id: "core",
    label: "Core Toolclips",
    when: "ready",
    apply: () => applyCoreToolclipTweaks()
  },
  {
    id: "core",
    label: "Core Compat Noise",
    when: "init",
    apply: () => applyCoreCompatNoiseTweaks()
  },
  {
    id: "core",
    label: "Core Load Throttle",
    when: "init",
    apply: () => applyCoreLoadThrottleTweaks()
  },
  {
    id: "core",
    label: "Core Load Trace",
    when: "init",
    apply: () => applyCoreLoadTraceTweaks()
  },
  {
    // After Vision 5e Token subclass is installed (vision-5e init). Init so the
    // guard exists before CE/DAE prepare during ready.
    id: "core",
    label: "Core Token Filters",
    when: "init",
    apply: () => applyCoreTokenFilterTweaks()
  },
  {
    id: "core",
    label: "Core Nameplates",
    when: "ready",
    apply: () => applyCoreNameplateTweaks()
  },
  {
    id: "core",
    label: "DM Map Notes",
    when: "init",
    apply: () => applyDmMapNotesTweaks()
  },
  {
    id: "dae",
    label: "DAE Effect Scrub (init)",
    when: "init",
    apply: () => applyDaeInitTweaks()
  },
  {
    id: "dae",
    label: "DAE Effect Cleanup",
    when: "ready",
    apply: () => applyDaeTweaks()
  },
  {
    id: "spotlight-omnisearch",
    label: "Spotlight No Auto-Open",
    when: "setup",
    apply: () => applySpotlightNoAutoOpenSetup()
  },
  {
    id: "tidbits",
    label: "Tidbits",
    when: "ready",
    apply: () => applyTidbitsTweaks()
  },
  {
    id: "simple-timekeeping",
    label: "Simple Timekeeping Darkness Sync",
    when: "ready",
    apply: () => applySimpleTimekeepingTweaks()
  },
  {
    id: "spotlight-omnisearch",
    label: "Spotlight Omnisearch",
    when: "ready",
    apply: () => applySpotlightOmnisearchTweaks()
  },
  {
    id: "dfreds-convenient-effects",
    label: "Convenient Effects Bridge",
    when: "ready",
    apply: () => applyConvenientEffectsTweaks()
  },
  {
    id: "simraki-radial-effects",
    label: "Simraki Radial Effects",
    when: "ready",
    apply: () => applySimrakiRadialEffectsTweaks()
  },
  {
    id: "vision-5e",
    label: "Vision 5e",
    when: "ready",
    apply: () => applyVision5eTweaks()
  },
  {
    // After vision-5e so hub + refresh wrappers win over sense-blocked renderable resets.
    id: "core",
    label: "Core Off-Level Chrome",
    when: "ready",
    apply: () => applyCoreOffLevelChromeTweaks()
  },
  {
    id: "core",
    label: "Level Night Maps",
    when: "ready",
    apply: () => applyLevelNightMapTweaks()
  },
  {
    id: "core",
    label: "Tile Radial Occlusion Radius",
    when: "ready",
    apply: () => applyCoreTileRadialRadiusTweaks()
  },
  {
    id: "enhancedcombathud",
    label: "Argon Combat HUD",
    when: "ready",
    apply: () => applyEnhancedCombatHudTweaks()
  },
  {
    id: "epic-rolls-5e",
    label: "Epic Rolls 5e",
    when: "ready",
    apply: () => applyEpicRolls5eTweaks()
  },
  {
    id: "bossbar",
    label: "Bossbar",
    when: "ready",
    apply: () => applyBossbarTweaks()
  },
  {
    id: "ddb-importer",
    label: "DDB Importer",
    when: "ready",
    apply: () => applyDdbImporterTweaks()
  },
  {
    id: "token-notes",
    label: "Token Notes Actor Persist",
    when: "ready",
    apply: () => applyTokenNotesTweaks()
  },
  {
    id: "campaign-codex",
    label: "Campaign Codex UI",
    when: "ready",
    apply: () => applyCampaignCodexTweaks()
  }
];
