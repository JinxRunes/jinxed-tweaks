import {TWEAKS} from "./tweaks/registry.mjs";
import {installAllNoiseFilters} from "./tweaks/core-compat-noise.mjs";
import {registerDaeSettings} from "./tweaks/dae.mjs";
import {registerLoadThrottleSettings} from "./tweaks/core-load-throttle.mjs";
import {registerLoadTraceSettings} from "./tweaks/core-load-trace.mjs";
import {registerTokenNotesSettings} from "./tweaks/token-notes.mjs";
import {registerLevelNightMapSettings} from "./tweaks/core-level-night-maps.mjs";
import {registerSidebarFolderStateSettings} from "./tweaks/core-sidebar-folder-state.mjs";
import {registerOpenAiSettings} from "./tweaks/openai.mjs";
import {registerCodexAutoLinkSettings} from "./tweaks/campaign-codex-auto-link.mjs";
import {registerCodexHubFolderSettings} from "./tweaks/campaign-codex-hub-folders.mjs";

const MODULE_ID = "jinxed-tweaks";

// Before init hooks / canvas fog extract: drop known non-breaking console spam.
installAllNoiseFilters();
// Optional private deploy overlay (not in public repo): assets.jinx.gg CDN rewrite.
import("./tweaks/core-cdn.mjs")
  .then(({installCoreCdn}) => installCoreCdn())
  .catch(() => {});

/**
 * @param {string} moduleId
 * @returns {boolean}
 */
export function isModuleActive(moduleId) {
  return game.modules.get(moduleId)?.active === true;
}

/**
 * @param {string} message
 * @param {"log"|"warn"|"error"} [level]
 */
function log(message, level="log") {
  console[level](`${MODULE_ID} | ${message}`);
}

/**
 * Defer until after other listeners for the same hook have finished.
 * Foundry V14 hooks have no priority/order option, so this plus late module
 * load (optional relationships) keeps overwrites last.
 * @param {() => void|Promise<void>} fn
 */
function afterOtherHooks(fn) {
  setTimeout(() => {
    Promise.resolve()
      .then(fn)
      .catch(error => log(`Deferred tweak runner failed: ${error?.message || error}`, "error"));
  }, 0);
}

/**
 * @param {import("./tweaks/registry.mjs").JinxTweak} tweak
 * @returns {Promise<boolean>}
 */
async function applyTweak(tweak) {
  const label = tweak.label || tweak.id;
  // "core" targets Foundry itself and is always available.
  if ( tweak.id !== "core" && !isModuleActive(tweak.id) ) {
    log(`Skipped ${label} (inactive or missing)`);
    return false;
  }
  try {
    await tweak.apply();
    log(`Applied ${label}`);
    return true;
  }
  catch(error) {
    log(`Failed ${label}: ${error?.message || error}`, "error");
    console.error(error);
    return false;
  }
}

/**
 * @param {"init"|"setup"|"ready"} phase
 */
async function runPhase(phase) {
  const pending = TWEAKS.filter(tweak => {
    if ( (tweak.when || "ready") !== phase ) return false;
    // Document subtypes already registered synchronously in init.
    if ( tweak.immediate ) return false;
    return true;
  });
  if ( !pending.length ) return;
  log(`Running ${pending.length} ${phase} tweak(s)`);
  for ( const tweak of pending ) await applyTweak(tweak);
}

Hooks.once("init", () => {
  log("Overwrite layer registered");
  registerDaeSettings();
  registerLoadThrottleSettings();
  registerLoadTraceSettings();
  registerTokenNotesSettings();
  registerLevelNightMapSettings();
  registerSidebarFolderStateSettings();
  registerOpenAiSettings();
  registerCodexAutoLinkSettings();
  registerCodexHubFolderSettings();
  // RegionBehavior dataModels must register during init, not setTimeout-deferred.
  for ( const tweak of TWEAKS.filter(t => t.immediate && (t.when || "ready") === "init") ) {
    void applyTweak(tweak);
  }
  afterOtherHooks(() => runPhase("init"));
});

Hooks.once("setup", () => afterOtherHooks(() => runPhase("setup")));
Hooks.once("ready", () => afterOtherHooks(() => runPhase("ready")));
