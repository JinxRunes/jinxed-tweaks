/**
 * Persist Scene (maps) and Actor (characters) sidebar folder expand/collapse
 * across browser sessions. Foundry only keeps game.folders._expanded in memory.
 */

const MODULE_ID = "jinxed-tweaks";
const SETTING_KEY = "sidebarFolderExpanded";
const PERSIST_TYPES = new Set(["Actor", "Scene"]);

function log(message, level="log") {
  console[level](`jinxed-tweaks | sidebar-folder-state | ${message}`);
}

/**
 * Register client setting (call from Hooks.once("init")).
 */
export function registerSidebarFolderStateSettings() {
  game.settings.register(MODULE_ID, SETTING_KEY, {
    scope: "client",
    config: false,
    type: Object,
    default: {}
  });
}

/**
 * @returns {Record<string, boolean>}
 */
function readSaved() {
  const raw = game.settings.get(MODULE_ID, SETTING_KEY);
  return raw && typeof raw === "object" ? {...raw} : {};
}

/**
 * @param {string|null|undefined} uuid
 * @returns {Folder|null}
 */
function folderFromUuid(uuid) {
  if ( !uuid || typeof uuid !== "string" ) return null;
  const id = uuid.includes(".") ? uuid.split(".").pop() : uuid;
  return game.folders?.get(id) ?? null;
}

/**
 * Snapshot currently expanded Actor/Scene folders into the client setting.
 */
async function persistExpanded() {
  const expanded = game.folders?._expanded;
  if ( !expanded ) return;

  const next = {};
  for ( const [uuid, on] of Object.entries(expanded) ) {
    if ( !on ) continue;
    const folder = folderFromUuid(uuid);
    if ( !folder || !PERSIST_TYPES.has(folder.type) ) continue;
    next[uuid] = true;
  }

  const prev = readSaved();
  if ( foundry.utils.equals(prev, next) ) return;
  await game.settings.set(MODULE_ID, SETTING_KEY, next);
}

let persistTimer = null;

/**
 * Debounced persist so collapse-all does one write.
 */
function schedulePersist() {
  if ( persistTimer ) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    persistTimer = null;
    void persistExpanded().catch(err => {
      log(`Persist failed: ${err?.message ?? err}`, "warn");
    });
  }, 100);
}

/**
 * Hydrate game.folders._expanded from the client setting before directories paint.
 */
function restoreExpanded() {
  if ( !game.folders?._expanded ) return;
  const saved = readSaved();
  let count = 0;
  for ( const [uuid, on] of Object.entries(saved) ) {
    if ( !on ) continue;
    const folder = folderFromUuid(uuid);
    if ( folder && !PERSIST_TYPES.has(folder.type) ) continue;
    game.folders._expanded[uuid] = true;
    count += 1;
  }
  if ( count ) log(`Restored ${count} expanded Actor/Scene folder(s)`);
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
  if ( typeof original !== "function" || original.__jinxSidebarFolders ) return false;
  const patched = function(...args) {
    return wrapper.call(this, original.bind(this), ...args);
  };
  patched.__jinxSidebarFolders = true;
  parent[methodName] = patched;
  return true;
}

/**
 * After a folder toggle, persist Actor/Scene expand state.
 * @param {Function} wrapped
 * @param {...any} args
 */
function wrapOnToggleFolder(wrapped, ...args) {
  const result = wrapped(...args);
  schedulePersist();
  return result;
}

/**
 * After collapse-all, persist so closed folders stay closed next session.
 * @param {Function} wrapped
 * @param {...any} args
 */
function wrapCollapseAll(wrapped, ...args) {
  const result = wrapped(...args);
  schedulePersist();
  return result;
}

/**
 * Persist Scene/Actor sidebar folder expand state across reloads.
 */
export function applySidebarFolderStateTweaks() {
  restoreExpanded();

  const toggleOk = registerWrap(
    "foundry.applications.sidebar.DocumentDirectory.prototype._onToggleFolder",
    wrapOnToggleFolder
  );
  const collapseOk = registerWrap(
    "foundry.applications.sidebar.DocumentDirectory.prototype.collapseAll",
    wrapCollapseAll
  );
  if ( !toggleOk ) log("Failed to wrap _onToggleFolder", "warn");
  if ( !collapseOk ) log("Failed to wrap collapseAll", "warn");

  // Directories may already have rendered before setup restore; re-apply classes.
  for ( const app of [ui.scenes, ui.actors] ) {
    if ( !app?.element ) continue;
    for ( const el of app.element.querySelectorAll(".directory-item.folder[data-uuid]") ) {
      const uuid = el.dataset.uuid;
      el.classList.toggle("expanded", Boolean(game.folders._expanded[uuid]));
    }
  }

  log("Scene/Actor sidebar folder expand persistence enabled");
}
