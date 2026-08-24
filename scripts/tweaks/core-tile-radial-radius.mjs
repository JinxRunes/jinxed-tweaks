/**
 * Tile Overhead — per-tile radial occlusion radius.
 *
 * Foundry sizes the transparent hole from TokenDocument#occludable.radius
 * (Token Config → Identity). Map makers expect that control on the Tile
 * Overhead tab for sails/awnings. This flag sets a minimum radius (grid units)
 * applied while a token is under a Radial tile.
 */

const MODULE_ID = "jinxed-tweaks";
const FLAG_RADIAL_RADIUS = "radialRadius";

/** @type {Map<string, number>|null} */
let radiusBoosts = null;

function log(message, level="log") {
  console[level](`jinxed-tweaks | core-tile-radial-radius | ${message}`);
}

/**
 * @param {string} target
 * @param {Function} wrapper
 * @param {"WRAPPER"|"MIXED"} [type]
 * @returns {boolean}
 */
function registerWrap(target, wrapper, type="WRAPPER") {
  if ( typeof libWrapper?.register === "function" && game.modules.get("lib-wrapper")?.active ) {
    try {
      libWrapper.register(MODULE_ID, target, wrapper, type);
      return true;
    }
    catch (error) {
      log(`libWrapper ${target}: ${error?.message || error}`, "warn");
    }
  }

  const parts = target.split(".");
  const methodName = parts.pop();
  let parent = globalThis;
  for ( const key of parts ) {
    parent = parent?.[key];
    if ( !parent ) {
      log(`Missing wrap target parent: ${target}`, "warn");
      return false;
    }
  }
  const original = parent[methodName];
  if ( typeof original !== "function" || original.__jinxTileRadialRadius ) return false;
  const patched = function(...args) {
    return wrapper.call(this, original.bind(this), ...args);
  };
  patched.__jinxTileRadialRadius = true;
  parent[methodName] = patched;
  return true;
}

/**
 * @returns {{mesh: PrimaryOccludableObject, radius: number}[]}
 */
function getRadialTilesWithRadius() {
  const tiles = canvas?.tiles?.placeables;
  if ( !tiles?.length ) return [];
  const M = CONST.OCCLUSION_MODES;
  const out = [];
  for ( const tile of tiles ) {
    const mesh = tile.mesh;
    if ( !mesh || !(mesh.occlusionMode & M.RADIAL) ) continue;
    const radius = Number(tile.document.getFlag(MODULE_ID, FLAG_RADIAL_RADIUS));
    if ( !(radius > 0) ) continue;
    out.push({mesh, radius});
  }
  return out;
}

/**
 * @param {Token} token
 * @param {{mesh: object, radius: number}[]} radialTiles
 * @returns {number|null}
 */
function boostForToken(token, radialTiles) {
  let max = 0;
  for ( const {mesh, radius} of radialTiles ) {
    try {
      if ( !mesh.testOcclusion?.(token) ) continue;
    }
    catch {
      continue;
    }
    max = Math.max(max, radius);
  }
  return max > 0 ? max : null;
}

/**
 * @returns {Map<string, number>|null}
 */
function buildRadiusBoosts() {
  const radialTiles = getRadialTilesWithRadius();
  if ( !radialTiles.length ) return null;
  const tokens = canvas.tokens?._getOccludableTokens?.() ?? [];
  if ( !tokens.length ) return null;
  /** @type {Map<string, number>} */
  const boosts = new Map();
  for ( const token of tokens ) {
    const boost = boostForToken(token, radialTiles);
    if ( boost == null ) continue;
    boosts.set(token.id, boost);
  }
  return boosts.size ? boosts : null;
}

/**
 * @param {Function} wrapped
 * @param {number} units
 * @returns {number}
 */
function wrapGetLightRadius(wrapped, units) {
  if ( radiusBoosts ) {
    const boost = radiusBoosts.get(this.id);
    if ( boost != null ) units = Math.max(Number(units) || 0, boost);
  }
  return wrapped(units);
}

/**
 * @param {Function} wrapped
 */
function wrapUpdateOcclusionMask(wrapped) {
  radiusBoosts = buildRadiusBoosts();
  try {
    return wrapped();
  }
  finally {
    radiusBoosts = null;
  }
}

/**
 * @param {foundry.applications.sheets.TileConfig} app
 * @param {HTMLElement} element
 */
function injectTileConfig(app, element) {
  if ( !game.user.isGM ) return;
  const root = element instanceof HTMLElement ? element : element?.[0];
  if ( !root || root.querySelector("[data-jinxed-tile-radial-radius]") ) return;

  const tile = app.document;
  const stored = tile.getFlag(MODULE_ID, FLAG_RADIAL_RADIUS);
  const value = typeof stored === "number" && stored > 0 ? stored : "";
  const units = canvas?.scene?.grid?.units || game.i18n.localize("GRID.Units") || "";

  const group = document.createElement("div");
  group.className = "form-group slim";
  group.dataset.jinxedTileRadialRadius = "1";
  group.innerHTML = `
    <label>${game.i18n.localize("JINXED_TWEAKS.TileRadialRadius.Label")}
      <span class="units">(${foundry.utils.escapeHTML(units)})</span>
    </label>
    <div class="form-fields">
      <input type="number" name="flags.${MODULE_ID}.${FLAG_RADIAL_RADIUS}"
        value="${value}" min="0" step="0.01"
        placeholder="${game.i18n.localize("JINXED_TWEAKS.TileRadialRadius.Placeholder")}">
    </div>
    <p class="hint">${game.i18n.localize("JINXED_TWEAKS.TileRadialRadius.Hint")}</p>
  `;

  const overhead = root.querySelector('.tab[data-tab="overhead"], [data-application-part="overhead"]');
  const alphaGroup = root.querySelector('input[name="occlusion.alpha"], range-picker[name="occlusion.alpha"]')
    ?.closest(".form-group");
  if ( alphaGroup ) alphaGroup.after(group);
  else if ( overhead ) {
    const modesGroup = overhead.querySelector('[name="occlusion.modes"]')?.closest(".form-group");
    if ( modesGroup ) modesGroup.after(group);
    else overhead.append(group);
  }
  else root.querySelector("section.standard-form, .standard-form, form")?.append(group);
}

/**
 * Normalize empty / non-positive values to an unset flag.
 * @param {TileDocument} _doc
 * @param {object} changes
 */
function onPreUpdateTile(_doc, changes) {
  const flags = changes.flags?.[MODULE_ID];
  if ( !flags || !(FLAG_RADIAL_RADIUS in flags) ) return;
  const raw = flags[FLAG_RADIAL_RADIUS];
  const num = raw === "" || raw == null ? NaN : Number(raw);
  if ( !(num > 0) ) {
    delete flags[FLAG_RADIAL_RADIUS];
    flags[`-=${FLAG_RADIAL_RADIUS}`] = null;
  }
  else flags[FLAG_RADIAL_RADIUS] = num;
}

/**
 * @param {TileDocument} _tile
 * @param {object} changes
 */
function onUpdateTile(_tile, changes) {
  if ( !canvas?.ready ) return;
  const touched = foundry.utils.getProperty(changes, `flags.${MODULE_ID}.${FLAG_RADIAL_RADIUS}`) !== undefined
    || foundry.utils.getProperty(changes, `flags.${MODULE_ID}`)?.[FLAG_RADIAL_RADIUS] !== undefined
    || foundry.utils.getProperty(changes, `flags.${MODULE_ID}`)?.[`-=${FLAG_RADIAL_RADIUS}`] !== undefined
    || foundry.utils.hasProperty(changes, "occlusion");
  if ( !touched ) return;
  canvas.perception?.update?.({refreshOcclusion: true});
}

/**
 * Enable per-tile radial occlusion radius on overhead tiles.
 */
export function applyCoreTileRadialRadiusTweaks() {
  // CanvasOcclusionMask lives on foundry.canvas.layers (masks/ is only a folder).
  const wrappedMask = registerWrap(
    "foundry.canvas.layers.CanvasOcclusionMask.prototype._updateOcclusionMask",
    wrapUpdateOcclusionMask
  );
  const wrappedRadius = registerWrap(
    "foundry.canvas.placeables.Token.prototype.getLightRadius",
    wrapGetLightRadius
  );
  if ( !wrappedMask || !wrappedRadius ) {
    log("Failed to wrap occlusion radius hooks", "warn");
  }

  Hooks.on("renderTileConfig", (app, element) => injectTileConfig(app, element));
  Hooks.on("preUpdateTile", onPreUpdateTile);
  Hooks.on("updateTile", onUpdateTile);
  log("Enabled");
}
