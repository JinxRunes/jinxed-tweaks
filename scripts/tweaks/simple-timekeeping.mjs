/**
 * Simple Timekeeping — restore gradual day/night darkness sync.
 *
 * Upstream Scene Config injects its darknessSync <select> on every render
 * without deduping. ApplicationV2 re-renders leave multiple identical fields;
 * save then stores flags.simple-timekeeping.darknessSync as an array like
 * ["default","default"]. STK only treats string "sync" / "darknessOnly" as
 * enabled, so sync silently stops.
 *
 * This tweak:
 * - Dedupes the Scene Config fieldset on render
 * - Migrates corrupted array flags back to a string
 * - Wraps updateSceneBrightness to coerce sync mode safely
 * - Ensures world darknessSync defaults to "sync" and runs one refresh
 */

const TARGET_MODULE_ID = "simple-timekeeping";
const JINXED_ID = "jinxed-tweaks";

const SYNC_MODES = new Set(["default", "sync", "weatherOnly", "darknessOnly", "noSync"]);

function log(message, level="log") {
  console[level](`jinxed-tweaks | simple-timekeeping | ${message}`);
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function coerceSyncMode(value) {
  if ( typeof value === "string" && SYNC_MODES.has(value) ) return value;
  if ( Array.isArray(value) ) {
    const first = value.find(v => typeof v === "string" && SYNC_MODES.has(v));
    if ( first ) return first;
  }
  return "default";
}

/**
 * @param {Scene} scene
 * @returns {string}
 */
function sceneSyncMode(scene) {
  return coerceSyncMode(scene.getFlag(TARGET_MODULE_ID, "darknessSync") ?? "default");
}

/**
 * @returns {string}
 */
function worldSyncMode() {
  try {
    const mode = game.settings.get(TARGET_MODULE_ID, "configuration")?.darknessSync;
    return coerceSyncMode(mode || "sync");
  }
  catch {
    return "sync";
  }
}

/**
 * @param {Scene} scene
 * @returns {string} Effective sync mode (never "default")
 */
function effectiveSyncMode(scene) {
  const sceneMode = sceneSyncMode(scene);
  return sceneMode === "default" ? worldSyncMode() : sceneMode;
}

/**
 * @param {Scene} scene
 * @returns {boolean}
 */
function sceneWantsDarkness(scene) {
  const mode = effectiveSyncMode(scene);
  return mode === "sync" || mode === "darknessOnly";
}

/**
 * Migrate corrupted per-scene darknessSync flags.
 * @returns {Promise<number>}
 */
async function migrateCorruptedSyncFlags() {
  if ( !game.user?.isGM || !game.users.activeGM?.isSelf ) return 0;
  let fixed = 0;
  for ( const scene of game.scenes ) {
    const raw = scene.getFlag(TARGET_MODULE_ID, "darknessSync");
    if ( !Array.isArray(raw) && (raw == null || typeof raw === "string") ) continue;
    const coerced = coerceSyncMode(raw);
    await scene.setFlag(TARGET_MODULE_ID, "darknessSync", coerced);
    fixed += 1;
  }
  if ( fixed ) log(`Repaired darknessSync flags on ${fixed} scene(s)`);
  return fixed;
}

/**
 * Keep only one Simple Timekeeping fieldset in Scene Config.
 * @param {Application} app
 * @param {HTMLElement} element
 */
function dedupeSceneConfigFieldset(app, element) {
  const root = element instanceof HTMLElement ? element : element?.[0];
  const tab = root?.querySelector?.('.tab[data-tab="environment"]');
  if ( !tab ) return;

  const fieldsets = [...tab.querySelectorAll("fieldset")].filter(fs => {
    const legend = fs.querySelector("legend")?.textContent?.trim() || "";
    return legend === "Simple Timekeeping" || fs.querySelector(`select[name="flags.${TARGET_MODULE_ID}.darknessSync"]`);
  });
  for ( let i = 1; i < fieldsets.length; i++ ) fieldsets[i].remove();

  // If the remaining select shows an array-ish selected state, normalize UI.
  const select = tab.querySelector(`select[name="flags.${TARGET_MODULE_ID}.darknessSync"]`);
  if ( select ) {
    const coerced = coerceSyncMode(app.document.getFlag(TARGET_MODULE_ID, "darknessSync") ?? "default");
    if ( select.value !== coerced ) select.value = coerced;
  }
}

/**
 * Wrap STK brightness updates so array flags cannot disable sync.
 * @param {object} stk
 */
function patchUpdateSceneBrightness(stk) {
  if ( !stk || stk._jinxedDarknessPatched ) return;
  stk._jinxedDarknessPatched = true;

  const original = stk.updateSceneBrightness?.bind(stk);
  if ( typeof original !== "function" ) {
    log("updateSceneBrightness missing; installing fallback", "warn");
    stk.updateSceneBrightness = function jinxedUpdateSceneBrightnessFallback() {
      void jinxedUpdateSceneBrightness(this);
    };
    return;
  }

  stk.updateSceneBrightness = function jinxedUpdateSceneBrightnessWrapper() {
    // Prefer our coercion path; fall back to upstream if something throws.
    try {
      return jinxedUpdateSceneBrightness(this);
    }
    catch (error) {
      log(`Patched brightness update failed, trying upstream: ${error?.message || error}`, "warn");
      return original();
    }
  };
}

/**
 * Gradual day/night darkness write (mirrors STK, with safe sync resolution).
 * @param {object} stk ui.simpleTimekeeping
 */
function jinxedUpdateSceneBrightness(stk) {
  if ( !game.user?.isActiveGM ) return;

  const configuration = game.settings.get(TARGET_MODULE_ID, "configuration") || {};
  const dayTimePercent = typeof stk.dayTimePercent === "number" ? stk.dayTimePercent : 0;
  const dawn = Number.isFinite(stk.dawn) ? stk.dawn : (configuration.dawn ?? 0.23);
  const dusk = Number.isFinite(stk.dusk) ? stk.dusk : (configuration.dusk ?? 0.77);
  const darknessLevel = 1 - getBrightness(dayTimePercent, dawn, dusk);
  const hueIntensity = configuration.hueIntensity ?? 0.3;

  const updateData = {
    "environment.darknessLevel": darknessLevel,
    "environment.base.intensity": hueIntensity,
    "environment.dark.intensity": hueIntensity,
    "environment.dark.hue": getHueFromHex(configuration.nightColor || "#3a4883") / 360,
    "environment.base.hue": getHueFromHex(configuration.dayColor || "#e2c018") / 360
  };

  const scenes = getViewedScenes();
  for ( const scene of scenes ) {
    if ( !scene || !sceneWantsDarkness(scene) ) continue;
    if ( scene.environment?.darknessLock ) continue;
    const current = scene.environment?.darknessLevel;
    // Skip no-op updates to avoid restarting the 10s animateDarkness loop every tick.
    if ( typeof current === "number" && Math.abs(current - darknessLevel) < 0.002 ) continue;
    scene.update(updateData, {animateDarkness: true});
  }
}

/**
 * @returns {Scene[]}
 */
function getViewedScenes() {
  const ids = new Set([game.scenes.active?.id, ...game.users.map(u => u.viewedScene)].filter(Boolean));
  return [...ids].map(id => game.scenes.get(id)).filter(Boolean);
}

/**
 * Brightness curve copied from Simple Timekeeping (getBrightness).
 * @param {number} time
 * @param {number} dawn
 * @param {number} dusk
 * @returns {number}
 */
function getBrightness(time, dawn=0.23, dusk=0.77) {
  if ( dawn >= dusk ) {
    dawn = 0.23;
    dusk = 0.77;
  }
  const points = [
    {x: 0, y: 0},
    {x: Math.max(0, dawn - 0.05), y: 0},
    {x: dawn, y: 0.75},
    {x: 0.5, y: 1.0},
    {x: dusk, y: 0.25},
    {x: Math.min(1.0, dusk + 0.05), y: 0},
    {x: 1.0, y: 0}
  ];
  return sampleCurve(points, time);
}

/**
 * @param {{x:number,y:number}[]} points
 * @param {number} x
 * @returns {number}
 */
function sampleCurve(points, x) {
  if ( x <= points[0].x ) return points[0].y;
  for ( let i = 1; i < points.length; i++ ) {
    const a = points[i - 1];
    const b = points[i];
    if ( x <= b.x ) {
      const t = (x - a.x) / Math.max(1e-9, b.x - a.x);
      return a.y + (b.y - a.y) * t;
    }
  }
  return points[points.length - 1].y;
}

/**
 * @param {string} hex
 * @returns {number} degrees 0–360
 */
function getHueFromHex(hex) {
  hex = String(hex || "").replace("#", "");
  const bigint = parseInt(hex, 16);
  if ( !Number.isFinite(bigint) ) return 0;
  const r = ((bigint >> 16) & 255) / 255;
  const g = ((bigint >> 8) & 255) / 255;
  const b = (bigint & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if ( max === min ) return 0;
  const d = max - min;
  let h;
  switch ( max ) {
    case r: h = (g - b) / d + (g < b ? 6 : 0); break;
    case g: h = (b - r) / d + 2; break;
    default: h = (r - g) / d + 4; break;
  }
  return h * 60;
}

/**
 * Ensure world configuration still requests darkness sync.
 */
async function ensureWorldSyncEnabled() {
  if ( !game.user?.isGM || !game.users.activeGM?.isSelf ) return;
  const configuration = foundry.utils.duplicate(game.settings.get(TARGET_MODULE_ID, "configuration") || {});
  const mode = coerceSyncMode(configuration.darknessSync);
  if ( mode === "noSync" || mode === "weatherOnly" ) {
    // Respect intentional disable — only repair invalid/missing.
    if ( SYNC_MODES.has(configuration.darknessSync) ) return;
  }
  if ( configuration.darknessSync === "sync" ) return;
  if ( typeof configuration.darknessSync === "string" && SYNC_MODES.has(configuration.darknessSync) ) return;

  configuration.darknessSync = "sync";
  await game.settings.set(TARGET_MODULE_ID, "configuration", configuration);
  log("Restored world darknessSync to \"sync\"");
}

/**
 * Apply Simple Timekeeping darkness sync repairs.
 */
export function applySimpleTimekeepingTweaks() {
  Hooks.on("renderSceneConfig", (app, element) => {
    // Run after STK's inject (same hook, later registration + microtask).
    queueMicrotask(() => dedupeSceneConfigFieldset(app, element));
  });

  const boot = async () => {
    const stk = ui.simpleTimekeeping;
    if ( !stk ) {
      log("ui.simpleTimekeeping missing", "warn");
      return;
    }

    patchUpdateSceneBrightness(stk);
    await migrateCorruptedSyncFlags();
    await ensureWorldSyncEnabled();

    // Do not touch simple-timekeeping.paused — proceed/pause must persist across sessions.

    stk.updateSceneBrightness();
    log("Darkness sync repair enabled");
  };

  if ( game.ready ) void boot();
  else Hooks.once("ready", () => void boot());
}
