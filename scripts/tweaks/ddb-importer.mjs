/**
 * DDB Importer compatibility.
 *
 * ## Bloodied / encumbrance race
 * During character update, DDB does
 *   actor.deleteEmbeddedDocuments("ActiveEffect", [], { deleteAll: true })
 * while dnd5e's Actor5e#updateBloodied (HP-driven) concurrently
 *   effect.delete()'s the fixed-id status `dnd5ebloodied000`.
 * Foundry's server delete is strict — the second delete throws
 *   ActiveEffect "dnd5ebloodied000" does not exist!
 * and DDB aborts the import.
 *
 * Fix: suppress updateBloodied / updateEncumbrance during AE wipes, make
 * ActiveEffect deletes idempotent for already-gone ids, resync after
 * ddb-importer.characterProcessDataComplete.
 *
 * ## Non-container parents (Explorer's Pack / backpack quirk)
 * D&D Beyond nests pack gear under a parent inventory row that exists but has
 * definition.isContainer === false. DDB Importer then skips those children
 * ("Skipping item … as it is in a container we don't have") when
 * character-import-policy-ignore-items-with-non-existing-containers is on.
 *
 * Fix: before getInventory, clear containerEntityId on children whose parent
 * is not actually a container so they import as normal inventory (not skipped).
 *
 * ## Sync / import zeros HP (dying)
 * DDBCharacterImporter#resetHitPoints does
 *   hp.value = (flags.ddbimporter.totalHP ?? 0) - removedHitPoints
 * When totalHP is missing (failed _generateHitPoints / incomplete flags), that
 * becomes 0. Midi-qol then applies dying after its import-safe config is restored.
 *
 * Fix: repair missing/suspicious totalHP before resetHitPoints, and after
 * characterProcessDataComplete restore HP + clear death saves / dying if needed.
 */

const WRAPPER_ID = "jinxed-tweaks";

/** @type {WeakMap<object, number>} */
const aeDeleteDepth = new WeakMap();
/** Actors currently mid DDB character rebuild (AE wipe seen, complete hook pending). */
const ddbImportActors = new WeakSet();
/** @type {WeakMap<object, ReturnType<typeof setTimeout>>} */
const importTimeouts = new WeakMap();

const MISSING_AE_RE = /ActiveEffect\s+"[^"]+"\s+does not exist/i;
const IMPORT_SUPPRESS_MS = 10 * 60 * 1000;

function log(message, level="log") {
  console[level](`jinxed-tweaks | ddb-importer | ${message}`);
}

/**
 * @param {object|null|undefined} actor
 * @returns {boolean}
 */
function isStatusSuppressActive(actor) {
  if ( !actor ) return false;
  if ( ddbImportActors.has(actor) ) return true;
  return (aeDeleteDepth.get(actor) || 0) > 0;
}

/**
 * @param {object} actor
 */
function beginAeDelete(actor) {
  aeDeleteDepth.set(actor, (aeDeleteDepth.get(actor) || 0) + 1);
}

/**
 * @param {object} actor
 */
function endAeDelete(actor) {
  const next = (aeDeleteDepth.get(actor) || 1) - 1;
  if ( next <= 0 ) aeDeleteDepth.delete(actor);
  else aeDeleteDepth.set(actor, next);
}

/**
 * @param {object} actor
 */
function markDdbImport(actor) {
  ddbImportActors.add(actor);
  const prev = importTimeouts.get(actor);
  if ( prev ) clearTimeout(prev);
  importTimeouts.set(actor, setTimeout(() => {
    if ( !ddbImportActors.has(actor) ) return;
    ddbImportActors.delete(actor);
    importTimeouts.delete(actor);
    log("Cleared stuck DDB import suppress (timeout)", "warn");
  }, IMPORT_SUPPRESS_MS));
}

/**
 * @param {object|null|undefined} actor
 */
function clearDdbImport(actor) {
  if ( !actor ) return;
  ddbImportActors.delete(actor);
  const prev = importTimeouts.get(actor);
  if ( prev ) clearTimeout(prev);
  importTimeouts.delete(actor);
}

/**
 * @param {object|null|undefined} actor
 */
function resyncSystemStatuses(actor) {
  if ( !actor || isStatusSuppressActive(actor) ) return;
  try {
    actor.updateBloodied?.({});
  }
  catch (error) {
    log(`updateBloodied resync failed: ${error?.message || error}`, "warn");
  }
  try {
    actor.updateEncumbrance?.({});
  }
  catch (error) {
    log(`updateEncumbrance resync failed: ${error?.message || error}`, "warn");
  }
}

/**
 * @param {unknown} error
 * @returns {boolean}
 */
function isMissingActiveEffectError(error) {
  const message = error?.message || String(error || "");
  return MISSING_AE_RE.test(message);
}

/**
 * @param {Function} wrapped
 * @param {object} [options]
 */
function updateBloodiedGuard(wrapped, options) {
  if ( isStatusSuppressActive(this) ) return;
  return wrapped.call(this, options);
}

/**
 * @param {Function} wrapped
 * @param {object} [options]
 */
function updateEncumbranceGuard(wrapped, options) {
  if ( isStatusSuppressActive(this) ) return;
  return wrapped.call(this, options);
}

/**
 * @param {Function} wrapped
 * @param {string} embeddedName
 * @param {string[]} [ids]
 * @param {object} [operation]
 */
async function deleteEmbeddedDocumentsGuard(wrapped, embeddedName, ids=[], operation={}) {
  const isAe = embeddedName === "ActiveEffect";
  if ( !isAe ) return wrapped.call(this, embeddedName, ids, operation);

  beginAeDelete(this);
  if ( operation.deleteAll ) markDdbImport(this);
  try {
    return await wrapped.call(this, embeddedName, ids, operation);
  }
  catch (error) {
    if ( isMissingActiveEffectError(error) ) {
      log(`Ignored already-gone ActiveEffect delete on ${this.name || this.id}`);
      return [];
    }
    throw error;
  }
  finally {
    endAeDelete(this);
  }
}

/**
 * Filter gone ids, then treat server "does not exist" as success (idempotent delete).
 * @param {Function} wrapped
 * @param {string[]} [ids]
 * @param {object} [operation]
 */
async function activeEffectDeleteDocumentsGuard(wrapped, ids=[], operation={}) {
  let nextIds = ids;
  if ( operation.parent && !operation.deleteAll && Array.isArray(ids) && ids.length ) {
    const collection = operation.parent.effects
      ?? operation.parent.getEmbeddedCollection?.("ActiveEffect");
    if ( collection?.has ) {
      nextIds = ids.filter(id => collection.has(id));
      if ( nextIds.length !== ids.length ) {
        log(`Filtered ${ids.length - nextIds.length} already-gone ActiveEffect id(s) before delete`);
      }
      if ( !nextIds.length ) return [];
    }
  }

  try {
    return await wrapped.call(this, nextIds, operation);
  }
  catch (error) {
    if ( !isMissingActiveEffectError(error) ) throw error;

    // Concurrent race: retry only ids that still exist locally.
    const collection = operation.parent?.effects
      ?? operation.parent?.getEmbeddedCollection?.("ActiveEffect");
    if ( operation.deleteAll || !collection?.has || !Array.isArray(nextIds) ) {
      log("Ignored ActiveEffect delete race (does not exist)");
      return [];
    }
    const remaining = nextIds.filter(id => collection.has(id));
    if ( !remaining.length ) {
      log("Ignored ActiveEffect delete race (all gone)");
      return [];
    }
    log(`Retrying ActiveEffect delete for ${remaining.length} remaining id(s)`);
    try {
      return await wrapped.call(this, remaining, operation);
    }
    catch (retryError) {
      if ( isMissingActiveEffectError(retryError) ) {
        log("Ignored ActiveEffect delete race on retry");
        return [];
      }
      throw retryError;
    }
  }
}

/**
 * DDB nests Explorer's Pack / backpack contents under a parent that is not
 * flagged isContainer. Clear that bogus nesting so getInventory does not skip.
 * @param {object|null|undefined} ddb
 * @returns {number} cleared child count
 */
function sanitizeNonContainerParents(ddb) {
  const inventory = ddb?.character?.inventory;
  if ( !Array.isArray(inventory) || !inventory.length ) return 0;

  /** @type {Map<any, object>} */
  const byId = new Map();
  for ( const entry of inventory ) {
    if ( entry?.id != null ) byId.set(entry.id, entry);
  }

  let cleared = 0;
  const names = [];
  for ( const item of inventory ) {
    const containerId = item?.containerEntityId;
    if ( containerId == null || containerId === "" ) continue;
    const parent = byId.get(containerId);
    if ( !parent ) continue;
    if ( parent.definition?.isContainer === true ) continue;

    const parentName = parent.definition?.name || String(containerId);
    const itemName = item.definition?.name || String(item.id ?? "?");
    item.containerEntityId = null;
    if ( "containerEntityTypeId" in item ) item.containerEntityTypeId = null;
    if ( item.definition && "containerEntityId" in item.definition ) {
      item.definition.containerEntityId = null;
    }
    cleared += 1;
    if ( names.length < 12 ) names.push(`${itemName}←${parentName}`);
  }

  if ( cleared ) {
    const sample = names.length ? ` (${names.join(", ")}${cleared > names.length ? ", …" : ""})` : "";
    log(`Cleared ${cleared} item(s) nested under non-container DDB parent(s)${sample}`);
  }
  return cleared;
}

/**
 * @param {Function} wrapped
 * @param {...any} args
 */
async function getInventoryGuard(wrapped, ...args) {
  sanitizeNonContainerParents(this.source?.ddb);
  return wrapped(...args);
}

/**
 * @param {unknown} value
 * @returns {boolean}
 */
function isMissingHpTotal(value) {
  if ( value == null || value === "" ) return true;
  const n = Number(value);
  return Number.isNaN(n);
}

/**
 * Ensure flags.ddbimporter.totalHP is usable before DDBI's resetHitPoints zeros HP.
 * @param {object} importer  DDBCharacterImporter instance
 * @returns {boolean} whether flags were repaired
 */
function repairTotalHpFlag(importer) {
  if ( !importer?.settings?.updatePolicyHP ) return false;
  const character = importer.result?.character;
  const flags = character?.flags?.ddbimporter;
  if ( !flags || !character?.system?.attributes?.hp ) return false;

  const removed = Number(flags.removedHitPoints ?? 0) || 0;
  const generated = Number(character.system.attributes.hp.value);
  const original = Number(importer.actorOriginal?.system?.attributes?.hp?.value);
  const totalHP = flags.totalHP;
  const computed = (Number(totalHP) || 0) - removed;

  let fallback = null;
  if ( isMissingHpTotal(totalHP) ) {
    if ( Number.isFinite(generated) && generated > 0 ) fallback = generated + removed;
    else if ( Number.isFinite(original) && original > 0 ) fallback = original + removed;
  }
  else if ( computed <= 0 ) {
    // Would zero the sheet, but parse still had a living HP — don't clobber.
    if ( Number.isFinite(generated) && generated > 0 ) fallback = generated + removed;
    else if ( Number.isFinite(original) && original > 0 ) fallback = original + removed;
  }

  if ( fallback == null || !(fallback > 0) ) return false;
  flags.totalHP = fallback;
  log(`Repaired ddbimporter.totalHP → ${fallback} (was ${String(totalHP)}, removed=${removed})`);
  return true;
}

/**
 * @param {Function} wrapped
 */
async function resetHitPointsGuard(wrapped) {
  repairTotalHpFlag(this);
  return wrapped();
}

/**
 * @param {Iterable<string>|Set<string>|string[]|undefined|null} statuses
 * @param {string} id
 * @returns {boolean}
 */
function statusesHas(statuses, id) {
  if ( !statuses ) return false;
  if ( typeof statuses.has === "function" ) return statuses.has(id);
  if ( Array.isArray(statuses) ) return statuses.includes(id);
  return false;
}

/**
 * After import: if HP was incorrectly zeroed, restore and clear dying/death saves.
 * @param {object|null|undefined} actor
 * @param {object|null|undefined} ddbCharacter
 */
async function repairPostImportHitPoints(actor, ddbCharacter) {
  if ( !actor?.system?.attributes?.hp ) return;

  const flags = actor.flags?.ddbimporter ?? {};
  const dataFlags = ddbCharacter?.data?.character?.flags?.ddbimporter ?? {};
  const generatedHp = ddbCharacter?.data?.character?.system?.attributes?.hp;
  let totalHP = flags.totalHP ?? dataFlags.totalHP;
  let removed = Number(flags.removedHitPoints ?? dataFlags.removedHitPoints ?? 0) || 0;
  const current = Number(actor.system.attributes.hp.value ?? 0);
  const effectiveMax = Number(
    actor.system.attributes.hp.effectiveMax
    ?? actor.system.attributes.hp.max
    ?? 0
  ) || 0;
  const generatedValue = Number(generatedHp?.value);

  if ( isMissingHpTotal(totalHP) || (Number(totalHP) - removed <= 0 && generatedValue > 0) ) {
    if ( generatedValue > 0 ) totalHP = generatedValue + removed;
    else if ( effectiveMax > 0 && current <= 0 ) totalHP = effectiveMax;
  }

  const expected = Math.max(0, (Number(totalHP) || 0) - removed);
  const updates = {};

  if ( expected > 0 && current <= 0 ) {
    updates["system.attributes.hp.value"] = expected;
    updates["flags.ddbimporter.totalHP"] = Number(totalHP);
    updates["flags.ddbimporter.removedHitPoints"] = removed;
    log(`Restored ${actor.name} HP ${current} → ${expected} after DDB import`);
  }

  const hpAfter = updates["system.attributes.hp.value"] ?? current;
  if ( hpAfter > 0 ) {
    const death = actor.system.attributes.death;
    if ( death && ((death.success ?? 0) > 0 || (death.failure ?? 0) > 0) ) {
      updates["system.attributes.death.success"] = 0;
      updates["system.attributes.death.failure"] = 0;
    }
  }

  if ( Object.keys(updates).length ) {
    await actor.update(updates);
  }

  if ( (actor.system.attributes.hp.value ?? 0) <= 0 ) return;

  const toDelete = [];
  for ( const effect of actor.effects ?? [] ) {
    const name = String(effect.name || effect.label || "").toLowerCase();
    const dying = statusesHas(effect.statuses, "dying")
      || statusesHas(effect.statuses, "dead")
      || statusesHas(effect.statuses, "unconscious")
      || /\b(dying|dead|unconscious)\b/.test(name);
    if ( dying && effect.id ) toDelete.push(effect.id);
  }
  if ( toDelete.length ) {
    try {
      await actor.deleteEmbeddedDocuments("ActiveEffect", toDelete);
      log(`Removed ${toDelete.length} death/dying effect(s) from ${actor.name}`);
    }
    catch (error) {
      if ( !/does not exist/i.test(error?.message || "") ) throw error;
    }
  }
}

/**
 * Locate DDBCharacterImporter (not always exported on lib).
 * @returns {Function|null}
 */
function findDdbCharacterImporterClass() {
  const roots = [
    globalThis.DDBImporter,
    game.modules.get("ddb-importer")?.api
  ].filter(Boolean);

  /** @type {Set<object>} */
  const seen = new Set();
  const stack = [...roots];
  let steps = 0;
  while ( stack.length && steps < 400 ) {
    steps += 1;
    const node = stack.pop();
    if ( !node || (typeof node !== "object" && typeof node !== "function") ) continue;
    if ( seen.has(node) ) continue;
    seen.add(node);

    if ( typeof node === "function"
      && typeof node.prototype?.resetHitPoints === "function"
      && typeof node.prototype?.setAtLeastOneHP === "function" ) {
      return node;
    }

    try {
      for ( const value of Object.values(node) ) {
        if ( value && (typeof value === "object" || typeof value === "function") ) stack.push(value);
      }
    }
    catch { /* ignore */ }
  }
  return null;
}

/**
 * @param {string} target
 * @param {Function} wrapper
 * @param {"WRAPPER"|"MIXED"|"OVERRIDE"} [type]
 */
function registerWrapper(target, wrapper, type="WRAPPER") {
  if ( typeof libWrapper?.register === "function" && game.modules.get("lib-wrapper")?.active ) {
    libWrapper.register(WRAPPER_ID, target, wrapper, type);
    return true;
  }
  return false;
}

/**
 * Fallback when libWrapper is missing: wrap prototype method in place.
 * @param {object} proto
 * @param {string} method
 * @param {Function} guard  (wrapped, ...args) with `this` = instance
 */
function patchPrototype(proto, method, guard) {
  if ( !proto || typeof proto[method] !== "function" ) return false;
  if ( proto[method].__jinxDdbImporter ) return true;
  const original = proto[method];
  const patched = function(...args) {
    return guard.call(this, original.bind(this), ...args);
  };
  patched.__jinxDdbImporter = true;
  proto[method] = patched;
  return true;
}

/**
 * Prevent dnd5e bloodied/encumbrance auto-effects from racing DDB's AE wipe.
 */
export function applyDdbImporterTweaks() {
  let patched = 0;

  const actorProto = CONFIG.Actor?.documentClass?.prototype;
  if ( actorProto ) {
    if ( typeof actorProto.updateBloodied === "function" ) {
      if ( registerWrapper(
        "CONFIG.Actor.documentClass.prototype.updateBloodied",
        updateBloodiedGuard,
        "MIXED"
      ) || patchPrototype(actorProto, "updateBloodied", updateBloodiedGuard) ) {
        patched += 1;
      }
    }
    if ( typeof actorProto.updateEncumbrance === "function" ) {
      if ( registerWrapper(
        "CONFIG.Actor.documentClass.prototype.updateEncumbrance",
        updateEncumbranceGuard,
        "MIXED"
      ) || patchPrototype(actorProto, "updateEncumbrance", updateEncumbranceGuard) ) {
        patched += 1;
      }
    }
    if ( typeof actorProto.deleteEmbeddedDocuments === "function" ) {
      if ( registerWrapper(
        "CONFIG.Actor.documentClass.prototype.deleteEmbeddedDocuments",
        deleteEmbeddedDocumentsGuard,
        "WRAPPER"
      ) || patchPrototype(actorProto, "deleteEmbeddedDocuments", deleteEmbeddedDocumentsGuard) ) {
        patched += 1;
      }
    }
  }

  const aeClass = CONFIG.ActiveEffect?.documentClass;
  if ( aeClass && typeof aeClass.deleteDocuments === "function" ) {
    if ( registerWrapper(
      "CONFIG.ActiveEffect.documentClass.deleteDocuments",
      activeEffectDeleteDocumentsGuard,
      "WRAPPER"
    ) ) {
      patched += 1;
    }
    else if ( !aeClass.deleteDocuments.__jinxDdbImporter ) {
      const original = aeClass.deleteDocuments.bind(aeClass);
      const patchedFn = function(...args) {
        return activeEffectDeleteDocumentsGuard.call(this, original, ...args);
      };
      patchedFn.__jinxDdbImporter = true;
      aeClass.deleteDocuments = patchedFn;
      patched += 1;
    }
  }

  const DDBCharacter = globalThis.DDBImporter?.lib?.DDBCharacter;
  if ( DDBCharacter?.prototype && typeof DDBCharacter.prototype.getInventory === "function" ) {
    if ( patchPrototype(DDBCharacter.prototype, "getInventory", getInventoryGuard) ) patched += 1;
  }
  else {
    log("DDBCharacter.getInventory not found — non-container inventory sanitize skipped", "warn");
  }

  const DDBCharacterImporter = findDdbCharacterImporterClass();
  if ( DDBCharacterImporter?.prototype ) {
    if ( patchPrototype(DDBCharacterImporter.prototype, "resetHitPoints", resetHitPointsGuard) ) {
      patched += 1;
    }
  }
  // If the importer class moved/renamed, post-import HP repair still runs via the
  // characterProcessDataComplete hook — no need to warn on a missing wrap target.

  Hooks.on("ddb-importer.characterProcessDataComplete", ({actor, ddbCharacter}={}) => {
    clearDdbImport(actor);
    queueMicrotask(() => {
      Promise.resolve()
        .then(() => repairPostImportHitPoints(actor, ddbCharacter))
        .then(() => resyncSystemStatuses(actor))
        .catch(error => log(`Post-import HP repair failed: ${error?.message || error}`, "error"));
    });
  });

  log(`DDB import guards active (${patched} patch(es); bloodied, inventory, HP reset)`);
}
