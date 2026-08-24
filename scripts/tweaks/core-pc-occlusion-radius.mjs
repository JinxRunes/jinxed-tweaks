/**
 * Player character overhead tile occlusion.
 *
 * 1) Default Occlusion Radius 15 for player-owned dnd5e `character` actors.
 * 2) Restrict TokenLayer#_getOccludableTokens so only those PCs punch holes /
 *    fade overhead tiles. Foundry’s GM default includes TOKEN_OCCLUSION_MODES.VISIBLE,
 *    which otherwise lets every visible NPC under a sail share the same occlusion mask.
 */

const MODULE_ID = "jinxed-tweaks";
const DEFAULT_RADIUS = 15;
const CHARACTER_TYPE = "character";

function log(message, level="log") {
  console[level](`jinxed-tweaks | pc-occlusion-radius | ${message}`);
}

/**
 * @returns {boolean}
 */
function isActiveGm() {
  return !!(game.user?.isGM && game.users.activeGM?.isSelf);
}

/**
 * @param {object|null|undefined} ownership
 * @returns {boolean}
 */
function ownershipHasPlayerOwner(ownership) {
  if ( !ownership || typeof ownership !== "object" ) return false;
  const OWNER = CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER;
  for ( const [userId, level] of Object.entries(ownership) ) {
    if ( userId === "default" ) continue;
    const user = game.users?.get(userId);
    if ( user && !user.isGM && Number(level) >= OWNER ) return true;
  }
  return false;
}

/**
 * True player character: character sheet owned by a non-GM user.
 * @param {Actor|null|undefined} actor
 * @returns {boolean}
 */
function isPlayerCharacter(actor) {
  return actor?.type === CHARACTER_TYPE && !!actor.hasPlayerOwner;
}

/**
 * @param {Token} token
 * @returns {boolean}
 */
function isPlayerCharacterToken(token) {
  return isPlayerCharacter(token?.actor);
}

/**
 * @param {object|null|undefined} data
 * @returns {boolean}
 */
function dataIsPlayerCharacter(data) {
  return data?.type === CHARACTER_TYPE && ownershipHasPlayerOwner(data.ownership);
}

/**
 * @param {number|null|undefined} radius
 * @returns {boolean}
 */
function needsDefault(radius) {
  return radius == null || Number(radius) === 0;
}

/**
 * @param {string} target
 * @param {Function} wrapper
 * @returns {boolean}
 */
function registerWrap(target, wrapper) {
  if ( typeof libWrapper?.register === "function" && game.modules.get("lib-wrapper")?.active ) {
    try {
      libWrapper.register(MODULE_ID, target, wrapper, "WRAPPER");
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
  if ( typeof original !== "function" || original.__jinxPcOcclusion ) return false;
  const patched = function(...args) {
    return wrapper.call(this, original.bind(this), ...args);
  };
  patched.__jinxPcOcclusion = true;
  parent[methodName] = patched;
  return true;
}

/**
 * Only player-owned characters trigger overhead tile occlusion.
 * @param {Function} wrapped
 * @returns {Token[]}
 */
function wrapGetOccludableTokens(wrapped) {
  return wrapped().filter(isPlayerCharacterToken);
}

/**
 * New player-owned characters default to Occlusion Radius 15.
 * @param {Actor} _actor
 * @param {object} data
 */
function onPreCreateActor(_actor, data) {
  if ( !dataIsPlayerCharacter(data) ) return;
  if ( !needsDefault(foundry.utils.getProperty(data, "prototypeToken.occludable.radius")) ) return;
  foundry.utils.setProperty(data, "prototypeToken.occludable.radius", DEFAULT_RADIUS);
}

/**
 * When a character gains a player owner, apply the default if still 0.
 * @param {Actor} actor
 * @param {object} changes
 */
function onUpdateActor(actor, changes) {
  if ( !isActiveGm() ) return;
  if ( actor.type !== CHARACTER_TYPE ) return;
  if ( !foundry.utils.hasProperty(changes, "ownership") ) return;
  if ( !actor.hasPlayerOwner ) return;
  if ( !needsDefault(actor.prototypeToken?.occludable?.radius) ) return;
  void actor.update(
    {"prototypeToken.occludable.radius": DEFAULT_RADIUS},
    {diff: false}
  ).catch(err => log(`Ownership radius update failed: ${err?.message ?? err}`, "warn"));
}

/**
 * PC-only overhead occlusion + Occlusion Radius default 15.
 */
export function applyPcOcclusionRadiusTweaks() {
  Hooks.on("preCreateActor", onPreCreateActor);
  Hooks.on("updateActor", onUpdateActor);

  const wrapped = registerWrap(
    "foundry.canvas.layers.TokenLayer.prototype._getOccludableTokens",
    wrapGetOccludableTokens
  );
  if ( !wrapped ) log("Failed to wrap _getOccludableTokens", "warn");
  else if ( canvas?.ready ) canvas.perception?.update?.({refreshOcclusion: true});

  log(`PC-only tile occlusion + radius ${DEFAULT_RADIUS} enabled`);
}
