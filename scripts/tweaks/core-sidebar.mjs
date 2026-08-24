/**
 * Core sidebar — nest rarely used tabs under an "Other" (⋮) folder button.
 */

const NESTED_TABS = ["placeables", "items", "journal", "tables", "cards", "macros", "playlists"];
const OTHER_ID = "jinxed-sidebar-other";
const PANEL_ID = "jinxed-sidebar-other-panel";

function log(message, level="log") {
  console[level](`jinxed-tweaks | core-sidebar | ${message}`);
}

/**
 * Resolve display metadata for a sidebar tab id.
 * @param {string} tabId
 * @returns {{id: string, label: string, icon: string}|null}
 */
function resolveTabMeta(tabId) {
  const cfg = foundry.applications.sidebar.Sidebar.TABS?.[tabId];
  if ( !cfg ) return null;
  if ( cfg.gmOnly && !game.user.isGM ) return null;

  let {documentName, tooltip, icon} = cfg;
  if ( documentName ) {
    const Cls = getDocumentClass(documentName);
    tooltip ??= Cls?.metadata?.labelPlural;
    icon ??= CONFIG[documentName]?.sidebarIcon;
  }
  if ( !tooltip || !icon ) return null;

  const app = ui[tabId];
  if ( app && app._canRender?.({isFirstRender: true}) === false ) return null;

  return {
    id: tabId,
    label: game.i18n.localize(tooltip),
    icon
  };
}

/**
 * @returns {HTMLElement|null}
 */
function getTabsMenu() {
  return ui.sidebar?.element?.querySelector("#sidebar-tabs > menu") ?? null;
}

/**
 * Hide nested tab buttons from the main strip.
 * @param {HTMLElement} menu
 */
function hideNestedTabButtons(menu) {
  for ( const tabId of NESTED_TABS ) {
    const button = menu.querySelector(`button[data-tab="${tabId}"]`);
    const li = button?.closest("li");
    if ( !li ) continue;
    li.classList.add("jinxed-sidebar-nested");
    li.hidden = true;
  }
}

/**
 * @param {HTMLElement} otherButton
 */
function syncOtherActiveState(otherButton) {
  const active = NESTED_TABS.includes(ui.sidebar?.tabGroups?.primary);
  otherButton.setAttribute("aria-pressed", String(active));
  otherButton.classList.toggle("active", active);
}

/**
 * @param {boolean} [open]
 */
function setPanelOpen(open) {
  const panel = document.getElementById(PANEL_ID);
  const button = document.getElementById(OTHER_ID);
  if ( !panel || !button ) return;
  const next = open ?? !panel.classList.contains("open");
  panel.classList.toggle("open", next);
  button.setAttribute("aria-expanded", String(next));
}

function closePanel() {
  setPanelOpen(false);
}

/**
 * Build / refresh the Other folder control and its flyout panel.
 * @param {HTMLElement} menu
 */
function ensureOtherControl(menu) {
  menu.querySelector(`.${OTHER_ID}-wrap`)?.remove();
  document.getElementById(PANEL_ID)?.remove();

  const entries = NESTED_TABS.map(resolveTabMeta).filter(Boolean);
  if ( !entries.length ) return;

  const wrap = document.createElement("li");
  wrap.className = `${OTHER_ID}-wrap`;

  const button = document.createElement("button");
  button.type = "button";
  button.id = OTHER_ID;
  button.className = "ui-control plain icon fa-solid fa-ellipsis-vertical";
  button.dataset.tooltip = game.i18n.localize("JINXED_TWEAKS.Sidebar.Other");
  button.setAttribute("aria-label", game.i18n.localize("JINXED_TWEAKS.Sidebar.Other"));
  button.setAttribute("aria-haspopup", "menu");
  button.setAttribute("aria-expanded", "false");
  button.setAttribute("aria-controls", PANEL_ID);
  button.setAttribute("aria-pressed", "false");

  const panel = document.createElement("div");
  panel.id = PANEL_ID;
  panel.className = "jinxed-sidebar-other-panel";
  panel.setAttribute("role", "menu");
  panel.setAttribute("aria-label", game.i18n.localize("JINXED_TWEAKS.Sidebar.Other"));

  for ( const entry of entries ) {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "jinxed-sidebar-other-item ui-control";
    item.dataset.tab = entry.id;
    item.setAttribute("role", "menuitem");
    item.setAttribute("aria-label", entry.label);
    item.innerHTML = `<i class="${entry.icon}" aria-hidden="true"></i><span>${entry.label}</span>`;
    item.addEventListener("click", event => {
      event.preventDefault();
      event.stopPropagation();
      closePanel();
      ui.sidebar.changeTab(entry.id, "primary");
      if ( !ui.sidebar.expanded ) ui.sidebar.expand();
      syncOtherActiveState(button);
    });
    item.addEventListener("contextmenu", event => {
      event.preventDefault();
      event.stopPropagation();
      closePanel();
      ui[entry.id]?.renderPopout?.();
    });
    panel.append(item);
  }

  button.addEventListener("click", event => {
    event.preventDefault();
    event.stopPropagation();
    setPanelOpen();
  });

  wrap.append(button, panel);

  // Place Other at the end of the tab strip, immediately before collapse/expand.
  const collapse = menu.querySelector(`button[data-action="toggleState"]`)?.closest("li");
  if ( collapse ) collapse.before(wrap);
  else menu.append(wrap);

  syncOtherActiveState(button);
}

/**
 * Apply the Other-folder layout after sidebar renders.
 */
function applySidebarLayout() {
  const menu = getTabsMenu();
  if ( !menu ) return;
  hideNestedTabButtons(menu);
  ensureOtherControl(menu);
}

/**
 * Register sidebar Other-folder overwrite.
 */
export function applyCoreSidebarTweaks() {
  Hooks.on("renderSidebar", () => {
    // Defer so Foundry can finish toggling tab button visibility first.
    queueMicrotask(applySidebarLayout);
  });

  Hooks.on("changeSidebarTab", () => {
    const button = document.getElementById(OTHER_ID);
    if ( button ) syncOtherActiveState(button);
    closePanel();
  });

  document.addEventListener("pointerdown", event => {
    const panel = document.getElementById(PANEL_ID);
    if ( !panel?.classList.contains("open") ) return;
    const path = event.composedPath?.() ?? [];
    if ( path.includes(panel) || path.includes(document.getElementById(OTHER_ID)) ) return;
    closePanel();
  });

  applySidebarLayout();
  log("Nested Placeables/Items/Journal/Tables/Cards/Macros/Playlists under Other (⋮)");
}
