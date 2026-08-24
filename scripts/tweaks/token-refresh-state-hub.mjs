/**
 * Shared Token chrome hooks for jinxed-tweaks.
 *
 * libWrapper allows only one wrapper per package id per target. Features share
 * these hubs instead of each calling register().
 */

const MODULE_ID = "jinxed-tweaks";
const STATE_TARGET = "CONFIG.Token.objectClass.prototype._refreshState";
const STATE_FALLBACK = "foundry.canvas.placeables.Token.prototype._refreshState";
const RENDER_TARGET = "CONFIG.Token.objectClass.prototype.render";
const RENDER_FALLBACK = "foundry.canvas.placeables.Token.prototype.render";

/** @type {Set<Function>} */
const afterRefresh = new Set();

/** @type {Set<Function>} */
const beforeRender = new Set();

let stateInstalled = false;
let renderInstalled = false;

/**
 * Run after Foundry's Token#_refreshState (and any other hub consumers).
 * `this` is the Token placeable.
 * @param {(this: Token) => void} fn
 */
export function afterTokenRefreshState(fn) {
  if ( typeof fn === "function" ) afterRefresh.add(fn);
}

/**
 * Run immediately before Token#render draws, after other jinx chrome passes
 * that register earlier (e.g. vision-5e sense-blocked).
 * `this` is the Token placeable.
 * @param {(this: Token) => void} fn
 */
export function beforeTokenRender(fn) {
  if ( typeof fn === "function" ) beforeRender.add(fn);
}

/**
 * @param {Token} token
 */
export function runBeforeTokenRender(token) {
  for ( const fn of beforeRender ) {
    try {
      fn.call(token);
    }
    catch ( err ) {
      console.error(`jinxed-tweaks | token-render-hub |`, err);
    }
  }
}

/**
 * @param {Function} wrapped
 * @param {...any} args
 */
function stateHubWrapper(wrapped, ...args) {
  const result = wrapped(...args);
  for ( const fn of afterRefresh ) {
    try {
      fn.call(this);
    }
    catch ( err ) {
      console.error(`jinxed-tweaks | token-refresh-state-hub |`, err);
    }
  }
  return result;
}

/**
 * @param {Function} wrapped
 * @param {...any} args
 */
function renderHubWrapper(wrapped, ...args) {
  runBeforeTokenRender(this);
  return wrapped(...args);
}

/**
 * @param {string} target
 * @param {Function} wrapper
 * @returns {boolean}
 */
function registerLibWrapper(target, wrapper) {
  if ( typeof libWrapper?.register !== "function" || !game.modules.get("lib-wrapper")?.active ) {
    return false;
  }
  libWrapper.register(MODULE_ID, target, wrapper, "WRAPPER");
  return true;
}

/**
 * @param {object} proto
 * @param {string} method
 * @param {Function} hubWrapper
 * @param {string} flag
 * @returns {boolean}
 */
function patchPrototypeMethod(proto, method, hubWrapper, flag) {
  if ( !proto || typeof proto[method] !== "function" ) return false;
  if ( proto[method][flag] ) return true;
  const original = proto[method];
  const patched = function(...args) {
    return hubWrapper.call(this, original.bind(this), ...args);
  };
  patched[flag] = true;
  proto[method] = patched;
  return true;
}

/**
 * Install the shared _refreshState wrapper once.
 */
export function ensureTokenRefreshStateHub() {
  if ( stateInstalled ) return;
  stateInstalled = true;

  if ( registerLibWrapper(STATE_TARGET, stateHubWrapper) ) return;
  if ( registerLibWrapper(STATE_FALLBACK, stateHubWrapper) ) return;

  const TokenClass = CONFIG.Token?.objectClass;
  if ( patchPrototypeMethod(TokenClass?.prototype, "_refreshState", stateHubWrapper, "__jinxRefreshStateHub") ) {
    return;
  }
  patchPrototypeMethod(foundry?.canvas?.placeables?.Token?.prototype, "_refreshState", stateHubWrapper, "__jinxRefreshStateHub");
}

/**
 * Install the shared render wrapper once (before-draw chrome).
 * Prefer registering after vision-5e's own render logic by having vision call
 * {@link runBeforeTokenRender}; this hub is the fallback when vision-5e is off,
 * or when vision registers its wrap to chain into this.
 */
export function ensureTokenRenderHub() {
  if ( renderInstalled ) return;
  renderInstalled = true;

  if ( registerLibWrapper(RENDER_TARGET, renderHubWrapper) ) return;
  if ( registerLibWrapper(RENDER_FALLBACK, renderHubWrapper) ) return;

  const TokenClass = CONFIG.Token?.objectClass;
  if ( patchPrototypeMethod(TokenClass?.prototype, "render", renderHubWrapper, "__jinxRenderHub") ) return;
  patchPrototypeMethod(foundry?.canvas?.placeables?.Token?.prototype, "render", renderHubWrapper, "__jinxRenderHub");
}
