/**
 * Core canvas — replace Foundry's default light-grey void (#999999) with dark gray.
 *
 * Scene background colors that are still the stock light grey (or unset) are
 * remapped via configureCanvasEnvironment. Custom scene colors are left alone.
 */

const LIGHT_GREY = 0x999999;
/** Dark gray replacement for the stock Foundry canvas void. */
const DARK_GREY = 0x2a2a2a;

function log(message, level="log") {
  console[level](`jinxed-tweaks | core-canvas | ${message}`);
}

/**
 * @param {unknown} value
 * @returns {boolean}
 */
function isStockLightGrey(value) {
  if ( value == null || value === "" ) return true;
  try {
    const color = Color.from(value);
    if ( !color?.valid ) return true;
    return Number(color) === LIGHT_GREY;
  } catch {
    return true;
  }
}

/**
 * Remap stock light-grey (or missing) background to dark gray.
 * @param {object} config
 */
function onConfigureCanvasEnvironment(config) {
  const raw = config.backgroundColor ?? canvas.level?.background?.color;
  if ( !isStockLightGrey(raw) ) return;
  config.backgroundColor = DARK_GREY;
}

/**
 * Apply dark-gray canvas void for Foundry's default light grey background.
 */
export function applyCoreCanvasTweaks() {
  Hooks.on("configureCanvasEnvironment", onConfigureCanvasEnvironment);

  // Canvas may already be live if this runs late — refresh colors now.
  if ( canvas?.ready && canvas.environment?.initialize ) {
    try {
      canvas.environment.initialize();
    } catch (error) {
      log(`Immediate re-init failed: ${error?.message || error}`, "warn");
    }
  }

  log(`Canvas void ${LIGHT_GREY.toString(16)} → ${DARK_GREY.toString(16)}`);
}
