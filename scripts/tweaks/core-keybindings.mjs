/**
 * Core keybindings — remove default Q/E token elevation (descend/ascend).
 *
 * Only touches clients still on Foundry's registered defaults. If the user has
 * any saved binding for Ascend/Descend (Configure Controls), leave it alone.
 */

const ACTIONS = [
  {action: "descend", key: "KeyQ"},
  {action: "ascend", key: "KeyE"}
];

function log(message, level="log") {
  console[level](`jinxed-tweaks | core-keybindings | ${message}`);
}

/**
 * True when this client has an explicit saved override for the action
 * (including an intentional empty binding list).
 * @param {string} action
 * @returns {boolean}
 */
function hasUserOverride(action) {
  const mapping = game.settings.get("core", "keybindings") || {};
  return Object.prototype.hasOwnProperty.call(mapping, `core.${action}`);
}

/**
 * Clear default Q/E elevation binds. Skip actions the user has customized.
 */
export async function applyCoreKeybindingTweaks() {
  const cleared = [];
  const skipped = [];

  for ( const {action, key} of ACTIONS ) {
    if ( hasUserOverride(action) ) {
      skipped.push(action);
      continue;
    }
    // No saved override → still on Foundry defaults (Q/E). Persist empty binds.
    await game.keybindings.set("core", action, []);
    cleared.push(`${action} (${key})`);
  }

  if ( cleared.length ) log(`Cleared default elevation keybinds: ${cleared.join(", ")}`);
  if ( skipped.length ) log(`Left user elevation keybinds alone: ${skipped.join(", ")}`);
  if ( !cleared.length && !skipped.length ) log("Elevation keybinds already handled");
}
