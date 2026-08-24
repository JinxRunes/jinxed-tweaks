/**
 * Core token nameplates — slightly smaller text + neighbor overlap avoidance.
 *
 * Foundry parks every name under its token. Adjacent / stacked creatures then
 * cover labels with other names or artwork. After a move settles (and on
 * nameplate refresh), we nudge visible labels in a tight proximity cluster.
 *
 * Stay under the token near Foundry’s default spot. When names collide
 * side-by-side, slide them horizontally just enough to stay readable. Flip
 * above only for vertical stacks when near-below options still cover a body.
 */

const WRAPPER_ID = "jinxed-tweaks";
/** Foundry default nameplate font size is 24. */
const NAMEPLATE_FONT_SIZE = 19;
/** Soft gap when testing label/body overlap (px). */
const NAMEPLATE_PAD = 6;
/** Horizontal moves are cheap; vertical / flip stays expensive. */
const HORIZONTAL_DISPLACEMENT_WEIGHT = 14;
const VERTICAL_DISPLACEMENT_WEIGHT = 50;
/** Max |dx| — larger when side-by-side so long names can clear. */
const MAX_SIDE_FRAC = 0.3;
const MAX_SIDE_PX = 34;
const MAX_SIDE_FRAC_ROW = 0.7;
const MAX_SIDE_PX_ROW = 78;
/** Vertical lift when placing a name above the token. */
const ABOVE_GAP_FRAC = 0.12;
/** Extra center-distance allowance beyond token radii (grid cells). */
const CLUSTER_GRID_PAD = 1.25;
/** Residual conflict under this is “good enough”. */
const ACCEPT_CONFLICT = 80;

const DEFAULT_PLACEMENT = {id: "below", side: "below", dx: 0, tuck: 0};

function log(message, level="log") {
  console[level](`jinxed-tweaks | core-nameplates | ${message}`);
}

/**
 * @param {Token} token
 * @returns {{x: number, y: number, offset: number, width: number, height: number}}
 */
function getNameplateMetrics(token) {
  const {width, height} = token.document.getSize();
  const offset = (CONFIG.Canvas?.objectBorderThickness ?? 4) * 0.75
    * (canvas.dimensions?.uiScale ?? 1);
  return {width, height, offset, x: width / 2, y: height + offset};
}

/**
 * @param {Token} token
 * @returns {boolean}
 */
function hasVisibleNameplate(token) {
  const np = token?.nameplate;
  if ( !np || token.destroyed ) return false;
  if ( np.visible === false || np.renderable === false ) return false;
  if ( !np.text ) return false;
  return true;
}

/**
 * @param {string|object|null|undefined} layout
 * @returns {boolean}
 */
function isDefaultPlacement(layout) {
  if ( !layout ) return true;
  if ( typeof layout === "string" ) return layout === "below" || layout === DEFAULT_PLACEMENT.id;
  return layout.side === "below" && !(layout.dx) && !(layout.tuck);
}

/**
 * Neighbor mostly under this token (vertical stack) — the only case that may
 * justify flipping a name above.
 * @param {Token} token
 * @param {Token[]} cluster
 * @returns {boolean}
 */
function hasStackedNeighborBelow(token, cluster) {
  const tx = token.center?.x ?? token.x ?? 0;
  const ty = token.center?.y ?? token.y ?? 0;
  const grid = canvas.grid?.size ?? 100;
  for ( const other of cluster ) {
    if ( !other || other === token ) continue;
    const ox = other.center?.x ?? other.x ?? 0;
    const oy = other.center?.y ?? other.y ?? 0;
    const dx = Math.abs(ox - tx);
    const dy = oy - ty;
    if ( dy > grid * 0.35 && dx < grid * 0.75 ) return true;
  }
  return false;
}

/**
 * True when at least one cluster neighbor sits more beside than above/below.
 * @param {Token} token
 * @param {Token[]} cluster
 * @returns {boolean}
 */
function hasSideBySideNeighbor(token, cluster) {
  const tx = token.center?.x ?? token.x ?? 0;
  const ty = token.center?.y ?? token.y ?? 0;
  for ( const other of cluster ) {
    if ( !other || other === token ) continue;
    const dx = Math.abs((other.center?.x ?? other.x ?? 0) - tx);
    const dy = Math.abs((other.center?.y ?? other.y ?? 0) - ty);
    if ( dx >= Math.max(dy * 0.85, 8) ) return true;
  }
  return false;
}

/**
 * Prefer sliding away from denser side neighbors (−1 left, +1 right).
 * @param {Token} token
 * @param {Token[]} cluster
 * @returns {number}
 */
function preferredHorizontalSign(token, cluster) {
  const tx = token.center?.x ?? token.x ?? 0;
  const ty = token.center?.y ?? token.y ?? 0;
  let left = 0;
  let right = 0;
  for ( const other of cluster ) {
    if ( !other || other === token ) continue;
    const ox = other.center?.x ?? other.x ?? 0;
    const oy = other.center?.y ?? other.y ?? 0;
    const dx = ox - tx;
    const dy = Math.abs(oy - ty);
    if ( Math.abs(dx) < 8 || Math.abs(dx) < dy * 0.85 ) continue;
    if ( dx < 0 ) left += 1;
    else right += 1;
  }
  if ( right > left ) return -1;
  if ( left > right ) return 1;
  // Middle of a row: keep center preferred (0).
  if ( left && right ) return 0;
  return left ? 1 : (right ? -1 : 0);
}

/**
 * Near-default candidates. Wider horizontal range for side-by-side rows.
 * @param {Token} token
 * @param {Token[]} cluster
 * @returns {object[]}
 */
function buildPlacements(token, cluster) {
  const m = getNameplateMetrics(token);
  const sideBySide = hasSideBySideNeighbor(token, cluster);
  const maxDx = sideBySide
    ? Math.min(Math.max(m.width * MAX_SIDE_FRAC_ROW, 24), MAX_SIDE_PX_ROW)
    : Math.min(Math.max(m.width * MAX_SIDE_FRAC, 14), MAX_SIDE_PX);
  const step = sideBySide ? 8 : 6;
  const dxSteps = [0];
  for ( let d = step; d <= maxDx + 0.5; d += step ) {
    dxSteps.push(-d, d);
  }
  // Prefer outward slides first when neighbors crowd one side.
  const prefer = preferredHorizontalSign(token, cluster);
  if ( prefer !== 0 ) {
    dxSteps.sort((a, b) => {
      const aFav = Math.sign(a) === prefer ? 0 : (a === 0 ? 1 : 2);
      const bFav = Math.sign(b) === prefer ? 0 : (b === 0 ? 1 : 2);
      if ( aFav !== bFav ) return aFav - bFav;
      return Math.abs(a) - Math.abs(b);
    });
  }

  const tuckSteps = sideBySide ? [0, 4, 8, 12] : [0, 4, 8, 12, 16, 20];

  const placements = [];
  for ( const tuck of tuckSteps ) {
    for ( const dx of dxSteps ) {
      placements.push({
        id: `below-dx${dx}-t${tuck}`,
        side: "below",
        dx,
        tuck
      });
    }
  }

  placements.sort((a, b) => {
    // Prefer matching outward direction, then smaller moves.
    const aDir = prefer && Math.sign(a.dx) === prefer ? 0 : (a.dx === 0 ? 1 : 2);
    const bDir = prefer && Math.sign(b.dx) === prefer ? 0 : (b.dx === 0 ? 1 : 2);
    if ( aDir !== bDir ) return aDir - bDir;
    return Math.hypot(a.dx, a.tuck) - Math.hypot(b.dx, b.tuck);
  });

  if ( hasStackedNeighborBelow(token, cluster) ) {
    for ( const dx of [0, -10, 10, -18, 18] ) {
      placements.push({id: `above-dx${dx}`, side: "above", dx, tuck: 0});
    }
  }

  return placements;
}

/**
 * @param {Token} token
 * @param {object} placement
 */
function applyPlacement(token, placement) {
  if ( !token?.nameplate ) return;
  const p = placement || DEFAULT_PLACEMENT;
  const m = getNameplateMetrics(token);
  const tuck = Math.max(0, p.tuck || 0);
  const dx = p.dx || 0;

  if ( p.side === "above" ) {
    const aboveY = -Math.max(m.offset, m.height * ABOVE_GAP_FRAC) + tuck;
    token.nameplate.anchor.set(0.5, 1);
    token.nameplate.position.set(m.x + dx, aboveY);
  }
  else {
    token.nameplate.anchor.set(0.5, 0);
    token.nameplate.position.set(m.x + dx, m.y - tuck);
  }
  token._jinxedNameplateLayout = p.id;
  token._jinxedNameplatePlacement = p;
}

/**
 * @param {Token} token
 * @param {string} layout
 */
function applyNameplateLayout(token, layout) {
  if ( layout === "below" || !layout ) {
    applyPlacement(token, DEFAULT_PLACEMENT);
    return;
  }
  if ( token?._jinxedNameplatePlacement?.id === layout ) {
    applyPlacement(token, token._jinxedNameplatePlacement);
    return;
  }
  applyPlacement(token, DEFAULT_PLACEMENT);
}

/**
 * World AABB from token placeable position + local nameplate geometry.
 * @param {Token} token
 * @returns {{x:number,y:number,width:number,height:number}|null}
 */
function getNameplateWorldBox(token) {
  if ( !hasVisibleNameplate(token) ) return null;
  const np = token.nameplate;
  let tw = Number(np.width) || 0;
  let th = Number(np.height) || 0;
  if ( !(tw > 1) || !(th > 1) ) {
    const chars = String(np.text ?? "").length || 8;
    const s = Math.abs(np.scale?.x ?? 1);
    tw = Math.max(36, chars * NAMEPLATE_FONT_SIZE * 0.52 * s);
    th = Math.max(14, NAMEPLATE_FONT_SIZE * 1.25 * s);
  }
  const ax = np.anchor?.x ?? 0.5;
  const ay = np.anchor?.y ?? 0;
  const tx = token.x ?? token.document?.x ?? 0;
  const ty = token.y ?? token.document?.y ?? 0;
  return {
    x: tx + np.x - (tw * ax),
    y: ty + np.y - (th * ay),
    width: tw,
    height: th
  };
}

/**
 * @param {Token} token
 * @returns {{x:number,y:number,width:number,height:number}|null}
 */
function getTokenBodyWorldBox(token) {
  if ( !token || token.destroyed ) return null;
  const b = token.bounds;
  if ( b?.width > 0 && b?.height > 0 ) {
    return {x: b.x, y: b.y, width: b.width, height: b.height};
  }
  const w = token.w || ((token.document?.width ?? 1) * (canvas.grid?.size ?? 100));
  const h = token.h || ((token.document?.height ?? 1) * (canvas.grid?.size ?? 100));
  const x = token.x ?? token.document?.x ?? 0;
  const y = token.y ?? token.document?.y ?? 0;
  return {x, y, width: w, height: h};
}

/**
 * How far this placement sits from Foundry default, with cheaper horizontal cost.
 * @param {Token} token
 * @param {object} placement
 * @returns {number}
 */
function displacementCost(token, placement) {
  const m = getNameplateMetrics(token);
  if ( placement.side === "above" ) {
    const flipDist = m.height + m.offset + Math.max(m.offset, m.height * ABOVE_GAP_FRAC);
    return (flipDist * VERTICAL_DISPLACEMENT_WEIGHT)
      + (Math.abs(placement.dx || 0) * HORIZONTAL_DISPLACEMENT_WEIGHT);
  }
  return (Math.abs(placement.dx || 0) * HORIZONTAL_DISPLACEMENT_WEIGHT)
    + (Math.abs(placement.tuck || 0) * VERTICAL_DISPLACEMENT_WEIGHT);
}

/**
 * @param {{x:number,y:number,width:number,height:number}} a
 * @param {{x:number,y:number,width:number,height:number}} b
 * @returns {number}
 */
function intersectionArea(a, b) {
  const left = Math.max(a.x, b.x - NAMEPLATE_PAD);
  const top = Math.max(a.y, b.y - NAMEPLATE_PAD);
  const right = Math.min(a.x + a.width, b.x + b.width + NAMEPLATE_PAD);
  const bottom = Math.min(a.y + a.height, b.y + b.height + NAMEPLATE_PAD);
  const w = right - left;
  const h = bottom - top;
  return (w > 0 && h > 0) ? w * h : 0;
}

/**
 * Conflict scoring — overlapping names must separate enough to read.
 * @param {Token} token
 * @param {{x:number,y:number,width:number,height:number}} box
 * @param {Token[]} cluster
 * @returns {number}
 */
function scoreNameplateBox(token, box, cluster) {
  let score = 0;

  const own = getTokenBodyWorldBox(token);
  if ( own ) {
    const area = intersectionArea(box, own);
    if ( area > 0 ) score += area * 1.2;
  }

  for ( const other of cluster ) {
    if ( !other || other === token ) continue;

    const body = getTokenBodyWorldBox(other);
    if ( body ) {
      const area = intersectionArea(box, body);
      if ( area > 0 ) score += 350 + (area * 2.5);
    }

    if ( hasVisibleNameplate(other) ) {
      const otherBox = getNameplateWorldBox(other);
      if ( otherBox ) {
        const area = intersectionArea(box, otherBox);
        // Unreadable merged names — pay enough that a modest horizontal slide wins.
        if ( area > 0 ) score += 900 + (area * 5);
      }
    }
  }
  return score;
}

/**
 * @param {Token} token
 * @param {object} placement
 * @param {Token[]} cluster
 * @returns {number}
 */
function scorePlacement(token, placement, cluster) {
  applyPlacement(token, placement);
  const box = getNameplateWorldBox(token);
  if ( !box ) return Infinity;
  return scoreNameplateBox(token, box, cluster) + displacementCost(token, placement);
}

/**
 * Pick the placement nearest Foundry’s default that still clears enough.
 * @param {Token} token
 * @param {Token[]} cluster
 * @returns {string}
 */
function pickBestLayout(token, cluster) {
  const placements = buildPlacements(token, cluster);
  let best = DEFAULT_PLACEMENT;
  let bestScore = Infinity;

  for ( const p of placements ) {
    const score = scorePlacement(token, p, cluster);
    if ( score < bestScore ) {
      bestScore = score;
      best = p;
    }
  }

  applyPlacement(token, best);
  return best.id;
}

/**
 * Re-slot every visible nameplate in a proximity cluster (2+ tokens OK).
 * @param {Token[]} tokens
 */
function separateNameplates(tokens) {
  const cluster = [...new Set(tokens.filter(t => t && !t.destroyed))];
  const labeled = cluster.filter(hasVisibleNameplate);
  if ( !labeled.length ) return;

  if ( labeled.length === 1 && cluster.length === 1 ) {
    applyPlacement(labeled[0], DEFAULT_PLACEMENT);
    return;
  }

  // Left-to-right then top-to-bottom — stable for side-by-side rows.
  labeled.sort((a, b) => {
    const dy = (a.center?.y ?? a.y) - (b.center?.y ?? b.y);
    if ( Math.abs(dy) > 8 ) return dy;
    return (a.center?.x ?? a.x) - (b.center?.x ?? b.x);
  });

  for ( const token of labeled ) applyPlacement(token, DEFAULT_PLACEMENT);
  for ( const token of labeled ) pickBestLayout(token, cluster);

  for ( let pass = 0; pass < 4; pass++ ) {
    let changed = false;
    for ( const token of labeled ) {
      const box = getNameplateWorldBox(token);
      if ( !box ) continue;
      if ( scoreNameplateBox(token, box, cluster) <= ACCEPT_CONFLICT ) continue;
      const prev = token._jinxedNameplateLayout || "below";
      const next = pickBestLayout(token, cluster);
      if ( next !== prev ) changed = true;
    }
    if ( !changed ) break;
  }
}

/**
 * Adjacent / stacked / one-cell gap — not a wide map radius.
 * @param {Token} a
 * @param {Token} b
 * @returns {boolean}
 */
function tokensInNameplateRange(a, b) {
  if ( !a?.center || !b?.center ) return false;
  const grid = canvas.grid?.size ?? 100;
  const dist = Math.hypot(a.center.x - b.center.x, a.center.y - b.center.y);
  const reach = (Math.max(a.w, a.h) + Math.max(b.w, b.h)) * 0.5
    + (grid * CLUSTER_GRID_PAD)
    + 24;
  return dist <= reach;
}

/**
 * Connected proximity component around a seed (any number of creatures).
 * @param {Token} seed
 * @returns {Token[]}
 */
function collectProximityCluster(seed) {
  if ( !seed || !canvas?.tokens?.placeables ) return seed ? [seed] : [];
  const placeables = canvas.tokens.placeables.filter(t => {
    if ( !t || t.destroyed || !t.center ) return false;
    if ( t.document?.hidden && !game.user?.isGM ) return false;
    return true;
  });

  const cluster = new Set([seed]);
  let grew = true;
  while ( grew ) {
    grew = false;
    for ( const candidate of placeables ) {
      if ( cluster.has(candidate) ) continue;
      for ( const member of cluster ) {
        if ( !tokensInNameplateRange(candidate, member) ) continue;
        cluster.add(candidate);
        grew = true;
        break;
      }
    }
  }
  return [...cluster];
}

/**
 * @param {Token} token
 */
function refreshNameplatesAround(token) {
  if ( !token?.center || !canvas?.tokens?.placeables ) return;
  const cluster = collectProximityCluster(token);
  separateNameplates(cluster);
}

/**
 * Reset shifted labels that no longer share a proximity cluster with anyone.
 */
function relaxOrphanNameplates() {
  for ( const token of canvas.tokens?.placeables ?? [] ) {
    if ( !hasVisibleNameplate(token) ) continue;
    if ( isDefaultPlacement(token._jinxedNameplatePlacement || token._jinxedNameplateLayout) ) continue;
    const cluster = collectProximityCluster(token);
    if ( cluster.filter(hasVisibleNameplate).length <= 1 ) {
      applyPlacement(token, DEFAULT_PLACEMENT);
    }
    else separateNameplates(cluster);
  }
}

/**
 * Scene-wide: each proximity component resolved once.
 */
function refreshAllNameplateComponents() {
  const visited = new Set();
  for ( const token of canvas.tokens?.placeables ?? [] ) {
    if ( !token?.id || visited.has(token.id) ) continue;
    const cluster = collectProximityCluster(token);
    for ( const member of cluster ) {
      if ( member?.id ) visited.add(member.id);
    }
    if ( !cluster.some(hasVisibleNameplate) ) continue;
    separateNameplates(cluster);
  }
}

/** @type {Map<string, Promise<void>>} */
const nameplateMoveWaiters = new Map();
/** @type {Map<string, number>} */
const nameplateMoveGenerations = new Map();

/**
 * @returns {Promise<void>}
 */
function nextAnimationFrame() {
  return new Promise(resolve => requestAnimationFrame(() => resolve()));
}

/**
 * @param {number} ms
 * @returns {Promise<void>}
 */
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * @param {TokenDocument} document
 * @param {object} [movement]
 * @returns {Promise<void>}
 */
async function waitForTokenMovementSettled(document, movement=null) {
  const id = document?.id;
  if ( !id ) return;

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
      // cancelled
    }
  }

  await nextAnimationFrame();
  await nextAnimationFrame();
  await delay(32);
}

/**
 * @param {TokenDocument} document
 * @param {object} [movement]
 */
function scheduleNameplateAvoidanceAfterMove(document, movement=null) {
  const id = document?.id;
  if ( !id ) return;
  const generation = (nameplateMoveGenerations.get(id) ?? 0) + 1;
  nameplateMoveGenerations.set(id, generation);

  const job = (async () => {
    try {
      await waitForTokenMovementSettled(document, movement);
      if ( nameplateMoveGenerations.get(id) !== generation ) return;
      const live = canvas.tokens?.get(id);
      if ( live ) refreshNameplatesAround(live);
      relaxOrphanNameplates();
    }
    catch (error) {
      log(`Post-move nameplate avoidance failed: ${error?.message || error}`, "warn");
    }
    finally {
      if ( nameplateMoveGenerations.get(id) === generation ) nameplateMoveWaiters.delete(id);
    }
  })();

  nameplateMoveWaiters.set(id, job);
}

/**
 * @param {Function} wrapped
 * @param {...any} args
 * @returns {PIXI.TextStyle|object}
 */
function getTextStyleWrapper(wrapped, ...args) {
  const style = wrapped(...args);
  if ( style && typeof style === "object" ) style.fontSize = NAMEPLATE_FONT_SIZE;
  return style;
}

/**
 * @param {Function} wrapped
 * @param {...any} args
 */
function refreshNameplateWrapper(wrapped, ...args) {
  const result = wrapped(...args);
  try {
    requestAnimationFrame(() => refreshNameplatesAround(this));
  }
  catch (error) {
    log(`Nameplate refresh avoidance failed: ${error?.message || error}`, "warn");
  }
  return result;
}

/**
 * @param {Function} wrapped
 * @param {...any} args
 */
function refreshSizeWrapper(wrapped, ...args) {
  const result = wrapped(...args);
  try {
    if ( hasVisibleNameplate(this) ) refreshNameplatesAround(this);
  }
  catch (error) {
    log(`Nameplate size avoidance failed: ${error?.message || error}`, "warn");
  }
  return result;
}

/**
 * @param {string} target
 * @param {Function} fn
 * @param {string} [type]
 */
function registerWrapper(target, fn, type="WRAPPER") {
  if ( typeof libWrapper?.register === "function" && game.modules.get("lib-wrapper")?.active ) {
    try {
      libWrapper.register(WRAPPER_ID, target, fn, type);
      return;
    }
    catch (error) {
      if ( !String(error?.message || error).includes("already registered") ) throw error;
      return;
    }
  }

  const parts = target.split(".");
  const method = parts.pop();
  let proto = globalThis;
  for ( const part of parts ) proto = proto?.[part];
  if ( !proto || typeof proto[method] !== "function" ) {
    log(`Could not wrap ${target}`, "warn");
    return;
  }
  if ( proto[method].isJinxedNameplate ) return;
  const original = proto[method];
  function wrapped(...args) {
    return fn.call(this, original.bind(this), ...args);
  }
  wrapped.isJinxedNameplate = true;
  proto[method] = wrapped;
}

/**
 * Apply smaller nameplates and neighbor overlap avoidance.
 */
export function applyCoreNameplateTweaks() {
  registerWrapper(
    "foundry.canvas.placeables.Token.prototype._getTextStyle",
    getTextStyleWrapper
  );
  registerWrapper(
    "foundry.canvas.placeables.Token.prototype._refreshNameplate",
    refreshNameplateWrapper
  );
  registerWrapper(
    "foundry.canvas.placeables.Token.prototype._refreshSize",
    refreshSizeWrapper
  );

  Hooks.on("canvasReady", () => {
    for ( const token of canvas.tokens?.placeables ?? [] ) {
      try {
        if ( token.nameplate && hasVisibleNameplate(token) ) {
          token.nameplate.style = token._getTextStyle();
        }
      }
      catch (error) {
        log(`canvasReady style pass failed: ${error?.message || error}`, "warn");
      }
    }
    try {
      refreshAllNameplateComponents();
    }
    catch (error) {
      log(`canvasReady nameplate pass failed: ${error?.message || error}`, "warn");
    }
  });

  Hooks.on("moveToken", (document, movement) => {
    if ( !movement?.passed?.waypoints?.length ) return;
    scheduleNameplateAvoidanceAfterMove(document, movement);
  });

  Hooks.on("updateToken", (document, changes, options) => {
    const movement = options?._movement?.[document.id];
    if ( movement?.passed?.waypoints?.length ) {
      if ( !nameplateMoveWaiters.has(document.id) ) {
        scheduleNameplateAvoidanceAfterMove(document, movement);
      }
      return;
    }
    if ( !("x" in changes || "y" in changes || "width" in changes || "height" in changes
      || "name" in changes || "displayName" in changes) ) return;
    scheduleNameplateAvoidanceAfterMove(document);
  });

  if ( canvas?.ready ) {
    for ( const token of canvas.tokens?.placeables ?? [] ) {
      try {
        if ( token.nameplate ) token.nameplate.style = token._getTextStyle();
      }
      catch {
        // ignore
      }
    }
    try {
      refreshAllNameplateComponents();
    }
    catch {
      // ignore
    }
  }

  log("Nameplates slightly smaller; near-default nudge avoidance on");
}
