/**
 * Region behavior: Temporary Elevation
 *
 * On TOKEN_ENTER: save the token's current elevation (once per visit) and set
 * the configured elevation (clamped so the token stays inside the Region).
 * On TOKEN_EXIT: restore the saved value.
 *
 * Without clamping, a target at/above Region elevation.top (exclusive) causes
 * enter → raise → exit → restore → enter forever.
 */

const MODULE_ID = "jinxed-tweaks";
const TYPE = `${MODULE_ID}.temporaryElevation`;
const FLAG_KEY = "tempElevation";

/** Tokens currently being updated by this behavior (reentrancy lock). */
const applying = new WeakSet();

/**
 * @param {TokenDocument} token
 * @param {string} storeKey
 * @returns {number|undefined}
 */
function readStoredElevation(token, storeKey) {
  const store = token.getFlag(MODULE_ID, FLAG_KEY);
  if ( !store || typeof store !== "object" ) return undefined;
  const value = store[storeKey];
  return Number.isFinite(value) ? Number(value) : undefined;
}

/**
 * @param {foundry.data.regionBehaviors.RegionBehaviorType} system
 * @returns {string}
 */
function storeKeyFor(system) {
  return `${system.region?.id ?? "region"}_${system.behavior?.id ?? "behavior"}`;
}

/**
 * Keep the applied elevation inside the Region so TOKEN_EXIT is not fired by
 * our own update (exclusive tops are the usual foot-gun).
 * @param {RegionDocument} region
 * @param {number} desired
 * @param {TokenDocument} token
 * @returns {number}
 */
function resolveTargetElevation(region, desired, token) {
  let target = Number(desired);
  if ( !Number.isFinite(target) ) target = 0;

  const depth = Number(token.depth ?? 0) || 0;
  if ( typeof region?.clampElevation === "function" ) {
    target = region.clampElevation(target, depth);
  }

  const range = region?.elevation;
  const test = foundry.documents.RegionDocument?._testElevation;
  if ( range && typeof test === "function" && !test(range, target) ) {
    const bottom = Number(range.bottom);
    const top = Number(range.top);
    const step = Number(region.parent?.grid?.distance) || 1;
    if ( Number.isFinite(top) && target >= top ) {
      target = Number.isFinite(bottom) ? Math.max(bottom, top - step * 0.01) : top - step * 0.01;
    }
    if ( Number.isFinite(bottom) && target < bottom ) target = bottom;
  }

  return target;
}

export class TemporaryElevationRegionBehaviorType extends foundry.data.regionBehaviors.RegionBehaviorType {
  /** @override */
  static LOCALIZATION_PREFIXES = [
    "JINXED_TWEAKS.RegionBehavior.TemporaryElevation",
    "BEHAVIOR.TYPES.base"
  ];

  /** @override */
  static defineSchema() {
    return {
      events: this._createEventsField({
        events: [CONST.REGION_EVENTS.TOKEN_ENTER, CONST.REGION_EVENTS.TOKEN_EXIT],
        initial: [CONST.REGION_EVENTS.TOKEN_ENTER, CONST.REGION_EVENTS.TOKEN_EXIT]
      }),
      elevation: new foundry.data.fields.NumberField({
        required: true,
        nullable: false,
        initial: 0,
        label: "JINXED_TWEAKS.RegionBehavior.TemporaryElevation.FIELDS.elevation.label",
        hint: "JINXED_TWEAKS.RegionBehavior.TemporaryElevation.FIELDS.elevation.hint"
      })
    };
  }

  /** @override */
  static events = {
    [CONST.REGION_EVENTS.TOKEN_ENTER]: this.#onTokenEnter,
    [CONST.REGION_EVENTS.TOKEN_EXIT]: this.#onTokenExit
  };

  /**
   * @this {TemporaryElevationRegionBehaviorType}
   * @param {import("@client/documents/_types.mjs").RegionTokenEnterEvent} event
   */
  static async #onTokenEnter(event) {
    if ( !event.user.isSelf ) return;
    const token = event.data.token;
    if ( !token ) return;
    if ( !token.isOwner && !game.user.isGM ) return;
    if ( applying.has(token) ) return;

    const region = this.region;
    if ( !region ) return;

    const key = storeKeyFor(this);
    if ( readStoredElevation(token, key) !== undefined ) return;

    const previous = Number(token.elevation ?? 0);
    const requested = Number(this.elevation ?? 0);
    const target = resolveTargetElevation(region, requested, token);

    applying.add(token);
    const resumeMovement = event.data.movement ? token.pauseMovement() : undefined;
    try {
      if ( previous === target ) {
        await token.update({
          [`flags.${MODULE_ID}.${FLAG_KEY}.${key}`]: previous
        });
        return;
      }
      await token.update({
        elevation: target,
        [`flags.${MODULE_ID}.${FLAG_KEY}.${key}`]: previous
      }, {animate: false});
    }
    finally {
      applying.delete(token);
      await resumeMovement?.();
    }
  }

  /**
   * @this {TemporaryElevationRegionBehaviorType}
   * @param {import("@client/documents/_types.mjs").RegionTokenExitEvent} event
   */
  static async #onTokenExit(event) {
    if ( !event.user.isSelf ) return;
    const token = event.data.token;
    if ( !token ) return;
    if ( !token.isOwner && !game.user.isGM ) return;
    if ( applying.has(token) ) return;

    const key = storeKeyFor(this);
    const previous = readStoredElevation(token, key);
    if ( previous === undefined ) return;

    applying.add(token);
    const resumeMovement = event.data.movement ? token.pauseMovement() : undefined;
    try {
      await token.update({
        elevation: previous,
        [`flags.${MODULE_ID}.${FLAG_KEY}.-=${key}`]: null
      }, {animate: false});
    }
    finally {
      applying.delete(token);
      await resumeMovement?.();
    }
  }
}

/**
 * Register Temporary Elevation with Foundry's Region Behavior system.
 * Call synchronously from Hooks.once("init") — do not defer with setTimeout.
 */
export function applyTemporaryElevationBehavior() {
  if ( !foundry.data.regionBehaviors?.RegionBehaviorType ) {
    console.error("jinxed-tweaks | region-behavior | RegionBehaviorType missing; skip Temporary Elevation");
    return;
  }

  CONFIG.RegionBehavior.dataModels[TYPE] = TemporaryElevationRegionBehaviorType;
  CONFIG.RegionBehavior.typeIcons[TYPE] = "fa-solid fa-arrow-up-from-ground-water";
  CONFIG.RegionBehavior.typeLabels[TYPE] ??= `TYPES.RegionBehavior.${TYPE}`;
  CONFIG.RegionBehavior.typeHints[TYPE] ??= `TYPES.HINTS.RegionBehavior.${TYPE}`;
  console.log(`jinxed-tweaks | region-behavior | Registered ${TYPE}`);
}
