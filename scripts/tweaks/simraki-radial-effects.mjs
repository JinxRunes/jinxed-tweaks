/**
 * Simraki Radial Effects — tooltip bindings + sticky settings.
 *
 * 1) Upstream binds `sprite[SRE_ActiveEffect] = activeEffects[sprite.zIndex]`.
 *    After CE (and other) redraws, zIndex often does not line up with the filtered
 *    sprite list, so EFFECT is null and InteractionHandler skips the icon entirely
 *    (no tooltip, no click).
 *
 * 2) Our ready-phase hook often registers AFTER the first `canvasReady`, so token
 *    repair must also run immediately when the tweak applies.
 *
 * 3) Upstream `Require Alt` is checked only in `onPointerMove` (hover/tooltips),
 *    not in `onPointerDown` (clicks). Table rule: Alt must gate click-to-delete /
 *    disable, while tooltips stay on plain hover. We rebind InteractionHandler
 *    and always require Alt for mutating clicks (not only when the setting is on).
 *
 * 4) Most Simraki prefs are `scope: "client"` (localStorage). Re-scope to `user`
 *    so they persist on the Foundry user document.
 */

const MODULE_ID = "simraki-radial-effects";
const WRAPPER_ID = "jinxed-tweaks";

const SRE_FLAGS = {
  IS_CONTAINER: "SRE_IsContainer",
  IS_PROCESSED: "SRE_IsProcessed",
  EFFECT: "SRE_ActiveEffect",
  BG_PARAMS: "SRE_BackgroundParams"
};

/** Upstream client-scoped keys that should persist per Foundry user instead. */
const CLIENT_TO_USER_SETTINGS = [
  "interactionRequireAlt",
  "effectShape",
  "effectBgColor",
  "effectBorderColor",
  "effectSizeMultiplier",
  "effectOpacity",
  "orbitShape",
  "orbitSpacing",
  "orbitStartAngle",
  "orbitBaseRadiusMultiplier",
  "orbitReverseDirection",
  "hoverEnableAnimation",
  "tooltipDelay"
];

/** Captured Simraki InteractionHandler instance (install wrapper). */
let interactionHandler = null;

function log(message, level="log") {
  console[level](`jinxed-tweaks | simraki-radial-effects | ${message}`);
}

/**
 * Move one Simraki setting from brittle client localStorage onto the user doc.
 * @param {string} key
 */
async function migrateSettingToUserScope(key) {
  const settingId = `${MODULE_ID}.${key}`;
  const cfg = game.settings.settings.get(settingId);
  if ( !cfg ) {
    log(`${key} setting not registered`, "warn");
    return;
  }
  if ( cfg.scope === "user" ) return;

  const clientStorage = game.settings.storage.get("client");
  const hasClientValue = Boolean(clientStorage?.getItem?.(settingId));
  let clientValue;
  try {
    clientValue = game.settings.get(MODULE_ID, key);
  }
  catch (error) {
    log(`Could not read ${key}: ${error?.message || error}`, "warn");
    clientValue = cfg.default;
  }

  cfg.scope = "user";

  const existing = game.settings.storage.get("world")?.getSetting?.(settingId, game.userId);
  if ( existing ) {
    existing.reset?.();
    return;
  }

  try {
    const value = hasClientValue ? clientValue : (cfg.default ?? clientValue);
    await game.settings.set(MODULE_ID, key, value);
    log(`Persisted ${key} as user-scoped`);
  }
  catch (error) {
    log(`Failed to persist ${key}: ${error?.message || error}`, "error");
    console.error(error);
  }
}

/**
 * Re-scope all Simraki client prefs to the Foundry user document.
 */
async function migrateClientSettingsToUser() {
  for ( const key of CLIENT_TO_USER_SETTINGS ) {
    await migrateSettingToUserScope(key);
  }
}

/**
 * Same visibility filter Foundry / Simraki use for token effect icons.
 * @param {Actor} actor
 * @returns {ActiveEffect[]}
 */
function getDrawableEffects(actor) {
  const SHOW = CONST.ACTIVE_EFFECT_SHOW_ICON;
  return actor?.appliedEffects?.filter(effect => {
    return (effect.showIcon === SHOW.ALWAYS)
      || ((effect.showIcon === SHOW.CONDITIONAL) && effect.isTemporary);
  }) ?? [];
}

/**
 * Best-effort texture src from a Simraki icon container / sprite.
 * @param {PIXI.Container|PIXI.Sprite} sprite
 * @returns {string}
 */
function spriteImageSrc(sprite) {
  const icon = sprite?.texture
    ? sprite
    : sprite?.children?.find?.(child => child?.texture);
  const base = icon?.texture?.baseTexture;
  return base?.resource?.src
    || base?.resource?.url
    || icon?.texture?.label
    || "";
}

/**
 * Simraki's own sprite filter from EffectManager.applyToToken.
 * @param {Token} token
 * @returns {PIXI.DisplayObject[]}
 */
function getSimrakiEffectSprites(token) {
  const bg = token.effects?.bg;
  if ( !token?.effects?.children ) return [];
  return token.effects.children.filter(child => {
    if ( child === bg || child === token.effects.overlay ) return false;
    return (!child[SRE_FLAGS.IS_PROCESSED] && child instanceof PIXI.Sprite)
      || child[SRE_FLAGS.IS_CONTAINER]
      || child[SRE_FLAGS.EFFECT] !== undefined
      || child[SRE_FLAGS.BG_PARAMS];
  }).sort((a, b) => (a.zIndex ?? 0) - (b.zIndex ?? 0));
}

/** Flip modes that mirror Simraki's local orbit around the token center. */
const ORBIT_FLIP_MODES = ["none", "flipX", "flipY", "flipXY"];
/**
 * Stick with the current side unless another layout's crowd-facing score is
 * clearly better (dot-product units; larger = more decisive).
 */
const ORBIT_FLIP_HYSTERESIS = 8000;
/** Extra canvas px beyond token+orbit when collecting neighbors. */
const ORBIT_NEIGHBOR_PAD = 100;
/** Arc float duration when icons relocate around the token. */
const ORBIT_FLOAT_MS = 1100;
/** Skip animation when the local move is smaller than this (px). */
const ORBIT_FLOAT_MIN_DIST = 6;

/** Cached Simraki computeEffectOrbit importer. */
let computeEffectOrbitFn = null;

/**
 * @returns {Promise<Function|null>}
 */
async function getComputeEffectOrbit() {
  if ( computeEffectOrbitFn ) return computeEffectOrbitFn;
  try {
    const mod = await import(`/modules/${MODULE_ID}/scripts/effectOrbit.js`);
    computeEffectOrbitFn = mod.computeEffectOrbit;
  }
  catch (error) {
    log(`Could not import computeEffectOrbit: ${error?.message || error}`, "warn");
    computeEffectOrbitFn = null;
  }
  return computeEffectOrbitFn;
}

/**
 * Simraki places icons around (centerOffset, centerOffset) in token.effects space.
 * @param {Token} token
 * @returns {{cx: number, cy: number}}
 */
function getSimrakiOrbitCenterLocal(token) {
  const gridSize = canvas.grid?.size ?? 100;
  const tokenSize = Math.min(token.document?.width ?? 1, token.document?.height ?? 1);
  const centerOffset = (gridSize * tokenSize) / 2;
  return {cx: centerOffset, cy: centerOffset};
}

/**
 * @param {number} x
 * @param {number} y
 * @param {number} cx
 * @param {number} cy
 * @param {string} mode
 * @returns {{x: number, y: number}}
 */
function transformOrbitLocal(x, y, cx, cy, mode) {
  let dx = x - cx;
  let dy = y - cy;
  if ( mode === "flipX" || mode === "flipXY" ) dx = -dx;
  if ( mode === "flipY" || mode === "flipXY" ) dy = -dy;
  return {x: cx + dx, y: cy + dy};
}

/**
 * Nearby creature tokens that could crowd this token's radial icons.
 * Call only after movement has settled so placeable centers match the grid.
 * @param {Token} token
 * @param {number} orbitReach
 * @returns {Token[]}
 */
function getOrbitNeighborTokens(token, orbitReach) {
  const placeables = canvas.tokens?.placeables ?? [];
  if ( !placeables.length || !token?.center ) return [];
  const tc = token.center;
  const maxDist = (Math.max(token.w, token.h) * 0.5)
    + orbitReach
    + ORBIT_NEIGHBOR_PAD;

  return placeables.filter(other => {
    if ( !other || other === token || other.destroyed ) return false;
    if ( other.document?.hidden && !game.user?.isGM ) return false;
    if ( !other.center ) return false;
    const oc = other.center;
    const dist = Math.hypot(oc.x - tc.x, oc.y - tc.y);
    const otherR = Math.max(other.w, other.h) * 0.5;
    return dist <= (maxDist + otherR);
  });
}

/**
 * Write canonical (unflipped) Simraki orbit locals onto sprites.
 * @param {Token} token
 * @returns {boolean}
 */
function stashCanonicalOrbitBases(token) {
  const sprites = getSimrakiEffectSprites(token);
  if ( !sprites.length ) return false;

  if ( computeEffectOrbitFn ) {
    let orbit;
    try {
      orbit = computeEffectOrbitFn(token, sprites.length);
    }
    catch (error) {
      log(`computeEffectOrbit failed: ${error?.message || error}`, "warn");
      orbit = null;
    }
    if ( orbit?.list?.length ) {
      const cx = orbit.centerOffset ?? getSimrakiOrbitCenterLocal(token).cx;
      const cy = orbit.centerOffset ?? getSimrakiOrbitCenterLocal(token).cy;
      for ( let i = 0; i < sprites.length; i++ ) {
        const sprite = sprites[i];
        const pt = orbit.list[i] ?? orbit.list[orbit.list.length - 1];
        const prev = sprite[SRE_FLAGS.BG_PARAMS] ?? {};
        sprite[SRE_FLAGS.BG_PARAMS] = {
          ...prev,
          baseX: pt.x,
          baseY: pt.y,
          orbitCx: cx,
          orbitCy: cy,
          slotSize: prev.slotSize || orbit.iconSize || Math.max(sprite.width, sprite.height, 20),
          gridScale: prev.gridScale ?? orbit.gridScale
        };
      }
      return true;
    }
  }

  const {cx, cy} = getSimrakiOrbitCenterLocal(token);
  for ( const sprite of sprites ) {
    const prev = sprite[SRE_FLAGS.BG_PARAMS] ?? {};
    sprite[SRE_FLAGS.BG_PARAMS] = {
      ...prev,
      baseX: sprite.position.x,
      baseY: sprite.position.y,
      orbitCx: cx,
      orbitCy: cy,
      slotSize: prev.slotSize || Math.max(sprite.width, sprite.height, 20)
    };
  }
  return true;
}

/**
 * How much a layout's icon cluster faces the crowd (lower / more negative = better).
 * @param {Token} token
 * @param {{x:number,y:number}[]} points
 * @param {Token[]} neighbors
 * @returns {number}
 */
function scoreOrbitFacing(token, points, neighbors) {
  if ( !neighbors.length || !token.effects || !points.length ) return 0;
  const tc = token.center;
  let nx = 0;
  let ny = 0;
  for ( const neighbor of neighbors ) {
    nx += neighbor.center.x - tc.x;
    ny += neighbor.center.y - tc.y;
  }
  let ix = 0;
  let iy = 0;
  for ( const point of points ) {
    const global = token.effects.toGlobal(new PIXI.Point(point.x, point.y));
    ix += global.x - tc.x;
    iy += global.y - tc.y;
  }
  return (ix * nx) + (iy * ny);
}

/** @type {WeakMap<Token, Map<PIXI.DisplayObject, Function>>} */
const orbitFloatTickers = new WeakMap();
/** @type {Map<string, Promise<void>>} */
const orbitMoveWaiters = new Map();
/** @type {Map<string, number>} */
const orbitMoveGenerations = new Map();

/**
 * @param {Token} token
 * @returns {boolean}
 */
function isOrbitFloatActive(token) {
  const map = orbitFloatTickers.get(token);
  return Boolean(map?.size);
}

/**
 * @param {number} t 0..1
 * @returns {number}
 */
function easeInOutCubic(t) {
  return t < 0.5
    ? 4 * t * t * t
    : 1 - ((Math.pow((-2 * t) + 2, 3)) / 2);
}

/**
 * @param {Token} token
 * @param {PIXI.DisplayObject} sprite
 */
function stopOrbitFloat(token, sprite) {
  const map = orbitFloatTickers.get(token);
  const tick = map?.get(sprite);
  if ( !tick ) return;
  canvas.app?.ticker?.remove(tick);
  map.delete(sprite);
}

/**
 * @param {Token} token
 */
function stopAllOrbitFloats(token) {
  const map = orbitFloatTickers.get(token);
  if ( !map ) return;
  for ( const sprite of [...map.keys()] ) stopOrbitFloat(token, sprite);
}

/**
 * Unit vector in effects-local space pointing away from the crowding neighbors.
 * @param {Token} token
 * @param {Token[]} neighbors
 * @param {number} cx
 * @param {number} cy
 * @returns {{x: number, y: number}}
 */
function getOrbitFleeDirectionLocal(token, neighbors, cx, cy) {
  if ( !neighbors.length || !token.effects ) return {x: 0, y: -1};
  const tc = token.center;
  let wx = 0;
  let wy = 0;
  for ( const neighbor of neighbors ) {
    wx += tc.x - neighbor.center.x;
    wy += tc.y - neighbor.center.y;
  }
  // Convert a short world-space away vector into effects-local via toLocal.
  const worldAway = new PIXI.Point(tc.x + wx, tc.y + wy);
  const localAway = token.effects.toLocal(worldAway);
  let dx = localAway.x - cx;
  let dy = localAway.y - cy;
  const len = Math.hypot(dx, dy);
  if ( len < 1e-3 ) return {x: 0, y: -1};
  return {x: dx / len, y: dy / len};
}

/**
 * Slide icons from→to with one shared “bow away from crowd” — keeps the cluster
 * cohesive. Per-icon polar arcs were picking opposite CW/CCW paths and looked like
 * icons exploding, especially while the parent token was still sliding.
 * @param {Token} token
 * @param {PIXI.DisplayObject} sprite
 * @param {{x:number,y:number}} from
 * @param {{x:number,y:number}} to
 * @param {{x:number,y:number}} fleeDir
 * @param {number} lift
 * @param {boolean} animate
 */
function floatOrbitSprite(token, sprite, from, to, fleeDir, lift, animate) {
  stopOrbitFloat(token, sprite);

  const dist = Math.hypot(to.x - from.x, to.y - from.y);
  if ( !animate || dist < ORBIT_FLOAT_MIN_DIST || !canvas.app?.ticker ) {
    sprite.position.set(to.x, to.y);
    return;
  }

  const start = performance.now();
  const tick = () => {
    if ( !sprite.parent ) {
      stopOrbitFloat(token, sprite);
      return;
    }
    const t = Math.min(1, (performance.now() - start) / ORBIT_FLOAT_MS);
    const e = easeInOutCubic(t);
    const bow = Math.sin(Math.PI * e) * lift;
    sprite.position.set(
      from.x + ((to.x - from.x) * e) + (fleeDir.x * bow),
      from.y + ((to.y - from.y) * e) + (fleeDir.y * bow)
    );
    if ( t >= 1 ) {
      sprite.position.set(to.x, to.y);
      stopOrbitFloat(token, sprite);
    }
  };

  let map = orbitFloatTickers.get(token);
  if ( !map ) {
    map = new Map();
    orbitFloatTickers.set(token, map);
  }
  map.set(sprite, tick);
  canvas.app.ticker.add(tick);
}

/**
 * Flip the radial cluster away from crowding neighbors when that reduces overlap.
 * @param {Token} token
 * @param {{animate?: boolean, refreshBases?: boolean, skipPositions?: boolean}} [options]
 */
function applyOrbitNeighborAvoidance(token, options={}) {
  if ( !token?.effects || !game.modules.get(MODULE_ID)?.active ) return;
  const sprites = getSimrakiEffectSprites(token);
  if ( !sprites.length ) return;

  if ( options.refreshBases !== false ) stashCanonicalOrbitBases(token);

  // While a post-move float is queued for this token, Simraki may redraw effects.
  // Keep the current flip side snapped (no new animation / no mode change) so the
  // queued settle handler can still animate a real none→flip transition.
  if ( options.animate === false && token.id && orbitMoveWaiters.has(token.id) ) {
    const holdMode = token._jinxedOrbitFlip || "none";
    const holdCx = Number.isFinite(
      sprites[0]?.[SRE_FLAGS.BG_PARAMS]?.orbitCx
    ) ? sprites[0][SRE_FLAGS.BG_PARAMS].orbitCx : getSimrakiOrbitCenterLocal(token).cx;
    const holdCy = Number.isFinite(
      sprites[0]?.[SRE_FLAGS.BG_PARAMS]?.orbitCy
    ) ? sprites[0][SRE_FLAGS.BG_PARAMS].orbitCy : getSimrakiOrbitCenterLocal(token).cy;
    for ( const sprite of sprites ) {
      const bp = sprite[SRE_FLAGS.BG_PARAMS] ?? {};
      const x = Number.isFinite(bp.baseX) ? bp.baseX : sprite.position.x;
      const y = Number.isFinite(bp.baseY) ? bp.baseY : sprite.position.y;
      const target = transformOrbitLocal(x, y, holdCx, holdCy, holdMode);
      sprite.position.set(target.x, target.y);
    }
    return;
  }

  const animate = options.animate !== false;
  const firstBp = sprites[0]?.[SRE_FLAGS.BG_PARAMS] ?? {};
  const cx = Number.isFinite(firstBp.orbitCx) ? firstBp.orbitCx : getSimrakiOrbitCenterLocal(token).cx;
  const cy = Number.isFinite(firstBp.orbitCy) ? firstBp.orbitCy : getSimrakiOrbitCenterLocal(token).cy;
  const bases = sprites.map(sprite => {
    const bp = sprite[SRE_FLAGS.BG_PARAMS] ?? {};
    const x = Number.isFinite(bp.baseX) ? bp.baseX : sprite.position.x;
    const y = Number.isFinite(bp.baseY) ? bp.baseY : sprite.position.y;
    return {sprite, x, y, slotSize: bp.slotSize || Math.max(sprite.width, sprite.height, 20)};
  });

  let orbitReach = 0;
  for ( const base of bases ) {
    orbitReach = Math.max(orbitReach, Math.hypot(base.x - cx, base.y - cy) + (base.slotSize / 2));
  }
  const neighbors = getOrbitNeighborTokens(token, orbitReach);
  const previous = token._jinxedOrbitFlip || "none";

  let mode = "none";
  if ( neighbors.length ) {
    let bestMode = "none";
    let bestScore = Infinity;
    const scores = {};
    for ( const candidate of ORBIT_FLIP_MODES ) {
      const points = bases.map(base => transformOrbitLocal(base.x, base.y, cx, cy, candidate));
      const score = scoreOrbitFacing(token, points, neighbors);
      scores[candidate] = score;
      if ( score < bestScore ) {
        bestScore = score;
        bestMode = candidate;
      }
    }
    const previousScore = scores[previous] ?? Infinity;
    mode = (previousScore <= bestScore + ORBIT_FLIP_HYSTERESIS) ? previous : bestMode;
  }

  const modeChanged = mode !== previous;
  token._jinxedOrbitFlip = mode;

  // Effects redraw mid-float (common right after the owner finishes moving): keep
  // bookkeeping but do not yank sprites out from under the in-flight slide.
  if ( options.skipPositions || (!animate && isOrbitFloatActive(token)) ) return;

  const fleeDir = getOrbitFleeDirectionLocal(token, neighbors, cx, cy);
  let maxTravel = 0;
  const moves = bases.map(base => {
    const target = transformOrbitLocal(base.x, base.y, cx, cy, mode);
    const from = {x: base.sprite.position.x, y: base.sprite.position.y};
    const travel = Math.hypot(target.x - from.x, target.y - from.y);
    maxTravel = Math.max(maxTravel, travel);
    return {sprite: base.sprite, from, target, travel};
  });
  const lift = Math.max(24, maxTravel * 0.35);

  for ( const move of moves ) {
    floatOrbitSprite(
      token,
      move.sprite,
      move.from,
      move.target,
      fleeDir,
      lift,
      animate && modeChanged && move.travel >= ORBIT_FLOAT_MIN_DIST
    );
  }
}

/**
 * Re-score the mover and every nearby token that has radial icons.
 * @param {Token} token
 * @param {{animate?: boolean}} [options]
 */
function refreshOrbitAvoidanceAround(token, options={}) {
  if ( !token?.center ) return;
  const grid = canvas.grid?.size ?? 100;
  const radius = Math.max(token.w, token.h, grid) + (grid * 2) + ORBIT_NEIGHBOR_PAD;
  const tc = token.center;
  const animate = options.animate !== false;

  const affected = new Set([token]);
  for ( const other of canvas.tokens?.placeables ?? [] ) {
    if ( !other || other === token || other.destroyed || !other.center ) continue;
    const oc = other.center;
    const otherR = Math.max(other.w, other.h) * 0.5;
    if ( Math.hypot(oc.x - tc.x, oc.y - tc.y) <= (radius + otherR) ) affected.add(other);
  }

  for ( const entry of affected ) {
    try {
      // Owner-move path: clear any refresh-snapped mid-state before a clean slide.
      if ( animate ) stopAllOrbitFloats(entry);
      applyOrbitNeighborAvoidance(entry, {animate, refreshBases: true});
    }
    catch (error) {
      log(`Orbit avoidance failed on ${entry?.name}: ${error?.message || error}`, "warn");
    }
  }
}

/**
 * @param {TokenDocument} document
 * @returns {Token|null}
 */
function tokenFromDocument(document) {
  return document?.object
    ?? canvas.tokens?.get(document?.id)
    ?? null;
}

/**
 * @param {number} ms
 * @returns {Promise<void>}
 */
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * @returns {Promise<void>}
 */
function nextAnimationFrame() {
  return new Promise(resolve => requestAnimationFrame(() => resolve()));
}

/**
 * Foundry often creates movementAnimationPromise *after* the updateToken/moveToken
 * hooks return. Wait until the promise exists (or the token has clearly settled).
 * @param {TokenDocument} document
 * @param {object} [movement]
 * @returns {Promise<void>}
 */
async function waitForTokenMovementSettled(document, movement=null) {
  const id = document?.id;
  if ( !id ) return;

  // Poll briefly: placeable assigns document._movement.animation.ended after hooks.
  let ended = movement?.animation?.ended
    ?? document._movement?.animation?.ended
    ?? canvas.tokens?.get(id)?.movementAnimationPromise
    ?? null;

  for ( let i = 0; !ended && i < 45; i++ ) {
    await nextAnimationFrame();
    ended = document._movement?.animation?.ended
      ?? canvas.tokens?.get(id)?.movementAnimationPromise
      ?? null;
    const token = canvas.tokens?.get(id);
    if ( !token ) return;
    // No animation appeared and placeable already matches the document — settled.
    if ( i >= 8 && !ended ) {
      const dx = Math.abs((token.document?.x ?? token.x) - token.x);
      const dy = Math.abs((token.document?.y ?? token.y) - token.y);
      if ( dx < 1 && dy < 1 ) break;
    }
  }

  if ( ended?.then ) {
    try {
      await ended;
    }
    catch {
      // cancelled / interrupted move
    }
  }

  // Let Foundry flush refreshEffects / source init that runs on animation end.
  await nextAnimationFrame();
  await nextAnimationFrame();
  await delay(48);
}

/**
 * Wait until Foundry finishes sliding this token, then re-score once.
 * Coalesces rapid updates by generation so only the latest settle wins.
 * @param {TokenDocument} document
 * @param {object} [movement]
 */
function scheduleOrbitAvoidanceAfterMove(document, movement=null) {
  const id = document?.id;
  if ( !id ) return;
  const generation = (orbitMoveGenerations.get(id) ?? 0) + 1;
  orbitMoveGenerations.set(id, generation);

  const job = (async () => {
    try {
      await waitForTokenMovementSettled(document, movement);
      if ( orbitMoveGenerations.get(id) !== generation ) return;
      const live = canvas.tokens?.get(id);
      if ( live ) refreshOrbitAvoidanceAround(live, {animate: true});
    }
    catch (error) {
      log(`Post-move orbit avoidance failed: ${error?.message || error}`, "warn");
    }
    finally {
      if ( orbitMoveGenerations.get(id) === generation ) orbitMoveWaiters.delete(id);
    }
  })();

  orbitMoveWaiters.set(id, job);
}

/**
 * Force each radial icon to point at the correct ActiveEffect so hover tooltips work.
 * Prefer draw-order index over upstream `activeEffects[sprite.zIndex]`, which breaks
 * when overlays / CE redraws desync zIndex from the filtered sprite list.
 * @param {Token} token
 */
export function repairSimrakiEffectBindings(token) {
  if ( !token?.effects || !game.modules.get(MODULE_ID)?.active ) return;

  const activeEffects = getDrawableEffects(token.actor);
  if ( !activeEffects.length ) return;

  const overlay = activeEffects.findLast?.(effect => effect.flags?.core?.overlay)
    ?? [...activeEffects].reverse().find(effect => effect.flags?.core?.overlay)
    ?? null;

  const nonOverlay = activeEffects.filter(effect => effect !== overlay);
  const sprites = getSimrakiEffectSprites(token);
  if ( !sprites.length ) return;

  const used = new Set();

  for ( let i = 0; i < sprites.length; i++ ) {
    const sprite = sprites[i];
    let effect = null;

    // 1) Draw-order match (sprites[i] ↔ non-overlay effects[i]) — most reliable after CE.
    const byIndex = nonOverlay[i];
    if ( byIndex && !used.has(byIndex.id) ) effect = byIndex;

    // 2) Upstream zIndex lookup (works when indices still align).
    if ( !effect ) {
      const byZ = activeEffects[sprite.zIndex];
      if ( byZ && byZ !== overlay && !used.has(byZ.id) ) effect = byZ;
    }

    // 3) Match unused drawable by image path.
    if ( !effect ) {
      const src = spriteImageSrc(sprite);
      if ( src ) {
        effect = nonOverlay.find(entry => {
          if ( used.has(entry.id) ) return false;
          return entry.img && src.includes(entry.img);
        }) ?? null;
      }
    }

    // 4) Next unused non-overlay effect.
    if ( !effect ) {
      effect = nonOverlay.find(entry => !used.has(entry.id)) ?? null;
    }

    if ( effect ) used.add(effect.id);
    sprite[SRE_FLAGS.EFFECT] = effect;

    // Hit-test requires slotSize; keep a sane fallback if Simraki skipped BG_PARAMS.
    if ( !sprite[SRE_FLAGS.BG_PARAMS]?.slotSize ) {
      const size = Math.max(sprite.width || 0, sprite.height || 0, 20);
      sprite[SRE_FLAGS.BG_PARAMS] = {
        ...(sprite[SRE_FLAGS.BG_PARAMS] ?? {}),
        slotSize: size
      };
    }
  }
}

/**
 * Repair every placeable token's Simraki bindings.
 */
function repairAllTokenBindings() {
  for ( const token of canvas.tokens?.placeables ?? [] ) {
    try {
      repairSimrakiEffectBindings(token);
      applyOrbitNeighborAvoidance(token, {animate: false, refreshBases: true});
    }
    catch (error) {
      log(`Binding repair failed on ${token?.name}: ${error?.message || error}`, "warn");
    }
  }
}

/**
 * @param {Function} wrapped
 * @param {...any} args
 */
function tokenRefreshEffectsWrapper(wrapped, ...args) {
  const result = wrapped(...args);
  try {
    repairSimrakiEffectBindings(this);
    // wrapped() already ran Simraki applyToToken — stash from computeEffectOrbit, then flip.
    applyOrbitNeighborAvoidance(this, {animate: false, refreshBases: true});
  }
  catch (error) {
    log(`Binding repair failed: ${error?.message || error}`, "warn");
  }
  return result;
}

/**
 * Belt-and-suspenders: run avoidance immediately after Simraki places icons.
 * @returns {Promise<void>}
 */
async function patchEffectManagerApply() {
  const { EffectManager } = await import(`/modules/${MODULE_ID}/scripts/effectManager.js`);
  if ( EffectManager.prototype.applyToToken?.isJinxedOrbit ) return;
  const original = EffectManager.prototype.applyToToken;
  function jinxedApplyToToken(token) {
    const result = original.call(this, token);
    try {
      repairSimrakiEffectBindings(token);
      applyOrbitNeighborAvoidance(token, {animate: false, refreshBases: true});
    }
    catch (error) {
      log(`Post-apply orbit avoidance failed: ${error?.message || error}`, "warn");
    }
    return result;
  }
  jinxedApplyToToken.isJinxedOrbit = true;
  EffectManager.prototype.applyToToken = jinxedApplyToToken;
}

/**
 * Keep the HTML tooltip above Foundry chrome and attached to <body>.
 */
function hardenTooltipElement() {
  const tip = document.querySelector(".sre-tooltip");
  if ( !tip ) return;
  if ( tip.parentElement !== document.body ) document.body.append(tip);
  tip.style.zIndex = "100000";
}

/**
 * Foundry-style canvas hit check (id match), not only object identity.
 * @param {PIXI.FederatedEvent} event
 * @returns {boolean}
 */
function isPointerOverCanvas(event) {
  const view = canvas?.app?.view;
  const target = event.nativeEvent?.target;
  if ( !view || !target ) return true;
  return view === target || (view.id && target.id === view.id);
}

/**
 * @param {PIXI.FederatedEvent|Event} event
 * @returns {boolean}
 */
function isAltHeld(event) {
  return Boolean(event?.altKey || event?.nativeEvent?.altKey);
}

/**
 * Patch Simraki InteractionHandler:
 * - Tooltips / hover animate without Alt
 * - Delete / disable always require Alt (table rule; ignore upstream setting)
 * - Do not blank canvas.cursor every frame (upstream clearHover wiped Foundry
 *   hover cursors for lights, doors, sounds, etc.)
 * - Rebind listeners (constructor captured the original methods)
 * @returns {Promise<void>}
 */
async function patchInteractionHandler() {
  const { InteractionHandler } = await import(
    `/modules/${MODULE_ID}/scripts/interactionHandler.js`
  );
  const { CLICK_ACTIONS } = await import(`/modules/${MODULE_ID}/scripts/config.js`);
  const { hoverAnimate } = await import(`/modules/${MODULE_ID}/scripts/hoverAnimate.js`);

  InteractionHandler.prototype._isPointerOverCanvas = function(event) {
    return isPointerOverCanvas(event);
  };

  /**
   * Only claim/release the canvas cursor when Simraki itself set it.
   * Upstream wrote view.style.cursor = "" on every miss, which races Foundry's
   * MouseInteractionManager and kills light/door/sound hover indicators.
   */
  InteractionHandler.prototype._setCanvasCursor = function jinxedSetCanvasCursor(value) {
    const view = canvas?.app?.view;
    if ( !view ) return;
    const events = canvas.app.renderer?.events;

    if ( value === "pointer" ) {
      this._jinxedCursorOwned = true;
      if ( typeof events?.setCursor === "function" ) events.setCursor("pointer");
      else view.style.cursor = "pointer";
      return;
    }

    if ( !this._jinxedCursorOwned ) return;
    this._jinxedCursorOwned = false;
    if ( typeof events?.setCursor === "function" ) events.setCursor("default");
    else view.style.cursor = "";
  };

  InteractionHandler.prototype.clearHover = function jinxedClearHover() {
    if ( this.hoveredHit?.sprite ) hoverAnimate(this.hoveredHit.sprite);
    this.hoveredHit = null;
    this._setCanvasCursor("");
    if ( this.tooltipManager.isEnabled ) this.tooltipManager.hide();
  };

  InteractionHandler.prototype.onPointerMove = function onPointerMove(event) {
    if ( canvas.tokens._draggedToken ) return;
    if ( !this._isPointerOverCanvas(event) ) {
      this.clearHover();
      return;
    }

    const hit = this._hitTest(event.global);
    if ( !hit ) {
      this.clearHover();
      return;
    }
    if ( hit.token.movementAnimationPromise ) return;

    // Tooltips / hover animate without Alt.
    if ( this.hoveredHit?.sprite !== hit.sprite ) {
      if ( this.hoveredHit?.sprite ) hoverAnimate(this.hoveredHit.sprite);
      hoverAnimate(hit.sprite, true);
      this.hoveredHit = hit;
    }

    // Pointer cursor only when a mutating click is actually available (Alt held).
    // Otherwise release our claim only — never force-clear Foundry's cursor.
    if ( hit.token.isOwner
      && this._getClickAction() !== CLICK_ACTIONS.NOTHING
      && isAltHeld(event) ) {
      this._setCanvasCursor("pointer");
    }
    else {
      this._setCanvasCursor("");
    }
    this.tooltipManager.scheduleShow(hit, event);
  };

  InteractionHandler.prototype.onPointerDown = function onPointerDown(event) {
    if ( event.button !== 0 || !this._isPointerOverCanvas(event) ) return;

    const hit = this._hitTest(event.global);
    if ( !hit ) return;

    // Plain clicks on icons must not remove/disable — Alt is mandatory.
    if ( !isAltHeld(event) ) return;

    event.stopPropagation?.();
    event.stopImmediatePropagation?.();
    event.nativeEvent?.stopPropagation?.();

    if ( hit.token.isOwner ) {
      const action = this._getClickAction();
      if ( action === CLICK_ACTIONS.DELETE ) hit.effect.delete();
      else if ( action === CLICK_ACTIONS.DISABLE ) {
        hit.effect.update({disabled: !hit.effect.disabled});
      }
    }
    this.clearHover();
  };

  const originalInstall = InteractionHandler.prototype.install;
  InteractionHandler.prototype.install = function jinxedInstall() {
    interactionHandler = this;
    // Drop prior listeners before rebinding (canvasReady / re-patch).
    if ( this.installed ) {
      const stage = canvas?.app?.stage;
      if ( stage ) {
        stage.removeEventListener("pointerdown", this._onPointerDown, {capture: true});
        stage.removeEventListener("pointermove", this._onPointerMove, {capture: true});
      }
      this.installed = false;
    }
    this._onPointerDown = this.onPointerDown.bind(this);
    this._onPointerMove = foundry.utils.throttle(
      this.onPointerMove.bind(this),
      InteractionHandler.THROTTLE_MS
    );
    return originalInstall.call(this);
  };

  // Re-install now if canvas is already up and we have (or can wait for) the instance.
  if ( interactionHandler && canvas?.ready ) {
    interactionHandler.install();
    log("Rebound InteractionHandler listeners (tooltips without Alt)");
  }
  else if ( canvas?.ready ) {
    // Instance not captured yet — next canvasReady install will use patched methods.
    log("InteractionHandler patched; waiting for install capture");
  }
}

/**
 * Capture the handler instance as early as possible (before first canvasReady install).
 */
function registerInstallCapture() {
  Hooks.once("init", async () => {
    if ( !game.modules.get(MODULE_ID)?.active ) return;
    try {
      const { InteractionHandler } = await import(
        `/modules/${MODULE_ID}/scripts/interactionHandler.js`
      );
      const originalInstall = InteractionHandler.prototype.install;
      if ( originalInstall.isJinxedCapture ) return;
      function captureInstall() {
        interactionHandler = this;
        return originalInstall.call(this);
      }
      captureInstall.isJinxedCapture = true;
      InteractionHandler.prototype.install = captureInstall;
    }
    catch (error) {
      log(`Install capture failed: ${error?.message || error}`, "warn");
    }
  });
}

// Run at module evaluation so we wrap install before the first canvasReady.
registerInstallCapture();

/**
 * Keep Simraki's Require Alt setting on so the module UI matches table rules.
 * Click gating itself is hardcoded in the InteractionHandler patch.
 */
async function ensureRequireAltEnabled() {
  try {
    if ( game.settings.get(MODULE_ID, "interactionRequireAlt") === true ) return;
    await game.settings.set(MODULE_ID, "interactionRequireAlt", true);
    log("Enabled Simraki Require Alt Key to match click-to-remove gating");
  }
  catch (error) {
    log(`Could not enable Require Alt: ${error?.message || error}`, "warn");
  }
}

/**
 * Apply Simraki tooltip / hit-target repairs and sticky user settings.
 */
export async function applySimrakiRadialEffectsTweaks() {
  await migrateClientSettingsToUser();
  await ensureRequireAltEnabled();
  await getComputeEffectOrbit();
  await patchInteractionHandler();
  await patchEffectManagerApply();

  if ( typeof libWrapper?.register === "function" && game.modules.get("lib-wrapper")?.active ) {
    try {
      libWrapper.register(
        WRAPPER_ID,
        "foundry.canvas.placeables.Token.prototype._refreshEffects",
        tokenRefreshEffectsWrapper,
        "WRAPPER"
      );
    }
    catch (error) {
      // Hot-reload / re-apply can hit an existing registration.
      if ( !String(error?.message || error).includes("already registered") ) throw error;
    }
  }
  else {
    const proto = foundry.canvas.placeables.Token.prototype;
    if ( !proto._refreshEffects?.isJinxedOrbit ) {
      const original = proto._refreshEffects;
      function jinxedSimrakiRefreshEffects(...args) {
        return tokenRefreshEffectsWrapper.call(this, original.bind(this), ...args);
      }
      jinxedSimrakiRefreshEffects.isJinxedOrbit = true;
      proto._refreshEffects = jinxedSimrakiRefreshEffects;
    }
  }

  hardenTooltipElement();
  // Critical: first canvasReady often already fired before ready-phase tweaks.
  repairAllTokenBindings();

  Hooks.on("canvasReady", () => {
    hardenTooltipElement();
    repairAllTokenBindings();
    if ( interactionHandler ) {
      try {
        interactionHandler.install();
      }
      catch (error) {
        log(`Handler reinstall failed: ${error?.message || error}`, "warn");
      }
    }
  });

  // Re-score only after a token finishes moving/resizing (not during drag/animation frames).
  // Prefer moveToken: Foundry V14 movement often won't expose movementAnimationPromise
  // until after updateToken returns.
  Hooks.on("moveToken", (document, movement) => {
    if ( !movement?.passed?.waypoints?.length ) return;
    scheduleOrbitAvoidanceAfterMove(document, movement);
  });
  Hooks.on("updateToken", (document, changes, options) => {
    const movement = options?._movement?.[document.id];
    if ( movement?.passed?.waypoints?.length ) {
      // moveToken also fires for real movement; avoid double-scheduling the same op.
      if ( !orbitMoveWaiters.has(document.id) ) {
        scheduleOrbitAvoidanceAfterMove(document, movement);
      }
      return;
    }
    if ( !("x" in changes || "y" in changes || "width" in changes || "height" in changes) ) return;
    scheduleOrbitAvoidanceAfterMove(document);
  });
  Hooks.on("createToken", document => {
    const token = tokenFromDocument(document);
    if ( token ) refreshOrbitAvoidanceAround(token, {animate: false});
  });
  Hooks.on("deleteToken", document => {
    // Neighbors of the deleted token may need to relax back to their default side.
    const center = document;
    const grid = canvas.grid?.size ?? 100;
    const cx = (center.x ?? 0) + (((center.width ?? 1) * grid) / 2);
    const cy = (center.y ?? 0) + (((center.height ?? 1) * grid) / 2);
    const radius = (Math.max(center.width ?? 1, center.height ?? 1) * grid) + (grid * 2) + ORBIT_NEIGHBOR_PAD;
    for ( const token of canvas.tokens?.placeables ?? [] ) {
      if ( !token?.center ) continue;
      if ( Math.hypot(token.center.x - cx, token.center.y - cy) <= radius ) {
        applyOrbitNeighborAvoidance(token, {animate: true, refreshBases: true});
      }
    }
  });

  // Late tooltip creation only (avoid thrashing on every DOM mutation / tooltip HTML update).
  const observer = new MutationObserver(mutations => {
    for ( const mutation of mutations ) {
      for ( const node of mutation.addedNodes ) {
        if ( node.nodeType !== Node.ELEMENT_NODE ) continue;
        if ( node.classList?.contains("sre-tooltip")
          || node.querySelector?.(".sre-tooltip") ) {
          hardenTooltipElement();
          return;
        }
      }
    }
  });
  observer.observe(document.body, {childList: true, subtree: true});

  log("Radial tooltip bindings hardened; orbit neighbor avoidance on; Alt required to remove/disable; settings re-scoped");
}
