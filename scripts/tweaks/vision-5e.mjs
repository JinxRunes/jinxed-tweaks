/**
 * Vision 5e — sense-blocked tokens should be swirl-only (or fully hidden).
 *
 * Cases:
 * - Imprecise detection (e.g. Hearing an invisible creature, blinded observer):
 *   Vision 5e still leaves Foundry chrome drawable. `_refreshState` reapplies
 *   Always Display Name after our visibility pass.
 * - Invisible tokens under GM omniscient / unrestricted vision are marked PRECISE,
 *   so the character art + name remain visible. Table preference: observers who
 *   cannot pierce invisibility should not see art or name (owners and See
 *   Invisibility / Truesight still can).
 *
 * Hearing itself is unchanged.
 *
 * `_refreshState` is shared via token-refresh-state-hub (one libWrapper per package).
 */

import {afterTokenRefreshState, ensureTokenRefreshStateHub} from "./token-refresh-state-hub.mjs";

const WRAPPER_ID = "jinxed-tweaks";

/** Detection / status ids that pierce invisibility. */
const SEE_INVISIBLE_MODES = new Set([
  "seeInvisibility",
  "seeAll",
  "truesight"
]);

function log(message, level="log") {
  console[level](`jinxed-tweaks | vision-5e | ${message}`);
}

/**
 * @returns {{NONE: number, IMPRECISE: number, PRECISE: number}}
 */
function getDetectionLevels() {
  return CONFIG.Token.objectClass?.DETECTION_LEVELS ?? {
    NONE: 0,
    IMPRECISE: 1,
    PRECISE: 2
  };
}

/**
 * @param {Token} token
 * @returns {number|undefined}
 */
function getDetectionLevel(token) {
  return token?.detectionLevel ?? token?._detectionLevel;
}

/**
 * @param {Token} token
 * @returns {boolean}
 */
function isImprecise(token) {
  return getDetectionLevel(token) === getDetectionLevels().IMPRECISE;
}

/**
 * @param {Token} token
 * @returns {boolean}
 */
function hasInvisibleStatus(token) {
  const inv = CONFIG.specialStatusEffects?.INVISIBLE ?? "invisible";
  return Boolean(token?.document?.hasStatusEffect?.(inv));
}

/**
 * Does the current observer have an active vision source that pierces invisibility?
 * @returns {boolean}
 */
function observerCanPierceInvisibility() {
  const sources = canvas.effects?.visionSources;
  if ( !sources?.size && !sources?.contents?.length ) {
    // Map/iterable shapes differ by Foundry version.
  }

  const list = sources?.values?.()
    ? [...sources.values()]
    : (sources?.contents ?? []);

  for ( const source of list ) {
    const doc = source?.object?.document ?? source?.source?.object?.document;
    if ( !doc ) continue;

    for ( const mode of doc.detectionModes ?? [] ) {
      if ( !mode?.enabled ) continue;
      if ( !SEE_INVISIBLE_MODES.has(mode.id) ) continue;
      if ( Number(mode.range) > 0 || mode.range == null ) return true;
    }

    // Vision 5e / CE may expose these as statuses on the observer.
    if ( doc.hasStatusEffect?.("seeInvisibility") ) return true;
    if ( source.object?.actor?.statuses?.has?.("seeInvisibility") ) return true;
  }

  return false;
}

/**
 * Hide character art + name for sense-blocked tokens.
 * @param {Token} token
 * @returns {boolean}
 */
function shouldHideSenseBlockedChrome(token) {
  if ( !token ) return false;
  if ( isImprecise(token) ) return true;

  if ( !hasInvisibleStatus(token) ) return false;
  if ( token.isOwner ) return false;
  if ( observerCanPierceInvisibility() ) return false;

  // Invisible to this observer — including GM omniscient PRECISE draws.
  return true;
}

/**
 * Objects that must not appear for sense-blocked detection.
 * @param {Token} token
 * @returns {PIXI.DisplayObject[]}
 */
function senseBlockedChrome(token) {
  return [
    token.mesh,
    token.tooltip,
    token.border,
    token.bars,
    token.levelIndicator,
    token.nameplate,
    token.targetArrows,
    token.targetPips,
    token.effects
  ].filter(Boolean);
}

/**
 * @param {Token} token
 * @param {boolean} hide
 */
function applySenseBlockedChrome(token) {
  const hide = shouldHideSenseBlockedChrome(token);

  for ( const obj of senseBlockedChrome(token) ) {
    if ( hide ) {
      obj.visible = false;
      if ( "renderable" in obj ) {
        obj.renderable = false;
        obj._jinxSenseBlockedRenderable = true;
      }
    }
    else if ( obj._jinxSenseBlockedRenderable ) {
      // Only undo our own latch — do not force renderable=true over off-level chrome.
      obj.renderable = true;
      delete obj._jinxSenseBlockedRenderable;
    }
  }

  if ( hide && isImprecise(token) && token.detectionFilterMesh ) {
    token.detectionFilterMesh.visible = true;
    token.detectionFilterMesh.renderable = true;
  }
}

/**
 * @param {Function} wrapped
 */
function tokenRefreshVisibilityWrapper(wrapped) {
  const result = wrapped();
  applySenseBlockedChrome(this);
  return result;
}

/**
 * Always Display Name must not win over sense-blocked tokens.
 * WRAPPER type must always chain `wrapped(...)`.
 * @param {Function} wrapped
 * @param {number} mode
 * @returns {boolean}
 */
function tokenCanViewModeWrapper(wrapped, mode) {
  const allowed = wrapped(mode);
  if ( shouldHideSenseBlockedChrome(this) ) return false;
  return allowed;
}

/**
 * @param {string} target
 * @param {Function} wrapper
 * @param {"WRAPPER"|"MIXED"} [type]
 */
function registerWrap(target, wrapper, type="WRAPPER") {
  if ( typeof libWrapper?.register === "function" && game.modules.get("lib-wrapper")?.active ) {
    libWrapper.register(WRAPPER_ID, target, wrapper, type);
    return true;
  }

  const parts = target.split(".");
  const methodName = parts.pop();
  const parent = parts.reduce((obj, key) => obj?.[key], globalThis);
  const original = parent?.[methodName];
  if ( typeof original !== "function" ) {
    log(`Could not wrap ${target}`, "warn");
    return false;
  }
  parent[methodName] = function jinxedVisionFallback(...args) {
    return wrapper.call(this, original.bind(this), ...args);
  };
  return true;
}

/**
 * @param {string} method
 * @param {Function} wrapper
 */
function registerTokenWrap(method, wrapper) {
  const primary = `CONFIG.Token.objectClass.prototype.${method}`;
  if ( registerWrap(primary, wrapper, "WRAPPER") ) return;
  registerWrap(`foundry.canvas.placeables.Token.prototype.${method}`, wrapper, "WRAPPER");
}

/**
 * Apply Vision 5e display tweaks.
 */
export function applyVision5eTweaks() {
  if ( !game.modules.get("vision-5e")?.active ) {
    log("Vision 5e inactive; skip", "warn");
    return;
  }

  registerTokenWrap("_refreshVisibility", tokenRefreshVisibilityWrapper);
  ensureTokenRefreshStateHub();
  afterTokenRefreshState(function applyVisionSenseBlockedChrome() {
    applySenseBlockedChrome(this);
  });
  registerTokenWrap("_canViewMode", tokenCanViewModeWrapper);

  if ( canvas?.ready ) {
    for ( const token of canvas.tokens?.placeables ?? [] ) {
      token.renderFlags?.set({refreshVisibility: true, refreshState: true});
    }
    canvas.perception?.update({refreshVision: true});
  }

  log("Sense-blocked tokens hide art/name (imprecise + invisible without pierce)");
}
