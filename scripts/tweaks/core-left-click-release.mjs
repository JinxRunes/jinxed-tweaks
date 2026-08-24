/**
 * Core setting — keep "Left-Click to Release Objects" enabled.
 *
 * Foundry registers `core.leftClickRelease` with initial: false, so new
 * clients and cleared client storage land with it off. Something in our
 * setup also tends to leave it disabled. Force it on at ready and if it
 * flips off later.
 */

const SCOPE = "core";
const KEY = "leftClickRelease";

function log(message, level = "log") {
  console[level](`jinxed-tweaks | core-left-click-release | ${message}`);
}

/**
 * @returns {boolean}
 */
function isEnabled() {
  try {
    return game.settings.get(SCOPE, KEY) === true;
  }
  catch {
    return false;
  }
}

/**
 * @param {string} reason
 */
async function forceEnabled(reason) {
  if ( isEnabled() ) return;
  try {
    await game.settings.set(SCOPE, KEY, true);
    log(`Enabled (${reason})`);
  }
  catch (error) {
    log(`Failed to enable (${reason}): ${error?.message || error}`, "warn");
  }
}

/**
 * Force Left-Click to Release Objects on, and keep it on.
 */
export function applyCoreLeftClickReleaseTweaks() {
  void forceEnabled("ready");

  Hooks.on("clientSettingChanged", (key, value) => {
    if ( key !== `${SCOPE}.${KEY}` ) return;
    if ( value === true ) return;
    // Defer so we don't fight the same settings write mid-flight.
    setTimeout(() => {
      void forceEnabled("clientSettingChanged");
    }, 0);
  });

  // Some packages write client settings without firing clientSettingChanged.
  Hooks.on("closeSettingsConfig", () => {
    void forceEnabled("closeSettingsConfig");
  });
}
