/**
 * Convenient Effects ↔ Token HUD / canvas drop bridge.
 *
 * Problem: Foundry's Token HUD conditions and ActiveEffect canvas/sheet drops
 * create bare status effects (or a raw AE copy). That skips Convenient Effects'
 * application path, so DAE / Midi-QoL / Active Token Effects (ATL) / Times-Up
 * automations and nested CE data never run — even though Simraki's radial
 * display will still show whatever icon landed on the token.
 *
 * Fix:
 * - Dragging a CE condition onto a token (or actor sheet) goes through CE's API
 * - Token HUD / right-click condition toggles redirect to the matching CE effect
 * - Preserve core/dnd5e status IDs and refresh status perception on every client,
 *   so Foundry + Vision 5e blindness, invisibility, special senses, and imprecise
 *   token detection continue to work when CE applies via the active GM socket
 * - CE effects created on actors always show their icon so Foundry draws them and
 *   Simraki can orbit + tooltip them (CE defaults are CONDITIONAL + no duration,
 *   which V14 treats as not temporary → no token icon / no SRE tooltip)
 * - Size/scale-related CE changes are mirrored to Active Token Effects (`ATL.*`) and
 *   tokens are refreshed so ATL / DAE / token.* automations (size, light, vision, etc.) run
 */

const CE_MODULE_ID = "dfreds-convenient-effects";
const WRAPPER_ID = "jinxed-tweaks";

function log(message, level="log") {
  console[level](`jinxed-tweaks | convenient-effects | ${message}`);
}

function getApi() {
  return game.modules.get(CE_MODULE_ID)?.api ?? null;
}

/**
 * @param {ActiveEffect|object} effect
 * @returns {string|undefined}
 */
function getCeEffectId(effect) {
  if ( !effect ) return undefined;
  if ( typeof effect.getFlag === "function" ) {
    return effect.getFlag(CE_MODULE_ID, "ceEffectId") ?? undefined;
  }
  return foundry.utils.getProperty(effect, `flags.${CE_MODULE_ID}.ceEffectId`);
}

/**
 * @param {ActiveEffect|object} effect
 * @returns {boolean}
 */
function isConvenientEffect(effect) {
  if ( !effect ) return false;
  if ( typeof effect.getFlag === "function" ) {
    return effect.getFlag(CE_MODULE_ID, "isConvenient") === true;
  }
  return foundry.utils.getProperty(effect, `flags.${CE_MODULE_ID}.isConvenient`) === true;
}

/**
 * Resolve a CE effect id from Foundry / CE drag data (sync when possible).
 * @param {object} data
 * @returns {string|null}
 */
function resolveCeEffectIdFromDropData(data) {
  if ( !data ) return null;
  if ( data.effectId ) return data.effectId;

  if ( data.type === "ActiveEffect" && data.uuid ) {
    let effect = null;
    try {
      effect = foundry.utils.fromUuidSync?.(data.uuid) ?? null;
    }
    catch {
      effect = null;
    }
    if ( !effect ) return null;
    if ( !isConvenientEffect(effect) && !getCeEffectId(effect) ) return null;
    return getCeEffectId(effect) ?? effect.id ?? null;
  }

  return null;
}

/**
 * Actors that should receive a dropped CE condition.
 * Prefer the token under the cursor; only fall back to controlled/targeted
 * tokens when the drop point misses (same targets CE click uses).
 * @param {object} data
 * @returns {Actor[]}
 */
function resolveDropActors(data) {
  const atPoint = findTokenAt(data?.x, data?.y)?.actor;
  if ( atPoint instanceof Actor ) return [atPoint];

  const seen = new Set();
  const actors = [];
  /** @param {Actor|null|undefined} actor */
  const push = actor => {
    if ( !(actor instanceof Actor) || seen.has(actor.uuid) ) return;
    seen.add(actor.uuid);
    actors.push(actor);
  };

  for ( const token of canvas.tokens?.controlled ?? [] ) push(token.actor);
  for ( const token of game.user?.targets ?? [] ) push(token.actor);
  return actors;
}

/**
 * @param {number} x
 * @param {number} y
 * @returns {Token|null}
 */
function findTokenAt(x, y) {
  if ( !canvas?.tokens?.quadtree || !Number.isFinite(x) || !Number.isFinite(y) ) return null;
  // Match core TokenLayer#_onDropActiveEffect hit testing, but also accept
  // non-visible tokens (e.g. currently invisible) so re-drops still work.
  const collisionTest = ({t: token}) => token.renderable
    && token.hitArea?.contains(x - token.x, y - token.y);
  return Array.from(canvas.tokens.quadtree.getObjects(new PIXI.Rectangle(x, y, 0, 0), {collisionTest}))
    .sort((a, b) => a._lastSortedIndex - b._lastSortedIndex)
    .at(0) ?? null;
}

/**
 * Pick the best Convenient Effect that represents a core status id.
 * @param {string} statusId
 * @returns {ActiveEffect|null}
 */
function findConvenientEffectForStatus(statusId) {
  const api = getApi();
  if ( !api?.findEffects || !statusId ) return null;

  const matches = (api.findEffects() ?? []).filter(effect => effect?.statuses?.has?.(statusId));
  if ( !matches.length ) return null;

  const single = matches.filter(effect => effect.statuses.size === 1);
  const pool = single.length ? single : matches;

  const status = CONFIG.statusEffects?.[statusId]
    ?? CONFIG.statusEffects?.find?.(entry => entry?.id === statusId);
  const statusName = status?.name ? game.i18n.localize(status.name) : "";

  if ( statusName ) {
    const byName = pool.find(effect => effect.name?.localeCompare(statusName, game.i18n.lang, {sensitivity: "accent"}) === 0);
    if ( byName ) return byName;
  }

  const byCeId = pool.find(effect => getCeEffectId(effect) === statusId);
  if ( byCeId ) return byCeId;

  return pool[0];
}

/** Pending HUD status IDs keyed by `${actor.uuid}:${ceEffectId}` for preCreate merge. */
const pendingStatusByEffect = new Map();

/**
 * @param {string} actorUuid
 * @param {string} effectId
 * @param {string} statusId
 */
function rememberPendingStatus(actorUuid, effectId, statusId) {
  if ( !actorUuid || !effectId || !statusId ) return;
  pendingStatusByEffect.set(`${actorUuid}:${effectId}`, statusId);
}

/**
 * @param {string} actorUuid
 * @param {string} effectId
 * @returns {string|undefined}
 */
function takePendingStatus(actorUuid, effectId) {
  if ( !actorUuid || !effectId ) return undefined;
  const key = `${actorUuid}:${effectId}`;
  const statusId = pendingStatusByEffect.get(key);
  pendingStatusByEffect.delete(key);
  return statusId;
}

/**
 * Enrich CE effects on actors so display + Active Token Effects (ATL) integrate.
 * - showIcon ALWAYS → Foundry draws icon → Simraki orbits/tooltips
 * - Mirror size/scale changes onto ATL.* keys so ATE can resize/restyle the token
 * - Merge template + HUD status IDs onto ActiveEffect.statuses before create so
 *   Vision 5e / Foundry detection modes see blinded, invisible, etc.
 * @param {ActiveEffect} effect
 * @param {object} data
 */
function enrichConvenientEffectOnActor(effect, data) {
  if ( !(effect.parent instanceof Actor) ) return;
  if ( !isConvenientEffect(data) && !getCeEffectId(data) ) return;

  const patch = {};
  const always = CONST.ACTIVE_EFFECT_SHOW_ICON.ALWAYS;
  if ( data.showIcon !== always ) patch.showIcon = always;

  const ceId = getCeEffectId(data) ?? getCeEffectId(effect);
  const template = ceId ? getApi()?.findEffect?.({effectId: ceId}) : null;
  const pendingStatus = takePendingStatus(effect.parent.uuid, ceId);
  const existingStatuses = Array.isArray(data.statuses)
    ? data.statuses
    : [...(data.statuses ?? effect.statuses ?? [])];
  const mergedStatuses = new Set([
    ...existingStatuses,
    ...(template?.statuses ?? []),
    ...(pendingStatus ? [pendingStatus] : []),
    ...statusIdsMatchingEffectName(data.name ?? effect.name ?? template?.name)
  ]);
  if ( mergedStatuses.size && (
    existingStatuses.length !== mergedStatuses.size
    || existingStatuses.some(statusId => !mergedStatuses.has(statusId))
  ) ) {
    patch.statuses = [...mergedStatuses];
  }

  if ( game.modules.get("ATL")?.active ) {
    const atlChanges = buildAtlCompanionChanges(data.changes ?? []);
    if ( atlChanges.length ) {
      patch.changes = foundry.utils.deepClone(data.changes ?? []).concat(atlChanges);
    }
  }

  if ( !foundry.utils.isEmpty(patch) ) effect.updateSource(patch);
}

/**
 * Map CE / Foundry token size-scale changes to Active Token Effects keys.
 * @param {object[]} changes
 * @returns {object[]}
 */
function buildAtlCompanionChanges(changes) {
  const existing = new Set((changes ?? []).map(change => change.key));
  const companions = [];

  const sizeChange = (changes ?? []).find(change => change.key === "system.traits.size");
  if ( sizeChange && !existing.has("ATL.width") && !existing.has("ATL.height") ) {
    const sizeKey = String(sizeChange.value);
    const dim = Number(CONFIG.DND5E?.actorSizes?.[sizeKey]?.token);
    if ( Number.isFinite(dim) && dim > 0 ) {
      const mode = sizeChange.mode ?? CONST.ACTIVE_EFFECT_MODES.OVERRIDE;
      const priority = sizeChange.priority;
      companions.push(
        {key: "ATL.width", mode, value: String(dim), priority},
        {key: "ATL.height", mode, value: String(dim), priority}
      );
    }
  }

  const scaleX = (changes ?? []).find(change => change.key === "token.texture.scaleX");
  if ( scaleX && !existing.has("ATL.scale") ) {
    companions.push({
      key: "ATL.scale",
      mode: scaleX.mode ?? CONST.ACTIVE_EFFECT_MODES.MULTIPLY,
      value: scaleX.value,
      priority: scaleX.priority
    });
  }

  return companions;
}

/** @type {Map<string, {actor: Actor, statusIds: Set<string>}>} */
const pendingSideEffectSync = new Map();

/**
 * @param {Actor} actor
 * @param {Iterable<string>} [statusIds]
 */
function queueConditionSideEffectSync(actor, statusIds=[]) {
  if ( !actor?.uuid ) return;
  const pending = pendingSideEffectSync.get(actor.uuid) ?? {actor, statusIds: new Set()};
  for ( const statusId of statusIds ) {
    if ( statusId ) pending.statusIds.add(statusId);
  }
  if ( pendingSideEffectSync.has(actor.uuid) ) return;
  pendingSideEffectSync.set(actor.uuid, pending);
  queueMicrotask(() => {
    const queued = pendingSideEffectSync.get(actor.uuid);
    pendingSideEffectSync.delete(actor.uuid);
    if ( !queued ) return;
    // Wait until Actor#prepareData has incorporated ActiveEffect.statuses.
    requestAnimationFrame(() => {
      void syncConditionSideEffects(queued.actor, queued.statusIds);
    });
  });
}

/**
 * Re-run Active Token Effects / token AE display after condition apply/remove.
 * @param {Actor} actor
 * @param {Iterable<string>} statusIds
 */
async function syncConditionSideEffects(actor, statusIds) {
  if ( !actor ) return;

  try {
    await pulseActiveTokenEffects(actor);
  }
  catch (error) {
    log(`ATL sync failed: ${error?.message || error}`, "warn");
  }

  try {
    refreshTokenActiveEffectDisplay(actor);
  }
  catch (error) {
    log(`Token AE refresh failed: ${error?.message || error}`, "warn");
  }

  try {
    refreshConditionPerception(actor, statusIds);
  }
  catch (error) {
    log(`Condition perception refresh failed: ${error?.message || error}`, "warn");
  }
}

/**
 * Match CONFIG.statusEffects ids by localized effect name (Blinded → blinded).
 * @param {string} [effectName]
 * @returns {string[]}
 */
function statusIdsMatchingEffectName(effectName) {
  if ( !effectName ) return [];
  const entries = Array.isArray(CONFIG.statusEffects)
    ? CONFIG.statusEffects
    : Object.entries(CONFIG.statusEffects ?? {}).map(([id, value]) => {
      return typeof value === "string" ? {id, name: value} : {id, ...(value ?? {})};
    });

  return entries.filter(entry => {
    if ( !entry?.id || !entry?.name ) return false;
    const localized = game.i18n.localize(entry.name);
    return effectName.localeCompare(localized, game.i18n.lang, {sensitivity: "accent"}) === 0
      || effectName.localeCompare(entry.id, game.i18n.lang, {sensitivity: "accent"}) === 0;
  }).map(entry => entry.id);
}

/**
 * Re-run Foundry / Vision 5e special-status handling after CE socket updates.
 * Vision 5e reads TokenDocument#hasStatusEffect for blindness, invisibility,
 * special senses, and imprecise ("swirly") detection.
 * @param {Actor} actor
 * @param {Iterable<string>} statusIds
 */
function refreshConditionPerception(actor, statusIds) {
  const ids = new Set([...(statusIds ?? [])].filter(Boolean));
  // Always include currently derived special statuses for this actor.
  for ( const statusId of Object.values(CONFIG.specialStatusEffects ?? {}) ) {
    if ( actor.statuses?.has?.(statusId) ) ids.add(statusId);
  }

  for ( const token of actor.getActiveTokens(true) ) {
    if ( !token || token.destroyed ) continue;
    for ( const statusId of ids ) {
      const active = token.document?.hasStatusEffect?.(statusId) ?? actor.statuses.has(statusId);
      // Invisibility filter needs mesh; other status handlers are still safe.
      if ( statusId === CONFIG.specialStatusEffects?.INVISIBLE && !token.mesh ) continue;
      token._onApplyStatusEffect?.(statusId, active);
    }

    if ( ids.has(CONFIG.specialStatusEffects?.BLIND)
      || ids.has(CONFIG.specialStatusEffects?.BLINDED)
      || ids.has("blinded") ) {
      token.initializeVisionSource?.();
    }

    token.renderFlags?.set({refreshState: true, refreshVisibility: true});
  }

  // Observers must re-test visibility against the changed token.
  for ( const token of canvas.tokens?.placeables ?? [] ) {
    token.renderFlags?.set({refreshVisibility: true});
  }

  canvas.perception?.update({
    initializeVision: true,
    refreshVision: true,
    refreshSounds: true,
    refreshOcclusion: true
  });
}

/**
 * ATL does not export applyEffects; its updateActiveEffect hook recomputes all ATL
 * changes whenever any effect on the actor updates — pulse a stamp flag to trigger it.
 * @param {Actor} actor
 */
async function pulseActiveTokenEffects(actor) {
  if ( !game.modules.get("ATL")?.active ) return;
  if ( !game.user.isGM ) return;

  const effect = actor.effects.find(entry => {
    return !entry.disabled && entry.changes?.some(change => String(change.key).startsWith("ATL."));
  });
  if ( !effect ) return;

  await effect.setFlag(WRAPPER_ID, "atlPulse", Date.now());
}

/**
 * Refresh placeable tokens so Foundry `token.*` AE overrides (scale/light/etc.) paint.
 * Avoid full document.reset() — it races Simraki icon binding / tooltips.
 * @param {Actor} actor
 */
function refreshTokenActiveEffectDisplay(actor) {
  const needsTokenRefresh = actor.appliedEffects.some(effect => {
    return !effect.disabled && effect.changes?.some(change => {
      const key = String(change.key);
      return key.startsWith("token.") || key.startsWith("ATL.");
    });
  });
  if ( !needsTokenRefresh ) return;

  for ( const token of actor.getActiveTokens(true) ) {
    token.renderFlags?.set({
      refreshMesh: true,
      refreshSize: true,
      refreshShape: true,
      refreshState: true
    });
  }
}

/**
 * @param {ActiveEffect} effect
 * @returns {Actor|null}
 */
function actorFromEffect(effect) {
  if ( effect?.parent instanceof Actor ) return effect.parent;
  if ( effect?.parent?.parent instanceof Actor ) return effect.parent.parent;
  return null;
}

/**
 * Repair already-applied CE effects that are invisible on tokens (no icon → no SRE tooltip).
 * @returns {Promise<number>}
 */
async function repairExistingConvenientEffects() {
  if ( !game.user.isGM ) return 0;

  const always = CONST.ACTIVE_EFFECT_SHOW_ICON.ALWAYS;
  let repaired = 0;

  /** @param {Actor} actor */
  const repairActor = async actor => {
    if ( !actor?.isOwner && !game.user.isGM ) return;
    const updates = [];
    for ( const effect of actor.effects ) {
      if ( !isConvenientEffect(effect) ) continue;
      const update = {_id: effect.id};
      if ( effect.showIcon !== always ) update.showIcon = always;

      const effectId = getCeEffectId(effect);
      const source = effectId ? getApi()?.findEffect?.({effectId}) : null;
      const sourceStatuses = source?.statuses ?? [];
      const missingStatuses = [...sourceStatuses].filter(statusId => !effect.statuses.has(statusId));
      if ( missingStatuses.length ) {
        update.statuses = [...new Set([...effect.statuses, ...missingStatuses])];
      }

      if ( Object.keys(update).length > 1 ) updates.push(update);
    }
    if ( !updates.length ) return;
    await actor.updateEmbeddedDocuments("ActiveEffect", updates);
    queueConditionSideEffectSync(actor, updates.flatMap(update => update.statuses ?? []));
    repaired += updates.length;
  };

  for ( const actor of game.actors ) await repairActor(actor);

  for ( const token of canvas.tokens?.placeables ?? [] ) {
    const actor = token.actor;
    if ( !actor || game.actors.get(actor.id) === actor ) continue; // linked already handled
    await repairActor(actor);
  }

  return repaired;
}

/**
 * @param {Actor} actor
 * @param {string} effectId
 * @param {{overlay?: boolean, active?: boolean, statusId?: string}} [options]
 * @returns {Promise<boolean|undefined>}
 */
async function applyStatusViaConvenientEffects(actor, effectId, {overlay=false, active, statusId}={}) {
  const api = getApi();
  if ( !api || !actor || !effectId ) return undefined;

  const uuid = actor.uuid;
  const applied = api.hasEffectApplied({effectId, uuid}) === true;

  if ( applied ) {
    if ( active === true ) return true;
    await api.removeEffect({effectId, uuid});
    queueConditionSideEffectSync(actor, statusId ? [statusId] : []);
    return false;
  }

  if ( active === false ) return undefined;

  // Remember HUD status before CE socket create so preCreate can merge it.
  if ( statusId ) rememberPendingStatus(uuid, effectId, statusId);
  await api.addEffect({effectId, uuid, overlay});

  // Belt-and-suspenders if preCreate ran before rememberPendingStatus (rare race).
  if ( statusId ) {
    const appliedEffect = actor.effects.find(effect => {
      return !effect.disabled && getCeEffectId(effect) === effectId;
    });
    if ( appliedEffect && !appliedEffect.statuses.has(statusId) ) {
      await appliedEffect.update({statuses: [...appliedEffect.statuses, statusId]});
    }
  }

  queueConditionSideEffectSync(actor, statusId ? [statusId] : []);
  return true;
}

/**
 * Redirect Token HUD / Actor#toggleStatusEffect through CE when a matching
 * convenient condition exists.
 * @param {Function} wrapped
 * @param {string} statusId
 * @param {{active?: boolean, overlay?: boolean}} [options]
 */
async function toggleStatusEffectWrapper(wrapped, statusId, options={}) {
  const ceEffect = findConvenientEffectForStatus(statusId);
  if ( !ceEffect ) return wrapped(statusId, options);

  const effectId = getCeEffectId(ceEffect) ?? ceEffect.id;
  if ( !effectId ) return wrapped(statusId, options);

  try {
    const result = await applyStatusViaConvenientEffects(this, effectId, {...options, statusId});
    // CE had no matching applied effect to remove — clear a bare core stub if present.
    if ( result === undefined && options.active === false ) return wrapped(statusId, options);
    return result;
  }
  catch (error) {
    log(`Status redirect failed for "${statusId}": ${error?.message || error}`, "error");
    console.error(error);
    return wrapped(statusId, options);
  }
}

/**
 * Status IDs carried by a CE template effect.
 * @param {string} effectId
 * @returns {string[]}
 */
function statusesForCeEffect(effectId) {
  const template = effectId ? getApi()?.findEffect?.({effectId}) : null;
  return template ? [...(template.statuses ?? [])] : [];
}

/**
 * Canvas ActiveEffect drops → CE API when the payload is a convenient effect.
 * @param {Function} wrapped
 * @param {DragEvent} event
 * @param {object} data
 */
async function tokenLayerDropActiveEffectWrapper(wrapped, event, data) {
  const effectId = resolveCeEffectIdFromDropData(data);
  if ( !effectId ) return wrapped(event, data);

  const actors = resolveDropActors(data).filter(actor => actor.isOwner || game.user.isGM);
  if ( !actors.length ) {
    // Never swallow the drop — let core create the effect if we cannot target anyone.
    return wrapped(event, data);
  }

  for ( const actor of actors ) {
    await getApi().addEffect({effectId, uuid: actor.uuid});
    queueConditionSideEffectSync(actor, statusesForCeEffect(effectId));
  }
}

/**
 * Actor sheet ActiveEffect drops → CE API for convenient effects.
 * @param {Function} wrapped
 * @param {DragEvent} event
 * @param {object|ActiveEffect} dataOrEffect
 */
async function actorSheetDropActiveEffectWrapper(wrapped, event, dataOrEffect) {
  // V1 sheets pass drag data; V2 may pass an ActiveEffect document.
  let effectId = null;
  if ( dataOrEffect instanceof ActiveEffect ) {
    if ( isConvenientEffect(dataOrEffect) || getCeEffectId(dataOrEffect) ) {
      effectId = getCeEffectId(dataOrEffect) ?? dataOrEffect.id;
    }
  }
  else {
    effectId = resolveCeEffectIdFromDropData(dataOrEffect);
  }

  if ( !effectId ) return wrapped(event, dataOrEffect);

  const actor = this.actor ?? this.document;
  if ( !(actor instanceof Actor) ) return wrapped(event, dataOrEffect);
  if ( !actor.isOwner ) return null;

  await getApi().addEffect({effectId, uuid: actor.uuid});
  queueConditionSideEffectSync(actor, statusesForCeEffect(effectId));
  return true;
}

/**
 * CE nested-effect drags use `{ effectId }` without `type: "ActiveEffect"`,
 * so core canvas drop ignores them. Handle those here.
 * @param {Canvas} _canvas
 * @param {object} data
 * @returns {boolean|void}
 */
function onDropCanvasData(_canvas, data) {
  if ( !data?.effectId || data.type ) return;
  if ( !getApi() ) return;

  const actors = resolveDropActors(data).filter(actor => actor.isOwner || game.user.isGM);
  if ( !actors.length ) {
    ui.notifications.warn("Drop onto a token, or select a token first, to apply this effect.");
    return false;
  }

  for ( const actor of actors ) {
    void getApi().addEffect({effectId: data.effectId, uuid: actor.uuid}).then(() => {
      queueConditionSideEffectSync(actor, statusesForCeEffect(data.effectId));
    });
  }
  return false;
}

/**
 * @param {string} target
 * @param {Function} wrapper
 * @param {"MIXED"|"WRAPPER"|"OVERRIDE"} [type]
 * @returns {boolean}
 */
function registerWrap(target, wrapper, type="MIXED") {
  if ( typeof libWrapper?.register === "function" && game.modules.get("lib-wrapper")?.active ) {
    libWrapper.register(WRAPPER_ID, target, wrapper, type);
    return true;
  }

  // Minimal fallback when libWrapper is unavailable.
  const parts = target.split(".");
  const methodName = parts.pop();
  const parentPath = parts.join(".");
  const parent = parentPath.split(".").reduce((obj, key) => obj?.[key], globalThis);
  const original = parent?.[methodName];
  if ( typeof original !== "function" ) {
    log(`Could not wrap ${target}`, "warn");
    return false;
  }
  parent[methodName] = function jinxedFallbackWrap(...args) {
    return wrapper.call(this, original.bind(this), ...args);
  };
  return true;
}

/**
 * Apply Convenient Effects integration bridges.
 */
export function applyConvenientEffectsTweaks() {
  if ( !getApi() ) {
    log("CE API missing; skip bridges", "warn");
    return;
  }

  Hooks.on("preCreateActiveEffect", (effect, data) => {
    try {
      enrichConvenientEffectOnActor(effect, data);
    }
    catch (error) {
      log(`CE enrich failed: ${error?.message || error}`, "warn");
    }
  });

  // CE applies effects through socketlib as the active GM. Run these on every
  // client, not only `userId`, so each player's local Vision 5e canvas refreshes.
  Hooks.on("createActiveEffect", effect => {
    if ( !isConvenientEffect(effect) ) return;
    const actor = actorFromEffect(effect);
    if ( actor ) queueConditionSideEffectSync(actor, effect.statuses);
  });

  Hooks.on("deleteActiveEffect", effect => {
    if ( !isConvenientEffect(effect) ) return;
    const actor = actorFromEffect(effect);
    if ( actor ) queueConditionSideEffectSync(actor, effect.statuses);
  });

  Hooks.on("updateActiveEffect", (effect, changed) => {
    if ( !isConvenientEffect(effect) ) return;
    if ( changed.disabled === undefined
      && !foundry.utils.hasProperty(changed, "changes")
      && !foundry.utils.hasProperty(changed, "statuses") ) return;
    const actor = actorFromEffect(effect);
    if ( actor ) queueConditionSideEffectSync(actor, effect.statuses);
  });

  registerWrap(
    "CONFIG.Actor.documentClass.prototype.toggleStatusEffect",
    toggleStatusEffectWrapper
  );

  registerWrap(
    "foundry.canvas.layers.TokenLayer.prototype._onDropActiveEffect",
    tokenLayerDropActiveEffectWrapper
  );

  // Actor sheet drop path (V2). dnd5e actor sheets call super into this.
  registerWrap(
    "foundry.applications.sheets.ActorSheetV2.prototype._onDropActiveEffect",
    actorSheetDropActiveEffectWrapper
  );
  if ( foundry.appv1?.sheets?.ActorSheet?.prototype?._onDropActiveEffect ) {
    registerWrap(
      "foundry.appv1.sheets.ActorSheet.prototype._onDropActiveEffect",
      actorSheetDropActiveEffectWrapper
    );
  }

  Hooks.on("dropCanvasData", onDropCanvasData);

  void repairExistingConvenientEffects().then(count => {
    if ( count > 0 ) log(`Repaired display/status data on ${count} existing convenient effect(s)`);
  });

  log("Status HUD + canvas/sheet drop bridges enabled");
}
