/**
 * Spotlight Omnisearch tweaks:
 * 1) Persist Click to Dismiss on the User document (not brittle localStorage).
 * 2) Never auto-open the search bar on world load / refresh — only via keybind.
 */

const TARGET_MODULE_ID = "spotlight-omnisearch";
const CLICK_TO_DISMISS = "clickToDismiss";
const FIRST_TIME = "firstTime";

function log(message, level="log") {
  console[level](`jinxed-tweaks | spotlight-omnisearch | ${message}`);
}

/**
 * Force the first-run welcome open off before canvasReady can schedule it.
 */
export async function applySpotlightNoAutoOpenSetup() {
  try {
    if ( game.settings.settings.get(`${TARGET_MODULE_ID}.${FIRST_TIME}`) ) {
      await game.settings.set(TARGET_MODULE_ID, FIRST_TIME, false);
      log("Disabled firstTime auto-open (setup)");
    }
  }
  catch (error) {
    log(`Could not clear firstTime at setup: ${error?.message || error}`, "warn");
  }
}

/**
 * Close any Spotlight instance that was opened automatically.
 */
function closeSpotlightIfOpen() {
  const open = ui.spotlightOmnisearch
    ?? [...(foundry.applications.instances?.values?.() ?? [])].find(app => {
      return app?.id === "spotlight" || app?.constructor?.name === "Spotlight";
    });
  if ( open?.rendered || open?.element ) {
    open.close?.();
    log("Closed auto-opened Spotlight instance");
  }
}

/**
 * Migrate a setting from client localStorage to user-scoped world storage.
 * @param {string} key
 * @param {any} [forceValue]  If provided, store this instead of the prior client value.
 */
async function migrateSettingToUserScope(key, forceValue) {
  const settingId = `${TARGET_MODULE_ID}.${key}`;
  const cfg = game.settings.settings.get(settingId);
  if ( !cfg ) {
    log(`${key} setting not registered`, "warn");
    return;
  }

  let value = forceValue;
  if ( value === undefined ) {
    try {
      value = game.settings.get(TARGET_MODULE_ID, key);
    }
    catch (error) {
      log(`Could not read ${key}: ${error?.message || error}`, "warn");
      value = cfg.default;
    }
  }

  if ( cfg.scope !== "user" ) cfg.scope = "user";

  try {
    await game.settings.set(TARGET_MODULE_ID, key, value);
    log(`Persisted ${key} as user-scoped (value=${JSON.stringify(value)})`);
  }
  catch (error) {
    log(`Failed to persist ${key}: ${error?.message || error}`, "error");
    console.error(error);
  }
}

/**
 * Ready-phase Spotlight fixes.
 */
export async function applySpotlightOmnisearchTweaks() {
  // Keep Click to Dismiss sticky on the user document.
  await migrateSettingToUserScope(CLICK_TO_DISMISS);

  // Never show the first-run Spotlight popup again.
  await migrateSettingToUserScope(FIRST_TIME, false);

  // Safety: if the 1s canvasReady timer already opened it, close it.
  closeSpotlightIfOpen();
  setTimeout(closeSpotlightIfOpen, 1200);

  // Belt-and-suspenders: if something renders Spotlight with the first-run flag, close it.
  Hooks.on("renderApplicationV2", app => {
    if ( app?.id !== "spotlight" && app?.constructor?.name !== "Spotlight" ) return;
    if ( !app.options?.first && !app.first ) return;
    queueMicrotask(() => app.close?.());
  });

  log("Auto-open suppressed; keybind-only activation");
}
