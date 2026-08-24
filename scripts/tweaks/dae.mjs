/**
 * DAE — migrate leftover deprecated specialDuration flags and fix bad AE values.
 *
 * Warnings fire during Game#initializeDocuments (before setup/ready), so we:
 * 1) Wrap ActiveEffect initialization (init phase) to scrub via updateSource
 *    before the first prepareData/applyActiveEffects pass.
 * 2) Persist the same fixes to the world DB on ready (active GM).
 *
 * Mappings match DAE's getDeprecatedSpecialDurMap / migrateEffectData.
 */

const MODULE_ID = "jinxed-tweaks";
const WRAPPER_ID = "jinxed-tweaks";
const FLAG_KEY = "daeWorldCleanupDone";

function log(message, level="log") {
  console[level](`jinxed-tweaks | dae | ${message}`);
}

/**
 * @returns {Record<string, string>}
 */
function getDeprecatedSpecialDurMap() {
  try {
    const map = globalThis.DAE?.getDeprecatedSpecialDurMap?.()
      ?? game.modules.get("dae")?.api?.getDeprecatedSpecialDurMap?.();
    if ( map ) return map;
  } catch { /* ignore */ }

  const events = CONFIG.ActiveEffect?.expiryEvents ?? {};
  if ( "sourceStart" in events || "targetStart" in events ) {
    return {
      turnStart: "targetStart",
      turnEnd: "targetEnd",
      turnStartSource: "sourceStart",
      turnEndSource: "sourceEnd",
      combatEnd: "combatEnd"
    };
  }
  return {
    turnStart: "turnStart",
    turnEnd: "turnEnd",
    turnStartSource: "turnStart",
    turnEndSource: "turnEnd",
    combatEnd: "combatEnd"
  };
}

/**
 * @param {unknown} value
 * @returns {string[]}
 */
function asStringArray(value) {
  if ( Array.isArray(value) ) return value.map(String);
  if ( value && typeof value === "object" ) return Object.values(value).map(String);
  return [];
}

/**
 * @param {string} key
 * @returns {{value: string, type?: string}}
 */
function replacementForNaNChange(key) {
  if ( /movement\.(burrow|fly|swim|climb|walk)/.test(key) ) {
    return {value: "@attributes.movement.walk", type: "upgrade"};
  }
  if ( /senses\.ranges\./.test(key) || /\.range$/.test(key) ) {
    return {value: "0", type: "override"};
  }
  return {value: "0"};
}

/**
 * @param {ActiveEffect|object} effect  Document or plain toObject() data
 * @returns {object|null} Flat update (dotted keys)
 */
function buildEffectCleanupUpdate(effect) {
  const data = typeof effect.toObject === "function" ? effect.toObject() : effect;
  const update = {};
  const map = getDeprecatedSpecialDurMap();
  const specialDurs = asStringArray(data.flags?.dae?.specialDuration);
  const deprecated = specialDurs.filter(sd => sd in map);
  if ( deprecated.length ) {
    update["flags.dae.specialDuration"] = specialDurs.filter(sd => !(sd in map));
    if ( !data.duration?.expiry ) update["duration.expiry"] = map[deprecated[0]];
  }

  const changes = data.system?.changes ?? data.changes;
  if ( Array.isArray(changes) && changes.length ) {
    let dirty = false;
    const next = changes.map(change => {
      const raw = change?.value;
      const isNaNString = raw === "NaN" || raw === "nan";
      const isNaNNumber = typeof raw === "number" && Number.isNaN(raw);
      if ( !isNaNString && !isNaNNumber ) return foundry.utils.deepClone(change);
      dirty = true;
      const fix = replacementForNaNChange(change.key ?? "");
      const cloned = foundry.utils.deepClone(change);
      cloned.value = fix.value;
      if ( fix.type ) cloned.type = fix.type;
      return cloned;
    });
    if ( dirty ) {
      if ( data.system?.changes ) update["system.changes"] = next;
      else update.changes = next;
    }
  }

  return Object.keys(update).length ? update : null;
}

/**
 * Scrub an effect in-memory before applyActiveEffects (no DB write).
 * @param {ActiveEffect} effect
 * @returns {boolean}
 */
function scrubEffectInPlace(effect) {
  const update = buildEffectCleanupUpdate(effect);
  if ( !update ) return false;
  try {
    effect.updateSource(foundry.utils.expandObject(update));
    return true;
  }
  catch (error) {
    log(`In-place scrub failed for "${effect.name}": ${error?.message || error}`, "warn");
    return false;
  }
}

/**
 * @param {Actor} actor
 * @returns {Promise<number>}
 */
async function cleanupActor(actor) {
  let count = 0;
  const actorUpdates = [];
  for ( const effect of actor.effects ) {
    const delta = buildEffectCleanupUpdate(effect);
    if ( !delta ) continue;
    actorUpdates.push({_id: effect.id, ...delta});
  }
  if ( actorUpdates.length ) {
    await actor.updateEmbeddedDocuments("ActiveEffect", actorUpdates, {render: false});
    count += actorUpdates.length;
  }

  for ( const item of actor.items ) {
    const itemUpdates = [];
    for ( const effect of item.effects ) {
      const delta = buildEffectCleanupUpdate(effect);
      if ( !delta ) continue;
      itemUpdates.push({_id: effect.id, ...delta});
    }
    if ( itemUpdates.length ) {
      await item.updateEmbeddedDocuments("ActiveEffect", itemUpdates, {render: false});
      count += itemUpdates.length;
    }
  }
  return count;
}

/**
 * @param {Item} item
 * @returns {Promise<number>}
 */
async function cleanupItem(item) {
  const updates = [];
  for ( const effect of item.effects ) {
    const delta = buildEffectCleanupUpdate(effect);
    if ( !delta ) continue;
    updates.push({_id: effect.id, ...delta});
  }
  if ( !updates.length ) return 0;
  await item.updateEmbeddedDocuments("ActiveEffect", updates, {render: false});
  return updates.length;
}

/**
 * Wrap ActiveEffect init so deprecated data is scrubbed before first prepareData.
 */
export function applyDaeInitTweaks() {
  if ( !game.modules.get("dae")?.active ) return;

  const target = "CONFIG.ActiveEffect.documentClass.prototype._initialize";
  const wrapper = function jinxedActiveEffectInitialize(wrapped, ...args) {
    const result = wrapped.apply(this, args);
    scrubEffectInPlace(this);
    return result;
  };

  if ( typeof libWrapper?.register === "function" && game.modules.get("lib-wrapper")?.active ) {
    libWrapper.register(WRAPPER_ID, target, wrapper, "WRAPPER");
  }
  else {
    const proto = CONFIG.ActiveEffect?.documentClass?.prototype;
    if ( !proto?._initialize || proto._initialize.isJinxedDaeScrub ) return;
    const original = proto._initialize;
    function jinxedInit(...args) {
      return wrapper.call(this, original.bind(this), ...args);
    }
    jinxedInit.isJinxedDaeScrub = true;
    proto._initialize = jinxedInit;
  }

  log("ActiveEffect._initialize scrub for specialDuration / NaN changes");
}

/**
 * Persist migrations to the world DB (active GM).
 */
export async function applyDaeTweaks() {
  if ( !game.modules.get("dae")?.active ) {
    log("DAE inactive; skip", "warn");
    return;
  }
  if ( !game.user?.isActiveGM ) {
    log("Not active GM; skip world cleanup");
    return;
  }

  const api = game.modules.get("dae")?.api;
  if ( typeof api?.migrateWorld === "function" && !game.settings.get(MODULE_ID, FLAG_KEY) ) {
    try {
      log("Running DAE migrateWorld for deprecated special durations…");
      await api.migrateWorld();
    }
    catch (error) {
      log(`DAE migrateWorld failed: ${error?.message || error}`, "warn");
    }
  }

  let fixed = 0;
  for ( const actor of game.actors ) {
    try {
      fixed += await cleanupActor(actor);
    }
    catch (error) {
      log(`Actor "${actor.name}" cleanup failed: ${error?.message || error}`, "warn");
    }
  }
  for ( const item of game.items ) {
    try {
      fixed += await cleanupItem(item);
    }
    catch (error) {
      log(`Item "${item.name}" cleanup failed: ${error?.message || error}`, "warn");
    }
  }
  for ( const scene of game.scenes ) {
    for ( const token of scene.tokens ) {
      if ( token.actorLink || !token.actor ) continue;
      try {
        fixed += await cleanupActor(token.actor);
      }
      catch (error) {
        log(`Token actor "${token.name}" cleanup failed: ${error?.message || error}`, "warn");
      }
    }
  }

  try {
    await game.settings.set(MODULE_ID, FLAG_KEY, true);
  }
  catch (error) {
    log(`Could not persist cleanup flag: ${error?.message || error}`, "warn");
  }

  if ( fixed ) log(`Persisted cleanup for ${fixed} Active Effect(s)`);
  else log("No additional Active Effect DB cleanup needed");
}

/**
 * Register world setting used to avoid repeat migrateWorld calls.
 */
export function registerDaeSettings() {
  game.settings.register(MODULE_ID, FLAG_KEY, {
    scope: "world",
    config: false,
    type: Boolean,
    default: false
  });
}
