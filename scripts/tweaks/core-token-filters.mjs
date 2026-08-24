/**
 * Core — guard Token#_configureFilterEffect when mesh is not ready.
 *
 * Foundry Actor#prepareData applies special statuses to tokens with
 * `document.rendered` (object exists, not destroyed). That can run during
 * Convenient Effects / DAE / Midi prepare before Token#_draw creates `mesh`.
 * Core then does `this.mesh.filters ??= []` and throws, which DAE surfaces as
 * "Could not prepare data".
 *
 * Safe to skip: Token#_draw calls `_updateSpecialStatusFilterEffects()` once
 * the mesh exists, so invisibility filters still apply after draw.
 *
 * Wrap both CONFIG.Token.objectClass and the base Token prototype — Vision 5e
 * subclasses Token and `super._onApplyStatusEffect` still resolves
 * `_configureFilterEffect` via the instance prototype chain.
 */

const MODULE_ID = "jinxed-tweaks";
const TARGETS = [
  "CONFIG.Token.objectClass.prototype._configureFilterEffect",
  "foundry.canvas.placeables.Token.prototype._configureFilterEffect"
];

function log(message, level="log") {
  console[level](`${MODULE_ID} | core-token-filters | ${message}`);
}

/**
 * @param {Function} wrapped
 * @param {string} statusId
 * @param {boolean} active
 */
function configureFilterEffectGuard(wrapped, statusId, active) {
  if ( !this?.mesh || this.destroyed ) return;
  return wrapped(statusId, active);
}

/**
 * @param {string} target
 * @param {Function} wrapper
 * @returns {boolean}
 */
function registerWrap(target, wrapper) {
  if ( typeof libWrapper?.register !== "function" || !game.modules.get("lib-wrapper")?.active ) {
    return false;
  }
  try {
    libWrapper.register(MODULE_ID, target, wrapper, "MIXED");
    return true;
  }
  catch (error) {
    log(`libWrapper ${target}: ${error?.message || error}`, "warn");
    return false;
  }
}

/**
 * Resolve a dotted path on globalThis (CONFIG.Token… / foundry.canvas…).
 * @param {string} path
 * @returns {{ parent: object, methodName: string, original: Function }|null}
 */
function resolveMethod(path) {
  const parts = path.split(".");
  const methodName = parts.pop();
  const parent = parts.reduce((obj, key) => obj?.[key], globalThis);
  const original = parent?.[methodName];
  if ( !parent || typeof original !== "function" ) return null;
  return {parent, methodName, original};
}

/**
 * Own-property prototype patch (works when libWrapper is unavailable or the
 * method is only inherited onto a subclass prototype).
 * @param {string} path
 * @param {Function} wrapper
 * @returns {boolean}
 */
function patchPrototype(path, wrapper) {
  const resolved = resolveMethod(path);
  if ( !resolved ) return false;
  const {parent, methodName, original} = resolved;
  if ( original.__jinxTokenFilters ) return true;
  // Prefer an already-own method; otherwise install an own wrapper so subclass
  // instances hit the guard before the inherited Foundry implementation.
  const boundOriginal = parent.hasOwnProperty(methodName)
    ? original
    : Object.getPrototypeOf(parent)?.[methodName] ?? original;
  if ( typeof boundOriginal !== "function" ) return false;
  const patched = function(...args) {
    return wrapper.call(this, boundOriginal.bind(this), ...args);
  };
  patched.__jinxTokenFilters = true;
  parent[methodName] = patched;
  return true;
}

/**
 * Skip invisibility filter configuration until the Token mesh exists.
 */
export function applyCoreTokenFilterTweaks() {
  let wrapped = 0;
  for ( const target of TARGETS ) {
    if ( registerWrap(target, configureFilterEffectGuard)
      || patchPrototype(target, configureFilterEffectGuard) ) {
      wrapped += 1;
    }
  }

  if ( wrapped ) {
    log(`Guarded _configureFilterEffect when mesh is missing (${wrapped} path(s))`);
    return;
  }
  log("Could not wrap _configureFilterEffect", "warn");
}
