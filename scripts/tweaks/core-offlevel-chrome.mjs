/**
 * Core off-level / below-floor token chrome (per local user)
 *
 * Client-local only: uses this client's canvas.level. Mutates PIXI chrome +
 * eventMode — never Token documents / other users' views.
 *
 * Hot path (isInteractable / hover): same-Level tokens return immediately;
 * coverage is cached per (token, viewLevel, x, y, elev, level). Background
 * alpha is sampled at the token center only (not every occlusion point).
 */

import {
  afterTokenRefreshState,
  ensureTokenRefreshStateHub
} from "./token-refresh-state-hub.mjs";

const MODULE_ID = "jinxed-tweaks";

/**
 * @typedef {object} CoverageState
 * @property {string} viewLevelId
 * @property {number} x
 * @property {number} y
 * @property {number} elev
 * @property {string|null|undefined} level
 * @property {boolean} below
 * @property {boolean} underFloor
 * @property {boolean} culled
 */

/** @type {Map<string, CoverageState>} */
const coverageCache = new Map();

/** @type {string|null} */
let cacheViewLevelId = null;

function log(message, level="log") {
  console[level](`jinxed-tweaks | core-offlevel-chrome | ${message}`);
}

/**
 * @returns {Level|null}
 */
function localViewedLevel() {
  return canvas?.level ?? null;
}

/**
 * @returns {string|null}
 */
function localViewedLevelId() {
  return localViewedLevel()?.id ?? game.user?.viewedLevel ?? null;
}

function invalidateCoverageCache() {
  coverageCache.clear();
  cacheViewLevelId = localViewedLevelId();
}

/**
 * @param {string|null|undefined} tokenId
 */
function invalidateTokenCoverage(tokenId) {
  if ( tokenId ) coverageCache.delete(tokenId);
}

/**
 * Document elevation is enough for floor-cull (avoid getMovementOrigin on hot path).
 * @param {Token} token
 * @returns {number}
 */
function tokenElevation(token) {
  return Number(token.document?.elevation ?? 0);
}

/**
 * @param {Token} token
 * @param {Level} level
 * @returns {boolean}
 */
function computeIsBelowViewedLevel(token, level) {
  const doc = token?.document;
  if ( !doc ) return false;

  if ( typeof doc.locatedInLevel === "function" ) {
    if ( doc.locatedInLevel(level) ) return false;
  }
  else if ( doc.level === level.id ) {
    return false;
  }

  return tokenElevation(token) < Number(level.elevation?.bottom ?? 0);
}

/**
 * Single center sample — enough for chrome/interaction; much cheaper than
 * getOcclusionTestPoints × texture alpha.
 * @param {Token} token
 * @returns {{x: number; y: number}}
 */
function coveragePoint(token) {
  return token.center ?? {x: token.x ?? 0, y: token.y ?? 0};
}

/**
 * @returns {PIXI.DisplayObject|null}
 */
function viewedBackgroundMesh() {
  const mesh = canvas?.primary?.background;
  if ( mesh && typeof mesh.containsCanvasPoint === "function" && mesh.visible !== false ) {
    return mesh;
  }
  return null;
}

/**
 * @param {Token} token
 * @returns {boolean|null}
 */
function computeUnderOpaqueBackground(token) {
  const bg = viewedBackgroundMesh();
  if ( !bg ) return null;
  try {
    return bg.containsCanvasPoint(coveragePoint(token));
  }
  catch {
    return null;
  }
}

/**
 * @param {Token} token
 * @param {Level} level
 * @returns {boolean}
 */
function computeCoveredByFloorSurface(token, level) {
  const scene = canvas?.scene;
  if ( typeof scene?.getSurfaces !== "function" ) return false;

  const elev = tokenElevation(token);
  const point = coveragePoint(token);
  for ( const surface of scene.getSurfaces({level: level.id}) ) {
    if ( !surface.culling && !surface.occlusion ) continue;
    if ( !(Number(surface.elevation) > elev) ) continue;
    if ( surface.region?.polygonTree?.testPoint?.(point) ) return true;
  }
  return false;
}

/**
 * @param {Token} token
 * @param {Level} level
 * @returns {boolean}
 */
function computeUnderSolidFloor(token, level) {
  const bg = computeUnderOpaqueBackground(token);
  if ( bg !== null ) return bg;
  return computeCoveredByFloorSurface(token, level);
}

/**
 * @param {Token} token
 * @returns {CoverageState}
 */
function getCoverageState(token) {
  const viewLevel = localViewedLevel();
  const viewLevelId = viewLevel?.id ?? null;
  if ( viewLevelId !== cacheViewLevelId ) invalidateCoverageCache();

  const doc = token?.document;
  const empty = {
    viewLevelId: viewLevelId ?? "",
    x: 0,
    y: 0,
    elev: 0,
    level: null,
    below: false,
    underFloor: false,
    culled: false
  };
  if ( !viewLevel || !doc?.id ) return empty;

  // Majority of tokens when you're on their floor — no alpha sample.
  if ( doc.level === viewLevelId ) {
    return empty;
  }

  const x = Number(doc.x ?? 0);
  const y = Number(doc.y ?? 0);
  const elev = tokenElevation(token);
  const level = doc.level;
  const prev = coverageCache.get(doc.id);
  if ( prev
    && prev.viewLevelId === viewLevelId
    && prev.x === x
    && prev.y === y
    && prev.elev === elev
    && prev.level === level ) {
    return prev;
  }

  const below = computeIsBelowViewedLevel(token, viewLevel);
  const underFloor = below ? computeUnderSolidFloor(token, viewLevel) : false;
  /** @type {CoverageState} */
  const state = {
    viewLevelId,
    x,
    y,
    elev,
    level,
    below,
    underFloor,
    culled: below && underFloor
  };
  coverageCache.set(doc.id, state);
  return state;
}

/**
 * O(1) latch set by {@link applyOffLevelChrome}. Do not re-sample alpha here —
 * isInteractable runs inside every Token#_refreshState.
 * @param {Token} token
 * @returns {boolean}
 */
function isFloorCulled(token) {
  return token?._jinxFloorCulled === true;
}

/**
 * @param {Token} token
 * @returns {boolean}
 */
function isNameAllowed(token) {
  if ( !token?.document || token.document.isSecret ) return false;
  if ( typeof token._canViewMode === "function" ) {
    return token._canViewMode(token.document.displayName);
  }
  return false;
}

/**
 * @param {PIXI.DisplayObject|null|undefined} obj
 * @param {boolean} show
 */
function setChromeVisible(obj, show) {
  if ( !obj ) return;
  obj.visible = show;
  if ( "renderable" in obj ) obj.renderable = show;
  if ( show ) delete obj._jinxOffLevelHidden;
  else obj._jinxOffLevelHidden = true;
}

/**
 * @param {Token} token
 */
function clearFloorCulledInteraction(token) {
  try {
    if ( token.controlled ) token.release();
  }
  catch { /* ignore */ }
  try {
    if ( token.targeted?.has?.(game.user) ) token.setTarget(false, {releaseOthers: false});
  }
  catch { /* ignore */ }
  if ( token.border ) token.border.visible = false;
  token.eventMode = "none";
}

/**
 * @param {Token} token
 * @param {CoverageState} state
 * @returns {string}
 */
function stateSignature(state) {
  return `${state.viewLevelId}:${state.below ? 1 : 0}:${state.culled ? 1 : 0}`;
}

/**
 * @param {Token} token
 */
export function applyOffLevelChrome(token) {
  if ( !token || token.destroyed ) return;

  // Hot path: token on this client's viewed Level and not latched as culled —
  // skip entirely (WASD / drag refreshState hits this every step).
  const viewId = localViewedLevelId();
  if ( token.document?.level === viewId && !token._jinxFloorCulled ) return;

  const state = getCoverageState(token);
  const sig = stateSignature(state);
  if ( token._jinxOffLevelSig === sig ) {
    if ( state.culled ) {
      token.eventMode = "none";
      if ( token.border ) token.border.visible = false;
    }
    return;
  }
  token._jinxOffLevelSig = sig;

  if ( !state.below ) {
    for ( const obj of [token.nameplate, token.tooltip, token.levelIndicator] ) {
      if ( obj?._jinxOffLevelHidden ) {
        obj.renderable = true;
        delete obj._jinxOffLevelHidden;
      }
    }
    if ( token._jinxFloorCulled ) {
      delete token._jinxFloorCulled;
      token.renderFlags?.set({refreshState: true});
    }
    return;
  }

  if ( state.culled ) {
    setChromeVisible(token.nameplate, false);
    setChromeVisible(token.tooltip, false);
    setChromeVisible(token.levelIndicator, false);
    if ( token.tooltip ) token.tooltip.text = "";
    const newlyCulled = token._jinxFloorCulled !== true;
    token._jinxFloorCulled = true;
    if ( newlyCulled ) clearFloorCulledInteraction(token);
    else {
      token.eventMode = "none";
      if ( token.border ) token.border.visible = false;
    }
    return;
  }

  if ( token._jinxFloorCulled ) {
    delete token._jinxFloorCulled;
    token.renderFlags?.set({refreshState: true});
  }

  setChromeVisible(token.nameplate, isNameAllowed(token));
  setChromeVisible(token.tooltip, false);
  setChromeVisible(token.levelIndicator, false);
  if ( token.tooltip ) token.tooltip.text = "";
}

/**
 * @param {string} target
 * @param {Function} wrapper
 * @param {"WRAPPER"|"OVERRIDE"} [type]
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
  const parent = parts.reduce((obj, key) => obj?.[key], globalThis);
  if ( !parent ) return false;

  const desc = Object.getOwnPropertyDescriptor(parent, methodName);
  if ( desc?.get && !desc.get.__jinxOffLevelChrome ) {
    const originalGet = desc.get;
    const patchedGet = function() {
      return wrapper.call(this, originalGet.bind(this));
    };
    patchedGet.__jinxOffLevelChrome = true;
    Object.defineProperty(parent, methodName, {
      configurable: true,
      enumerable: desc.enumerable,
      get: patchedGet
    });
    return true;
  }

  const original = parent?.[methodName];
  if ( typeof original !== "function" || original.__jinxOffLevelChrome ) return false;
  const patched = function(...args) {
    return wrapper.call(this, original.bind(this), ...args);
  };
  patched.__jinxOffLevelChrome = true;
  parent[methodName] = patched;
  return true;
}

/**
 * @param {string} method
 * @param {Function} wrapper
 */
function registerTokenWrap(method, wrapper) {
  const primary = `CONFIG.Token.objectClass.prototype.${method}`;
  if ( !registerWrap(primary, wrapper) ) {
    registerWrap(`foundry.canvas.placeables.Token.prototype.${method}`, wrapper);
  }
}

/**
 * WRAPPER must always chain `wrapped()`.
 * @param {Function} wrapped
 * @returns {boolean}
 */
function isInteractableWrapper(wrapped) {
  return wrapped() && !isFloorCulled(this);
}

/**
 * @param {Function} wrapped
 * @param {...any} args
 * @returns {boolean}
 */
function denyWhenFloorCulled(wrapped, ...args) {
  const allowed = wrapped(...args);
  return allowed && !isFloorCulled(this);
}

/**
 * @param {Function} wrapped
 * @param {boolean} [targeted]
 * @param {object} [options]
 */
function setTargetWrapper(wrapped, targeted=true, options={}) {
  if ( targeted && isFloorCulled(this) ) targeted = false;
  return wrapped(targeted, options);
}

/**
 * Spread work across frames so canvasReady does not spike one long task.
 * @param {Token[]} tokens
 * @param {number} [chunk]
 */
function applyOffLevelChromeChunked(tokens, chunk=25) {
  let i = 0;
  const step = () => {
    const end = Math.min(i + chunk, tokens.length);
    for ( ; i < end; i++ ) applyOffLevelChrome(tokens[i]);
    if ( i < tokens.length ) requestAnimationFrame(step);
  };
  if ( tokens.length ) requestAnimationFrame(step);
}

function refreshAllTokenChrome() {
  invalidateCoverageCache();
  for ( const token of canvas.tokens?.placeables ?? [] ) {
    delete token._jinxOffLevelSig;
  }
  applyOffLevelChromeChunked([...(canvas.tokens?.placeables ?? [])]);
}

/**
 * True when this update can change floor-cull chrome for the local view.
 * @param {TokenDocument} doc
 * @param {object} changes
 * @returns {boolean}
 */
function updateNeedsOffLevelChrome(doc, changes) {
  const viewId = localViewedLevelId();
  if ( !viewId ) return false;

  // Token on the floor you're viewing: movement must not touch chrome.
  if ( doc.level === viewId ) {
    const token = doc.object;
    return Boolean(token?._jinxFloorCulled);
  }

  // Other floor: only spatial / identity changes matter.
  return ("x" in changes) || ("y" in changes) || ("elevation" in changes)
    || ("level" in changes) || ("width" in changes) || ("height" in changes)
    || ("shape" in changes) || ("name" in changes) || ("displayName" in changes);
}

/**
 * Per-local-user floor cull chrome + interaction.
 */
export function applyCoreOffLevelChromeTweaks() {
  ensureTokenRefreshStateHub();

  // After Foundry refreshState (which resets nameplate.visible / eventMode).
  afterTokenRefreshState(function applyOffLevelTokenChrome() {
    applyOffLevelChrome(this);
  });

  // Do not wrap _refreshTooltip / _refreshNameplate — those fire heavily during
  // drag/WASD; refreshState hub already re-applies chrome.

  registerTokenWrap("isInteractable", isInteractableWrapper);
  registerTokenWrap("_canHover", denyWhenFloorCulled);
  registerTokenWrap("_canControl", denyWhenFloorCulled);
  registerTokenWrap("setTarget", setTargetWrapper);

  Hooks.on("canvasReady", () => {
    refreshAllTokenChrome();
  });
  Hooks.on("updateScene", (scene, changes) => {
    if ( scene !== canvas.scene ) return;
    if ( !("levels" in changes) && changes.flags?.levels == null ) return;
    refreshAllTokenChrome();
  });
  Hooks.on("updateToken", (doc, changes) => {
    if ( !doc?.id || !updateNeedsOffLevelChrome(doc, changes) ) return;
    invalidateTokenCoverage(doc.id);
    const token = doc.object;
    if ( !token ) return;
    delete token._jinxOffLevelSig;
    applyOffLevelChrome(token);
  });

  if ( canvas?.ready ) refreshAllTokenChrome();
  log("Per-local-view floor cull (skip same-level move path)");
}
