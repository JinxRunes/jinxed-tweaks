/**
 * Core Levels + Tiles — optional night textures that swap with scene darkness.
 *
 * Uses the same darkness signal as ambient light “Darkness Activation Range”
 * (Simple Timekeeping, Day/Night tools, etc.). If a night image path is set,
 * that path is applied when darkness >= threshold; otherwise the day path is
 * restored. Documents without a night path are left alone.
 */

const MODULE_ID = "jinxed-tweaks";
const SETTING_THRESHOLD = "levelNightDarknessMin";

// Level flags
const FLAG_NIGHT_BG = "nightBackgroundSrc";
const FLAG_NIGHT_FG = "nightForegroundSrc";
const FLAG_DAY_BG = "dayBackgroundSrc";
const FLAG_DAY_FG = "dayForegroundSrc";

// Tile flags
const FLAG_NIGHT_TILE = "nightTextureSrc";
const FLAG_DAY_TILE = "dayTextureSrc";

const FLAG_THRESHOLD = "nightDarknessMin";

function log(message, level="log") {
  console[level](`jinxed-tweaks | night-maps | ${message}`);
}

/**
 * World default: night when darkness >= this value (0–1), same idea as light min.
 */
export function registerLevelNightMapSettings() {
  game.settings.register(MODULE_ID, SETTING_THRESHOLD, {
    name: "JINXED_TWEAKS.LevelNightMaps.ThresholdName",
    hint: "JINXED_TWEAKS.LevelNightMaps.ThresholdHint",
    scope: "world",
    config: true,
    type: Number,
    range: {min: 0, max: 1, step: 0.05},
    default: 0.5
  });
}

/**
 * @returns {boolean}
 */
function isPrimaryGm() {
  return Boolean(game.user?.isGM && game.users.activeGM?.isSelf);
}

/**
 * @param {number} darkness
 * @param {number} threshold
 * @returns {boolean}
 */
function isNight(darkness, threshold) {
  return Number(darkness) >= Number(threshold);
}

function clamp01(value) {
  const n = Number(value);
  if ( !Number.isFinite(n) ) return 0.5;
  return Math.clamp(n, 0, 1);
}

/**
 * @param {Level|TileDocument} doc
 * @returns {number}
 */
function docThreshold(doc) {
  const per = doc.getFlag(MODULE_ID, FLAG_THRESHOLD);
  if ( per === "" || per == null ) {
    /* world default */
  }
  else if ( typeof per === "number" && Number.isFinite(per) ) return clamp01(per);
  else if ( typeof per === "string" && per.trim() !== "" && Number.isFinite(Number(per)) ) {
    return clamp01(Number(per));
  }
  try {
    return clamp01(game.settings.get(MODULE_ID, SETTING_THRESHOLD) ?? 0.5);
  }
  catch {
    return 0.5;
  }
}

/**
 * @param {Scene} scene
 * @returns {number}
 */
function sceneDarkness(scene) {
  const fromScene = scene?.environment?.darknessLevel;
  if ( typeof fromScene === "number" ) return fromScene;
  if ( canvas?.scene === scene && typeof canvas.darknessLevel === "number" ) return canvas.darknessLevel;
  return 0;
}

/**
 * Shared day/night src swap for a single texture field + day/night flags.
 * @param {object} update
 * @param {string} current
 * @param {string} nightSrc
 * @param {string} dayFlag
 * @param {string} nightFlagValue unused except for clarity
 * @param {string} srcPath update key e.g. "background.src"
 * @param {string} dayFlagPath e.g. "flags.jinxed-tweaks.dayBackgroundSrc"
 * @param {boolean} night
 * @param {string} storedDay
 * @returns {boolean} whether update gained meaningful fields
 */
function applySrcSwap(update, {current, nightSrc, srcPath, dayFlagPath, night, storedDay}) {
  if ( !nightSrc ) return false;
  let daySrc = (storedDay || "").trim();
  let touched = false;

  if ( night ) {
    if ( current && current !== nightSrc && current !== daySrc ) {
      update[dayFlagPath] = current;
      daySrc = current;
      touched = true;
    }
    else if ( !daySrc && current && current !== nightSrc ) {
      update[dayFlagPath] = current;
      daySrc = current;
      touched = true;
    }
    if ( current !== nightSrc ) {
      update[srcPath] = nightSrc;
      touched = true;
    }
  }
  else if ( daySrc && current !== daySrc ) {
    update[srcPath] = daySrc;
    touched = true;
  }
  else if ( !daySrc && current && current !== nightSrc ) {
    update[dayFlagPath] = current;
    touched = true;
  }
  return touched;
}

/**
 * @param {Level} level
 * @param {number} darkness
 * @returns {object|null}
 */
function buildLevelSwapUpdate(level, darkness) {
  const nightBg = (level.getFlag(MODULE_ID, FLAG_NIGHT_BG) || "").trim();
  const nightFg = (level.getFlag(MODULE_ID, FLAG_NIGHT_FG) || "").trim();
  if ( !nightBg && !nightFg ) return null;

  const night = isNight(darkness, docThreshold(level));
  const update = {_id: level.id};
  let touched = false;

  if ( applySrcSwap(update, {
    current: level.background?.src || "",
    nightSrc: nightBg,
    srcPath: "background.src",
    dayFlagPath: `flags.${MODULE_ID}.${FLAG_DAY_BG}`,
    night,
    storedDay: level.getFlag(MODULE_ID, FLAG_DAY_BG) || ""
  }) ) touched = true;

  if ( applySrcSwap(update, {
    current: level.foreground?.src || "",
    nightSrc: nightFg,
    srcPath: "foreground.src",
    dayFlagPath: `flags.${MODULE_ID}.${FLAG_DAY_FG}`,
    night,
    storedDay: level.getFlag(MODULE_ID, FLAG_DAY_FG) || ""
  }) ) touched = true;

  return touched ? update : null;
}

/**
 * @param {TileDocument} tile
 * @param {number} darkness
 * @returns {object|null}
 */
function buildTileSwapUpdate(tile, darkness) {
  const nightSrc = (tile.getFlag(MODULE_ID, FLAG_NIGHT_TILE) || "").trim();
  if ( !nightSrc ) return null;

  const night = isNight(darkness, docThreshold(tile));
  const update = {_id: tile.id};
  const touched = applySrcSwap(update, {
    current: tile.texture?.src || "",
    nightSrc,
    srcPath: "texture.src",
    dayFlagPath: `flags.${MODULE_ID}.${FLAG_DAY_TILE}`,
    night,
    storedDay: tile.getFlag(MODULE_ID, FLAG_DAY_TILE) || ""
  });
  return touched ? update : null;
}

/** @type {ReturnType<typeof setTimeout>|null} */
let syncTimer = null;
/** @type {WeakSet<Scene>} */
const syncing = new WeakSet();

/**
 * @param {Scene} doc
 * @returns {boolean}
 */
function sceneHasNightTargets(scene) {
  if ( !scene ) return false;
  for ( const level of scene.levels ?? [] ) {
    if ( level.getFlag(MODULE_ID, FLAG_NIGHT_BG) || level.getFlag(MODULE_ID, FLAG_NIGHT_FG) ) return true;
  }
  for ( const tile of scene.tiles ?? [] ) {
    if ( tile.getFlag(MODULE_ID, FLAG_NIGHT_TILE) ) return true;
  }
  return false;
}

/**
 * @param {Scene} scene
 * @param {number} darkness
 * @param {number} prior
 * @returns {boolean}
 */
function thresholdCrossed(scene, darkness, prior) {
  for ( const level of scene.levels ?? [] ) {
    if ( !level.getFlag(MODULE_ID, FLAG_NIGHT_BG) && !level.getFlag(MODULE_ID, FLAG_NIGHT_FG) ) continue;
    const t = docThreshold(level);
    if ( isNight(darkness, t) !== isNight(prior, t) ) return true;
  }
  for ( const tile of scene.tiles ?? [] ) {
    if ( !tile.getFlag(MODULE_ID, FLAG_NIGHT_TILE) ) continue;
    const t = docThreshold(tile);
    if ( isNight(darkness, t) !== isNight(prior, t) ) return true;
  }
  return false;
}

/**
 * Apply day/night swaps for levels + tiles on a scene (active GM only).
 * @param {Scene} [scene]
 * @param {{force?: boolean}} [opts]
 */
async function syncSceneNightMaps(scene=canvas?.scene, opts={}) {
  if ( !isPrimaryGm() ) return;
  if ( !scene ) return;
  if ( syncing.has(scene) ) return;

  const darkness = sceneDarkness(scene);
  const levelUpdates = [];
  for ( const level of scene.levels ?? [] ) {
    const update = buildLevelSwapUpdate(level, darkness);
    if ( update ) levelUpdates.push(update);
  }

  const tileUpdates = [];
  for ( const tile of scene.tiles ?? [] ) {
    const update = buildTileSwapUpdate(tile, darkness);
    if ( update ) tileUpdates.push(update);
  }

  if ( !levelUpdates.length && !tileUpdates.length ) return;

  syncing.add(scene);
  try {
    if ( levelUpdates.length ) {
      await scene.updateEmbeddedDocuments("Level", levelUpdates, {
        jinxedNightMaps: true
      });
    }
    if ( tileUpdates.length ) {
      await scene.updateEmbeddedDocuments("Tile", tileUpdates, {
        jinxedNightMaps: true
      });
    }
    if ( opts.force ) {
      log(`Synced ${levelUpdates.length} level(s), ${tileUpdates.length} tile(s) (darkness=${darkness.toFixed(2)})`);
    }
  }
  catch (error) {
    log(`Sync failed: ${error?.message || error}`, "error");
  }
  finally {
    syncing.delete(scene);
  }
}

/**
 * @param {Scene} [scene]
 */
function scheduleSync(scene=canvas?.scene) {
  if ( !scene ) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => {
    syncTimer = null;
    void syncSceneNightMaps(scene);
  }, 150);
}

/**
 * Shared night fieldset: optional night image + threshold.
 * @param {object} opts
 * @param {string} opts.legendKey
 * @param {string} opts.hintKey
 * @param {string} opts.imageLabelKey
 * @param {string} opts.imageFlag
 * @param {string} opts.imageValue
 * @param {string|number} opts.thresholdValue
 * @returns {HTMLFieldSetElement}
 */
function createNightFieldset({legendKey, hintKey, imageLabelKey, imageFlag, imageValue, thresholdValue}) {
  const fieldset = document.createElement("fieldset");
  fieldset.dataset.jinxedNightMaps = "1";
  fieldset.innerHTML = `
    <legend>${game.i18n.localize(legendKey)}</legend>
    <p class="hint">${game.i18n.localize(hintKey)}</p>
    <div class="form-group">
      <label>${game.i18n.localize(imageLabelKey)}</label>
      <div class="form-fields">
        <file-picker name="flags.${MODULE_ID}.${imageFlag}" type="imagevideo" value="${foundry.utils.escapeHTML(imageValue)}"></file-picker>
      </div>
    </div>
    <div class="form-group">
      <label>${game.i18n.localize("JINXED_TWEAKS.LevelNightMaps.LevelThreshold")}</label>
      <div class="form-fields">
        <input type="number" name="flags.${MODULE_ID}.${FLAG_THRESHOLD}" value="${thresholdValue}" min="0" max="1" step="0.05" placeholder="${game.i18n.localize("JINXED_TWEAKS.LevelNightMaps.LevelThresholdPlaceholder")}">
      </div>
      <p class="hint">${game.i18n.localize("JINXED_TWEAKS.LevelNightMaps.LevelThresholdHint")}</p>
    </div>
  `;
  return fieldset;
}

/**
 * @param {foundry.applications.sheets.LevelConfig} app
 * @param {HTMLElement} element
 */
function injectLevelConfig(app, element) {
  if ( !game.user.isGM ) return;
  const root = element instanceof HTMLElement ? element : element?.[0];
  if ( !root || root.querySelector("[data-jinxed-night-maps]") ) return;

  const level = app.document;
  const nightBg = level.getFlag(MODULE_ID, FLAG_NIGHT_BG) || "";
  const nightFg = level.getFlag(MODULE_ID, FLAG_NIGHT_FG) || "";
  const dayBg = level.getFlag(MODULE_ID, FLAG_DAY_BG) || "";
  const dayFg = level.getFlag(MODULE_ID, FLAG_DAY_FG) || "";
  const perThreshold = level.getFlag(MODULE_ID, FLAG_THRESHOLD);
  const thresholdValue = typeof perThreshold === "number" ? perThreshold : "";

  if ( nightBg && dayBg && level.background?.src === nightBg ) {
    const bgInput = root.querySelector('file-picker[name="background.src"], input[name="background.src"]');
    if ( bgInput ) {
      if ( "value" in bgInput ) bgInput.value = dayBg;
      bgInput.setAttribute("value", dayBg);
    }
  }
  if ( nightFg && dayFg && level.foreground?.src === nightFg ) {
    const fgInput = root.querySelector('file-picker[name="foreground.src"], input[name="foreground.src"]');
    if ( fgInput ) {
      if ( "value" in fgInput ) fgInput.value = dayFg;
      fgInput.setAttribute("value", dayFg);
    }
  }

  const fieldset = document.createElement("fieldset");
  fieldset.dataset.jinxedNightMaps = "1";
  fieldset.innerHTML = `
    <legend>${game.i18n.localize("JINXED_TWEAKS.LevelNightMaps.Legend")}</legend>
    <p class="hint">${game.i18n.localize("JINXED_TWEAKS.LevelNightMaps.Hint")}</p>
    <div class="form-group">
      <label>${game.i18n.localize("JINXED_TWEAKS.LevelNightMaps.NightBackground")}</label>
      <div class="form-fields">
        <file-picker name="flags.${MODULE_ID}.${FLAG_NIGHT_BG}" type="imagevideo" value="${foundry.utils.escapeHTML(nightBg)}"></file-picker>
      </div>
    </div>
    <div class="form-group">
      <label>${game.i18n.localize("JINXED_TWEAKS.LevelNightMaps.NightForeground")}</label>
      <div class="form-fields">
        <file-picker name="flags.${MODULE_ID}.${FLAG_NIGHT_FG}" type="imagevideo" value="${foundry.utils.escapeHTML(nightFg)}"></file-picker>
      </div>
    </div>
    <div class="form-group">
      <label>${game.i18n.localize("JINXED_TWEAKS.LevelNightMaps.LevelThreshold")}</label>
      <div class="form-fields">
        <input type="number" name="flags.${MODULE_ID}.${FLAG_THRESHOLD}" value="${thresholdValue}" min="0" max="1" step="0.05" placeholder="${game.i18n.localize("JINXED_TWEAKS.LevelNightMaps.LevelThresholdPlaceholder")}">
      </div>
      <p class="hint">${game.i18n.localize("JINXED_TWEAKS.LevelNightMaps.LevelThresholdHint")}</p>
    </div>
  `;

  const fieldsets = root.querySelectorAll("fieldset");
  let anchor = null;
  for ( const fs of fieldsets ) {
    const legend = fs.querySelector("legend")?.textContent?.toLowerCase() || "";
    if ( legend.includes("background") || legend.includes("foreground") ) anchor = fs;
  }
  if ( anchor ) anchor.after(fieldset);
  else root.querySelector("section.standard-form, .standard-form, form")?.append(fieldset);
}

/**
 * @param {foundry.applications.sheets.TileConfig} app
 * @param {HTMLElement} element
 */
function injectTileConfig(app, element) {
  if ( !game.user.isGM ) return;
  const root = element instanceof HTMLElement ? element : element?.[0];
  if ( !root || root.querySelector("[data-jinxed-night-maps]") ) return;

  const tile = app.document;
  const nightSrc = tile.getFlag(MODULE_ID, FLAG_NIGHT_TILE) || "";
  const daySrc = tile.getFlag(MODULE_ID, FLAG_DAY_TILE) || "";
  const perThreshold = tile.getFlag(MODULE_ID, FLAG_THRESHOLD);
  const thresholdValue = typeof perThreshold === "number" ? perThreshold : "";

  // While night texture is displayed, show stored day path in the main texture field.
  if ( nightSrc && daySrc && tile.texture?.src === nightSrc ) {
    const texInput = root.querySelector('file-picker[name="texture.src"], input[name="texture.src"]');
    if ( texInput ) {
      if ( "value" in texInput ) texInput.value = daySrc;
      texInput.setAttribute("value", daySrc);
    }
  }

  const fieldset = createNightFieldset({
    legendKey: "JINXED_TWEAKS.TileNightMaps.Legend",
    hintKey: "JINXED_TWEAKS.TileNightMaps.Hint",
    imageLabelKey: "JINXED_TWEAKS.TileNightMaps.NightTexture",
    imageFlag: FLAG_NIGHT_TILE,
    imageValue: nightSrc,
    thresholdValue
  });

  const appearance = root.querySelector('.tab[data-tab="appearance"], [data-application-part="appearance"]');
  const texGroup = root.querySelector('file-picker[name="texture.src"], input[name="texture.src"]')
    ?.closest(".form-group, fieldset");
  if ( appearance ) appearance.append(fieldset);
  else if ( texGroup ) texGroup.after(fieldset);
  else root.querySelector("section.standard-form, .standard-form, form, .sheet-body")?.append(fieldset);
}

/**
 * @param {Level} level
 * @param {object} changes
 * @param {object} options
 */
function onUpdateLevel(level, changes, options) {
  if ( options?.jinxedNightMaps || options?.jinxedLevelNightMaps ) return;
  if ( !isPrimaryGm() ) return;
  const scene = level.parent;
  if ( !scene ) return;

  const nightBg = (level.getFlag(MODULE_ID, FLAG_NIGHT_BG) || "").trim();
  const newBg = foundry.utils.getProperty(changes, "background.src");
  if ( typeof newBg === "string" && nightBg && newBg && newBg !== nightBg ) {
    const darkness = sceneDarkness(scene);
    if ( isNight(darkness, docThreshold(level)) ) {
      void level.setFlag(MODULE_ID, FLAG_DAY_BG, newBg).then(() => scheduleSync(scene));
      return;
    }
    void level.setFlag(MODULE_ID, FLAG_DAY_BG, newBg);
  }

  const touched = foundry.utils.getProperty(changes, "flags")?.[MODULE_ID]
    || foundry.utils.hasProperty(changes, "background")
    || foundry.utils.hasProperty(changes, "foreground");
  if ( touched ) scheduleSync(scene);
}

/**
 * @param {TileDocument} tile
 * @param {object} changes
 * @param {object} options
 */
function onUpdateTile(tile, changes, options) {
  if ( options?.jinxedNightMaps ) return;
  if ( !isPrimaryGm() ) return;
  const scene = tile.parent;
  if ( !scene ) return;

  const nightSrc = (tile.getFlag(MODULE_ID, FLAG_NIGHT_TILE) || "").trim();
  const newSrc = foundry.utils.getProperty(changes, "texture.src");
  if ( typeof newSrc === "string" && nightSrc && newSrc && newSrc !== nightSrc ) {
    const darkness = sceneDarkness(scene);
    if ( isNight(darkness, docThreshold(tile)) ) {
      void tile.setFlag(MODULE_ID, FLAG_DAY_TILE, newSrc).then(() => scheduleSync(scene));
      return;
    }
    void tile.setFlag(MODULE_ID, FLAG_DAY_TILE, newSrc);
  }

  const touched = foundry.utils.getProperty(changes, "flags")?.[MODULE_ID]
    || foundry.utils.hasProperty(changes, "texture");
  if ( touched ) scheduleSync(scene);
}

/**
 * Enable night texture swapping for Levels and Tiles.
 */
export function applyLevelNightMapTweaks() {
  Hooks.on("renderLevelConfig", (app, element) => injectLevelConfig(app, element));
  Hooks.on("renderTileConfig", (app, element) => injectTileConfig(app, element));

  const onDarknessChange = event => {
    const {darknessLevel, priorDarknessLevel} = event.environmentData ?? {};
    const scene = canvas?.scene;
    if ( !scene || !sceneHasNightTargets(scene) ) return;
    if ( typeof darknessLevel !== "number" || typeof priorDarknessLevel !== "number" ) {
      scheduleSync(scene);
      return;
    }
    if ( thresholdCrossed(scene, darknessLevel, priorDarknessLevel) ) scheduleSync(scene);
  };

  Hooks.on("canvasReady", () => {
    canvas.environment?.addEventListener("darknessChange", onDarknessChange);
    scheduleSync(canvas.scene);
  });

  Hooks.on("updateScene", (scene, changes) => {
    if ( !foundry.utils.hasProperty(changes, "environment.darknessLevel") ) return;
    if ( scene !== canvas?.scene ) return;
    scheduleSync(scene);
  });

  Hooks.on("updateLevel", onUpdateLevel);
  Hooks.on("updateTile", onUpdateTile);

  if ( canvas?.ready ) {
    canvas.environment?.addEventListener("darknessChange", onDarknessChange);
    scheduleSync(canvas.scene);
  }

  log("Level + tile night map swapping enabled");
}
