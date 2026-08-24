/**
 * Core HUD / ApplicationV2 — silence harmless race during token animation.
 *
 * Token movement / render hooks can call `setPosition()` while ApplicationV2's
 * element is missing or temporarily detached. Foundry then dereferences
 * `element.parentElement.offsetWidth`, often through Monks Little Details.
 * Guard missing elements; defer detached-element positioning until attached.
 */

const WRAPPER_ID = "jinxed-tweaks";
const TARGET = "foundry.applications.api.ApplicationV2.prototype.setPosition";
const positionRetries = new WeakMap();
const MAX_RETRY_FRAMES = 20;

function log(message, level="log") {
  console[level](`jinxed-tweaks | core-hud | ${message}`);
}

/**
 * @param {Function} wrapped
 * @param {...any} args
 */
function schedulePositionRetry(application, args) {
  const existing = positionRetries.get(application);
  if ( existing ) {
    existing.args = args;
    return;
  }

  const state = {args, frames: 0};
  positionRetries.set(application, state);
  const retry = () => {
    const current = positionRetries.get(application);
    if ( current !== state ) return;
    const element = application.element;
    if ( !element ) {
      positionRetries.delete(application);
      return;
    }
    if ( element.parentElement ) {
      positionRetries.delete(application);
      application.setPosition(...state.args);
      return;
    }
    state.frames += 1;
    if ( state.frames >= MAX_RETRY_FRAMES ) {
      positionRetries.delete(application);
      return;
    }
    requestAnimationFrame(retry);
  };
  requestAnimationFrame(retry);
}

function setPositionGuard(wrapped, ...args) {
  const element = this.element;
  if ( !element ) return this.position;
  if ( !element.parentElement ) {
    schedulePositionRetry(this, args);
    return this.position;
  }
  return wrapped.apply(this, args);
}

/**
 * Guard ApplicationV2.setPosition when the DOM node is gone.
 */
export function applyCoreHudTweaks() {
  if ( typeof libWrapper?.register === "function" && game.modules.get("lib-wrapper")?.active ) {
    libWrapper.register(WRAPPER_ID, TARGET, setPositionGuard, "MIXED");
  }
  else {
    const proto = foundry.applications.api.ApplicationV2.prototype;
    const original = proto.setPosition;
    proto.setPosition = function jinxedSetPosition(...args) {
      return setPositionGuard.call(this, original.bind(this), ...args);
    };
  }
  log("ApplicationV2.setPosition guarded while element is missing or detached");
}
