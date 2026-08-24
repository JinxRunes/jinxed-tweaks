/**
 * DM Map Notes — GM-only area notes on the current scene.
 *
 * "Add DM Note" under Journal Notes: drag empty canvas to draw an area, then
 * open a Token Notes–style editor. Existing notes can be selected, moved,
 * locked, and deleted (Delete key or context menu). Data lives on the Scene
 * flag `jinxed-tweaks.dmNotes` — never as JournalEntry / canvas Note docs.
 */

const MODULE_ID = "jinxed-tweaks";
const FLAG_KEY = "dmNotes";
const TOOL_NAME = "dmNote";
const WRAPPER_ID = "jinxed-tweaks";
const APP_ID = "jinxed-dm-map-notes";
const MIN_AREA = 16;
const MARKER_COLOR = 0xf0c14a;
const AREA_FILL = 0xf0c14a;
const SELECTED_COLOR = 0xff9829;
const LOCKED_COLOR = 0x999999;
const CTX_ID = "jinxed-dm-note-context";

/** @type {DmMapNotesController|null} */
let controller = null;

/** @type {DmMapNotesApp|null} */
let notesApp = null;

function log(message, level="log") {
  console[level](`jinxed-tweaks | dm-map-notes | ${message}`);
}

/**
 * Strict GM gate — Assistant GM / Gamemaster only.
 * Trusted players (`CONST.USER_ROLES.TRUSTED`) must never see or touch DM notes.
 * @returns {boolean}
 */
function isDungeonMaster() {
  return game.user?.isGM === true;
}

/**
 * @returns {boolean}
 */
function isDmNoteTool() {
  return isDungeonMaster()
    && canvas?.notes?.active === true
    && game.activeTool === TOOL_NAME;
}

/**
 * Host PIXI container for DM markers (always interactive for GM).
 * Prefer interface so markers are not gated by NotesLayer activate/deactivate.
 * @returns {PIXI.Container|null}
 */
function markerParent() {
  return canvas?.interface ?? canvas?.notes ?? canvas?.stage ?? null;
}

/**
 * @returns {number}
 */
function currentElevation() {
  try {
    const ui = CONFIG.Levels?.UI;
    if ( ui && (ui.rangeEnabled || Number.isFinite(ui.rangeBottom)) ) {
      return Number(ui.rangeBottom ?? 0);
    }
  } catch { /* ignore */ }
  const token = canvas.tokens?.controlled?.[0];
  if ( token ) return Number(token.document.elevation ?? 0);
  return 0;
}

/**
 * @param {{elevation?: number}} note
 * @returns {boolean}
 */
function noteOnCurrentLevel(note) {
  try {
    const ui = CONFIG.Levels?.UI;
    if ( ui?.rangeEnabled ) {
      const bottom = Number(ui.rangeBottom ?? -Infinity);
      const top = Number(ui.rangeTop ?? Infinity);
      const elev = Number(note.elevation ?? 0);
      return elev >= bottom && elev < top;
    }
  } catch { /* ignore */ }
  return true;
}

/**
 * @param {Scene|null|undefined} [scene]
 * @returns {object[]}
 */
function readNotes(scene=canvas.scene) {
  const raw = scene?.getFlag(MODULE_ID, FLAG_KEY);
  return Array.isArray(raw) ? foundry.utils.deepClone(raw) : [];
}

/**
 * @param {object[]} notes
 * @param {Scene|null|undefined} [scene]
 * @returns {Promise<Scene|undefined>}
 */
async function writeNotes(notes, scene=canvas.scene) {
  if ( !scene || !isDungeonMaster() ) return undefined;
  return scene.setFlag(MODULE_ID, FLAG_KEY, notes);
}

/**
 * @param {Partial<object>} data
 * @returns {object}
 */
function makeNote(data={}) {
  const elev = Number.isFinite(data.elevation) ? data.elevation : currentElevation();
  return {
    id: data.id || foundry.utils.randomID(),
    x: Number(data.x) || 0,
    y: Number(data.y) || 0,
    width: Math.max(0, Number(data.width) || 0),
    height: Math.max(0, Number(data.height) || 0),
    elevation: elev,
    notes: typeof data.notes === "string" ? data.notes : "",
    locked: Boolean(data.locked),
    updatedAt: Date.now()
  };
}

/**
 * @param {number} x0
 * @param {number} y0
 * @param {number} x1
 * @param {number} y1
 */
function normalizeRect(x0, y0, x1, y1) {
  const x = Math.min(x0, x1);
  const y = Math.min(y0, y1);
  return {x, y, width: Math.abs(x1 - x0), height: Math.abs(y1 - y0)};
}

/**
 * @param {PIXI.FederatedEvent|PointerEvent} event
 * @returns {{x: number, y: number}|null}
 */
function localPoint(event) {
  if ( event?.getLocalPosition && canvas?.notes ) {
    try {
      return event.getLocalPosition(canvas.notes);
    } catch { /* fall through */ }
  }
  const data = event?.interactionData;
  if ( data?.destination ) return data.destination;
  if ( data?.origin ) return data.origin;
  return null;
}

/* -------------------------------------------- */
/*  Token Notes–style editor                    */
/* -------------------------------------------- */

class DmMapNotesApp extends foundry.applications.api.ApplicationV2 {
  static DEFAULT_OPTIONS = {
    id: APP_ID,
    classes: [APP_ID, "token-notes"],
    tag: "div",
    window: {
      title: "JINXED_TWEAKS.DmMapNotes.Title",
      icon: "fa-solid fa-note-sticky",
      resizable: true
    },
    position: {width: 360, height: 320},
    actions: {
      toggleEdit: DmMapNotesApp.#toggleEdit,
      deleteNote: DmMapNotesApp.#deleteNote
    }
  };

  /** @type {object|null} */
  note = null;

  #editMode = true;

  /**
   * @param {object|null} note
   */
  constructor(note=null) {
    super();
    this.note = note ? foundry.utils.deepClone(note) : null;
  }

  /** @override */
  get title() {
    const base = game.i18n.localize("JINXED_TWEAKS.DmMapNotes.Title");
    if ( !this.note ) return base;
    const scene = canvas.scene?.name ?? "";
    return scene ? `${base} — ${scene}` : base;
  }

  /**
   * Place the window in the bottom-left of the viewport (above hotbar, right of controls).
   */
  #pinBottomLeft() {
    if ( !this.element ) return;
    const margin = 12;
    const width = Number(this.position?.width) || 360;
    const height = Number(this.position?.height) || 320;

    const controlsEl = ui.controls?.element;
    const controlsBox = controlsEl?.getBoundingClientRect?.();
    const controlsW = controlsBox?.width ?? controlsEl?.offsetWidth ?? 0;

    const hotbarEl = ui.hotbar?.element;
    const hotbarBox = hotbarEl?.getBoundingClientRect?.();
    const hotbarH = hotbarBox?.height ?? hotbarEl?.offsetHeight ?? 0;

    const left = Math.max(margin, Math.round(controlsW) + margin);
    const top = Math.max(margin, Math.round(window.innerHeight - height - hotbarH - margin));
    this.setPosition({left, top, width, height});
  }

  /**
   * @param {object|null} note
   */
  async bind(note) {
    const previous = this.note?.id;
    this.note = note ? foundry.utils.deepClone(note) : null;
    if ( !this.note ) return this.close();
    if ( previous !== this.note.id ) this.#editMode = true;
    await this.render({force: true, window: {title: this.title}});
    this.#pinBottomLeft();
    return this;
  }

  /** @override */
  _onFirstRender(context, options) {
    super._onFirstRender?.(context, options);
    this.#pinBottomLeft();
  }

  /** @override */
  async _prepareContext() {
    return {note: this.note, editMode: this.#editMode};
  }

  /** @override */
  async _renderHTML() {
    const root = document.createElement("div");
    root.className = "token-notes-container jinxed-dm-map-notes-container";
    root.innerHTML = `
      <textarea name="dm-map-notes-text" class="jinxed-dm-map-notes-text" rows="10"></textarea>
      <div class="token-notes-text-read jinxed-dm-map-notes-read"></div>
    `;
    return root;
  }

  /** @override */
  _replaceHTML(result, content) {
    content.replaceChildren(result);
  }

  /** @override */
  async _renderFrame(options) {
    const frame = await super._renderFrame(options);
    const close = this.window?.close;
    if ( !close ) return frame;

    const editLabel = game.i18n.localize("JINXED_TWEAKS.DmMapNotes.ToggleEdit");
    const editIcon = this.#editMode ? "fa-solid fa-comment" : "fa-solid fa-edit";
    close.insertAdjacentHTML("beforebegin",
      `<button type="button" class="header-control icon ${editIcon}" data-action="toggleEdit"
        data-tooltip="${editLabel}" aria-label="${editLabel}"></button>`);

    const deleteLabel = game.i18n.localize("Delete");
    close.insertAdjacentHTML("beforebegin",
      `<button type="button" class="header-control icon fa-solid fa-trash" data-action="deleteNote"
        data-tooltip="${deleteLabel}" aria-label="${deleteLabel}"></button>`);

    return frame;
  }

  /** @override */
  _onRender(context, options) {
    super._onRender?.(context, options);
    const html = this.element;
    this.textarea = html.querySelector("textarea");
    this.readarea = html.querySelector(".jinxed-dm-map-notes-read");
    if ( !this.textarea || !this.readarea ) return;

    this.textarea.value = this.note?.notes ?? "";
    if ( this.#editMode ) this.#showEdit();
    else {
      this.#showRead();
      this.#generateReadArea();
    }

    const btn = html.querySelector('.header-control[data-action="toggleEdit"]');
    if ( btn ) {
      btn.classList.remove("fa-edit", "fa-comment");
      btn.classList.add(this.#editMode ? "fa-comment" : "fa-edit");
    }

    this.textarea.addEventListener("change", () => this.#save());
    this.textarea.addEventListener("blur", () => this.#save());
  }

  /** @override */
  async _onClose(options) {
    await this.#save();
    // User dismissed the window → clear canvas selection (avoid loop when
    // clearSelection closes us via jinxedFromSelection).
    if ( !options?.jinxedFromSelection && controller ) {
      controller.deselectAll({closeWindow: false});
    }
    return super._onClose(options);
  }

  async #save() {
    if ( !this.note?.id || !this.textarea ) return;
    const text = this.textarea.value ?? "";
    const notes = readNotes();
    const idx = notes.findIndex(n => n.id === this.note.id);
    if ( idx < 0 ) return;
    if ( notes[idx].notes === text ) {
      this.note.notes = text;
      return;
    }
    notes[idx] = {...notes[idx], notes: text, updatedAt: Date.now()};
    this.note.notes = text;
    await writeNotes(notes);
  }

  #showEdit() {
    this.#editMode = true;
    this.textarea?.classList.remove("hidden");
    this.readarea?.classList.add("hidden");
  }

  #showRead() {
    this.#editMode = false;
    this.textarea?.classList.add("hidden");
    this.readarea?.classList.remove("hidden");
  }

  #generateReadArea() {
    if ( !this.readarea || !this.textarea ) return;
    const text = this.textarea.value;
    const lines = text.split("\n");
    let parts = [];
    for ( const line of lines ) {
      parts = parts.concat(line.split(" ").filter(p => p.length > 0));
      parts.push("\n");
    }
    parts.pop();

    // Zero-size flex break (not <hr> — Foundry typography gives hr 1rem margins).
    const breakHtml = `<span class="jinxed-dm-notes-break" aria-hidden="true"></span>`;
    let content = "";
    let lastWasBreak = false;
    for ( const part of parts ) {
      if ( part === "\n" ) {
        // Collapse blank lines so read mode stays tight like normal notes text.
        if ( lastWasBreak ) continue;
        content += breakHtml;
        lastWasBreak = true;
        continue;
      }
      lastWasBreak = false;
      const isNumber = /^\d+$/.test(part);
      if ( isNumber ) {
        content += `<input type="number" value="${part}" min="0" style="width:${part.length + 1}rem;">`;
      }
      else {
        content += `<span class="token-notes-text-read-word">${foundry.utils.escapeHTML(part)}</span>`;
      }
    }
    this.readarea.innerHTML = content;
    this.readarea.querySelectorAll("input").forEach(input => {
      input.addEventListener("change", () => this.#syncFromReadArea());
    });
  }

  #syncFromReadArea() {
    if ( !this.readarea || !this.textarea ) return;
    let text = "";
    for ( const child of this.readarea.children ) {
      if ( child.nodeName === "HR" || child.classList?.contains("jinxed-dm-notes-break") ) {
        text += "\n";
      }
      else {
        text += child.value ? child.value : child.innerText;
        text += " ";
      }
    }
    this.textarea.value = text.trim();
    this.#save();
  }

  /**
   * @this {DmMapNotesApp}
   * @param {PointerEvent} event
   */
  static #toggleEdit(event) {
    event.preventDefault();
    if ( this.#editMode ) {
      this.#save();
      this.#showRead();
      this.#generateReadArea();
    }
    else this.#showEdit();

    const btn = this.element.querySelector('.header-control[data-action="toggleEdit"]');
    if ( !btn ) return;
    const icon = this.#editMode ? "fa-comment" : "fa-edit";
    const old = this.#editMode ? "fa-edit" : "fa-comment";
    btn.classList.replace(old, icon);
  }

  /**
   * @this {DmMapNotesApp}
   * @param {PointerEvent} event
   */
  static async #deleteNote(event) {
    event.preventDefault();
    if ( !this.note?.id ) return;
    const ok = await controller?.deleteNotes([this.note.id], {confirm: true});
    if ( ok ) {
      this.note = null;
      await this.close({submitted: true});
    }
  }
}

/**
 * @param {object|string} noteOrId
 */
function openNotesWindow(noteOrId) {
  if ( !isDungeonMaster() ) return;
  const note = typeof noteOrId === "string"
    ? readNotes().find(n => n.id === noteOrId)
    : noteOrId;
  if ( !note ) return;
  if ( !notesApp ) notesApp = new DmMapNotesApp();
  // Re-bind if same note so a closed window reopens; bind already force-renders.
  notesApp.bind(note);
}

/**
 * Close the DM notes window when nothing is selected.
 */
function closeNotesWindow() {
  if ( !notesApp ) return;
  if ( !notesApp.rendered ) return;
  notesApp.close({jinxedFromSelection: true});
}

/* -------------------------------------------- */
/*  Context menu                                */
/* -------------------------------------------- */

function closeContextMenu() {
  document.getElementById(CTX_ID)?.remove();
  document.removeEventListener("pointerdown", onContextOutside, true);
}

/**
 * @param {PointerEvent} event
 */
function onContextOutside(event) {
  const menu = document.getElementById(CTX_ID);
  if ( !menu ) return;
  if ( menu.contains(event.target) ) return;
  closeContextMenu();
}

/**
 * @param {number} clientX
 * @param {number} clientY
 * @param {object} note
 */
function showContextMenu(clientX, clientY, note) {
  closeContextMenu();
  const locked = Boolean(note.locked);
  const menu = document.createElement("menu");
  menu.id = CTX_ID;
  menu.className = "context-menu expand-down";
  menu.style.position = "fixed";
  menu.style.left = `${clientX}px`;
  menu.style.top = `${clientY}px`;
  menu.style.zIndex = "calc(var(--z-index-tooltip, 9999) + 1)";

  const items = [
    {
      icon: "fa-solid fa-note-sticky",
      label: "JINXED_TWEAKS.DmMapNotes.Open",
      action: () => openNotesWindow(note.id)
    },
    {
      icon: locked ? "fa-solid fa-unlock" : "fa-solid fa-lock",
      label: locked ? "JINXED_TWEAKS.DmMapNotes.Unlock" : "JINXED_TWEAKS.DmMapNotes.Lock",
      action: () => controller?.setLocked(note.id, !locked)
    },
    {
      icon: "fa-solid fa-trash",
      label: "Delete",
      action: () => controller?.deleteNotes([note.id], {confirm: true})
    }
  ];

  const list = document.createElement("ol");
  list.className = "context-items";
  for ( const item of items ) {
    const li = document.createElement("li");
    li.className = "context-item";
    li.innerHTML = `<i class="${item.icon} fa-fw" inert></i><span>${game.i18n.localize(item.label)}</span>`;
    li.addEventListener("click", async event => {
      event.preventDefault();
      event.stopPropagation();
      closeContextMenu();
      await item.action();
    });
    list.append(li);
  }
  menu.append(list);
  document.body.append(menu);

  // Keep on-screen.
  const rect = menu.getBoundingClientRect();
  if ( rect.right > window.innerWidth ) {
    menu.style.left = `${Math.max(8, window.innerWidth - rect.width - 8)}px`;
  }
  if ( rect.bottom > window.innerHeight ) {
    menu.style.top = `${Math.max(8, window.innerHeight - rect.height - 8)}px`;
  }

  setTimeout(() => document.addEventListener("pointerdown", onContextOutside, true), 0);
}

/* -------------------------------------------- */
/*  Canvas markers + selection + move           */
/* -------------------------------------------- */

class DmMapNotesController {
  constructor() {
    /** @type {PIXI.Container|null} */
    this.container = null;
    /** @type {PIXI.Graphics|null} */
    this.preview = null;
    /** @type {Map<string, PIXI.Container>} */
    this.markers = new Map();
    /** @type {Set<string>} */
    this.selectedIds = new Set();
    this._dragOrigin = null;
    /** @type {object|null} */
    this._moveState = null;
    this._moveMoved = false;
  }

  attach() {
    // Players / trusted players: never create the overlay.
    if ( !isDungeonMaster() ) {
      this.detach();
      return;
    }
    if ( !canvas?.ready ) return;
    const parent = markerParent();
    if ( !parent ) return;

    if ( this.container && !this.container.destroyed ) {
      if ( this.container.parent !== parent ) parent.addChild(this.container);
      this.#ensureInteractive();
      this.refresh();
      return;
    }

    this.container = new PIXI.Container();
    this.container.label = "jinxedDmMapNotes";
    this.container.sortableChildren = true;
    this.container.zIndex = 5000;
    this.#ensureInteractive();
    parent.sortableChildren = true;
    parent.addChild(this.container);
    this.refresh();
  }

  /**
   * Keep hit-testing on even when the Notes layer is not the active tool.
   */
  #ensureInteractive() {
    if ( !this.container || this.container.destroyed ) return;
    this.container.eventMode = "static";
    this.container.interactiveChildren = true;
    this.container.visible = isDungeonMaster();
  }

  detach() {
    this.#endMoveListeners();
    this.clearPreview();
    closeContextMenu();
    if ( this.container && !this.container.destroyed ) {
      this.container.destroy({children: true});
    }
    this.container = null;
    this.markers.clear();
    this.selectedIds.clear();
  }

  refresh() {
    if ( !isDungeonMaster() ) {
      this.detach();
      return;
    }
    if ( !this.container || this.container.destroyed ) {
      this.attach();
      return;
    }

    const parent = markerParent();
    if ( parent && this.container.parent !== parent ) parent.addChild(this.container);
    this.#ensureInteractive();

    const keep = new Set(this.selectedIds);
    this.container.removeChildren().forEach(c => {
      if ( c === this.preview ) return;
      c.destroy({children: true});
    });
    this.markers.clear();

    // Always visible for the dungeon master (any active tool/layer).
    this.container.visible = true;

    const existing = new Set(readNotes().map(n => n.id));
    for ( const id of keep ) {
      if ( existing.has(id) ) this.selectedIds.add(id);
      else this.selectedIds.delete(id);
    }

    for ( const note of readNotes() ) {
      if ( !noteOnCurrentLevel(note) ) continue;
      const marker = this.#buildMarker(note);
      this.container.addChild(marker);
      this.markers.set(note.id, marker);
    }

    // Keep rubber-band on top if mid-draw.
    if ( this.preview && !this.preview.destroyed ) this.container.addChild(this.preview);
  }

  /**
   * @param {string} id
   * @param {{additive?: boolean, exclusive?: boolean}} [options]
   */
  select(id, {additive=false, exclusive=true}={}) {
    if ( exclusive && !additive ) this.selectedIds.clear();
    if ( additive && this.selectedIds.has(id) ) this.selectedIds.delete(id);
    else this.selectedIds.add(id);
    this.#paintSelection();
    this.#syncNotesWindow();
  }

  clearSelection() {
    this.deselectAll({closeWindow: true});
  }

  /**
   * @param {{closeWindow?: boolean}} [options]
   */
  deselectAll({closeWindow=true}={}) {
    if ( !this.selectedIds.size ) {
      if ( closeWindow ) closeNotesWindow();
      return;
    }
    this.selectedIds.clear();
    this.#paintSelection();
    if ( closeWindow ) closeNotesWindow();
  }

  /**
   * Show notes for the active selection; hide when nothing is selected.
   */
  #syncNotesWindow() {
    if ( !isDungeonMaster() ) {
      closeNotesWindow();
      return;
    }
    if ( !this.selectedIds.size ) {
      closeNotesWindow();
      return;
    }
    // Single or multi-select: show the most recently selected note.
    const id = [...this.selectedIds].at(-1);
    openNotesWindow(id);
  }

  #paintSelection() {
    for ( const [id, marker] of this.markers ) {
      const note = marker.jinxedDmNoteData;
      if ( !note ) continue;
      this.#drawMarkerGraphics(marker, note, this.selectedIds.has(id));
    }
  }

  /**
   * @param {string} id
   * @param {boolean} locked
   */
  async setLocked(id, locked) {
    const notes = readNotes();
    const idx = notes.findIndex(n => n.id === id);
    if ( idx < 0 ) return;
    notes[idx] = {...notes[idx], locked: Boolean(locked), updatedAt: Date.now()};
    await writeNotes(notes);
    this.refresh();
  }

  /**
   * @param {string[]} ids
   * @param {{confirm?: boolean}} [options]
   * @returns {Promise<boolean>}
   */
  async deleteNotes(ids, {confirm=false}={}) {
    if ( !ids?.length || !isDungeonMaster() ) return false;
    const notes = readNotes();
    const targets = notes.filter(n => ids.includes(n.id));
    if ( !targets.length ) return false;

    const locked = targets.filter(n => n.locked);
    const unlocked = targets.filter(n => !n.locked);
    if ( locked.length && !unlocked.length ) {
      ui.notifications.warn(game.i18n.localize("JINXED_TWEAKS.DmMapNotes.LockedWarn"));
      return false;
    }

    if ( confirm ) {
      const ok = await foundry.applications.api.DialogV2.confirm({
        window: {title: "JINXED_TWEAKS.DmMapNotes.DeleteConfirmTitle"},
        content: `<p>${game.i18n.localize("JINXED_TWEAKS.DmMapNotes.DeleteConfirm")}</p>`
      });
      if ( !ok ) return false;
    }

    const remove = new Set(unlocked.map(n => n.id));
    const next = notes.filter(n => !remove.has(n.id));
    for ( const id of remove ) this.selectedIds.delete(id);
    await writeNotes(next);
    if ( notesApp?.note && remove.has(notesApp.note.id) ) {
      notesApp.note = null;
      notesApp.close({submitted: true});
    }
    this.refresh();
    if ( locked.length ) {
      ui.notifications.warn(game.i18n.localize("JINXED_TWEAKS.DmMapNotes.LockedSkipped"));
    }
    return remove.size > 0;
  }

  /**
   * Delete currently selected unlocked notes (Delete key).
   * @returns {Promise<boolean>}
   */
  async deleteSelected() {
    if ( !this.selectedIds.size ) return false;
    return this.deleteNotes([...this.selectedIds], {confirm: false});
  }

  /**
   * @param {object} note
   * @returns {PIXI.Container}
   */
  #buildMarker(note) {
    const root = new PIXI.Container();
    root.eventMode = "static";
    root.cursor = note.locked ? "default" : "move";
    root.jinxedDmNoteId = note.id;
    root.jinxedDmNoteData = note;
    root.zIndex = this.selectedIds.has(note.id) ? 150 : 100;
    root.position.set(note.x, note.y);

    const g = new PIXI.Graphics();
    root.addChild(g);
    root.jinxedGraphics = g;

    const w = Math.max(note.width || 0, MIN_AREA);
    const h = Math.max(note.height || 0, MIN_AREA);
    root.hitArea = new PIXI.Rectangle(0, 0, w, h);
    this.#drawMarkerGraphics(root, note, this.selectedIds.has(note.id));

    root.on("pointerdown", event => this.#onMarkerPointerDown(event, note));
    root.on("rightdown", event => {
      event.stopPropagation();
      event.preventDefault?.();
      this.select(note.id, {exclusive: !event.shiftKey, additive: event.shiftKey});
      const {clientX, clientY} = event;
      showContextMenu(clientX, clientY, note);
    });

    return root;
  }

  /**
   * @param {PIXI.Container} root
   * @param {object} note
   * @param {boolean} selected
   */
  #drawMarkerGraphics(root, note, selected) {
    const g = root.jinxedGraphics;
    if ( !g ) return;
    const w = Math.max(note.width || 0, MIN_AREA);
    const h = Math.max(note.height || 0, MIN_AREA);
    const locked = Boolean(note.locked);
    const stroke = selected ? SELECTED_COLOR : (locked ? LOCKED_COLOR : MARKER_COLOR);
    const fillAlpha = selected ? 0.22 : 0.10;
    g.clear();
    g.lineStyle(selected ? 3 : 2, stroke, selected ? 1 : 0.75)
      .beginFill(stroke, fillAlpha)
      .drawRect(0, 0, w, h)
      .endFill();

    if ( locked ) {
      // Small lock cue in the top-left corner.
      g.lineStyle(1.5, stroke, 0.95)
        .beginFill(0x1a1a1a, 0.55)
        .drawRoundedRect(4, 4, 14, 12, 2)
        .endFill();
    }

    root.zIndex = selected ? 150 : 100;
    root.cursor = locked ? "default" : "move";
    root.hitArea = new PIXI.Rectangle(0, 0, w, h);
  }

  /**
   * @param {PIXI.FederatedEvent} event
   * @param {object} note
   */
  #onMarkerPointerDown(event, note) {
    if ( event.button !== 0 ) return;
    event.stopPropagation();
    closeContextMenu();

    const additive = event.shiftKey;
    if ( additive ) this.select(note.id, {additive: true, exclusive: false});
    else this.select(note.id, {exclusive: true});

    // Locked notes: select (+ open notes) only, no move.
    if ( note.locked ) return;

    const origin = localPoint(event);
    if ( !origin ) return;

    const movingIds = [...this.selectedIds].filter(id => {
      const data = this.markers.get(id)?.jinxedDmNoteData;
      return data && !data.locked;
    });
    if ( !movingIds.includes(note.id) ) movingIds.push(note.id);

    const starts = {};
    for ( const id of movingIds ) {
      const marker = this.markers.get(id);
      if ( marker ) starts[id] = {x: marker.position.x, y: marker.position.y};
    }

    this._moveState = {ids: movingIds, pointerStart: origin, starts};
    this._moveMoved = false;
    this.#bindMoveListeners();
  }

  #bindMoveListeners() {
    this.#endMoveListeners();
    this._onMovePointerMove = event => this.#onMovePointerMove(event);
    this._onMovePointerUp = event => this.#onMovePointerUp(event);
    window.addEventListener("pointermove", this._onMovePointerMove, true);
    window.addEventListener("pointerup", this._onMovePointerUp, true);
    window.addEventListener("pointercancel", this._onMovePointerUp, true);
  }

  #endMoveListeners() {
    if ( this._onMovePointerMove ) {
      window.removeEventListener("pointermove", this._onMovePointerMove, true);
      this._onMovePointerMove = null;
    }
    if ( this._onMovePointerUp ) {
      window.removeEventListener("pointerup", this._onMovePointerUp, true);
      window.removeEventListener("pointercancel", this._onMovePointerUp, true);
      this._onMovePointerUp = null;
    }
  }

  /**
   * Convert a window PointerEvent into canvas / notes-layer coords.
   * @param {PointerEvent} event
   * @returns {{x: number, y: number}|null}
   */
  #windowToLocal(event) {
    if ( !canvas?.ready ) return null;
    try {
      const {x, y} = canvas.canvasCoordinatesFromClient({x: event.clientX, y: event.clientY});
      if ( !Number.isFinite(x) || !Number.isFinite(y) ) return null;
      return {x, y};
    } catch {
      return null;
    }
  }

  /**
   * @param {PointerEvent} event
   */
  #onMovePointerMove(event) {
    if ( !this._moveState ) return;
    const pos = this.#windowToLocal(event);
    if ( !pos ) return;
    const dx = pos.x - this._moveState.pointerStart.x;
    const dy = pos.y - this._moveState.pointerStart.y;
    if ( Math.hypot(dx, dy) > 3 ) this._moveMoved = true;
    for ( const id of this._moveState.ids ) {
      const start = this._moveState.starts[id];
      const marker = this.markers.get(id);
      if ( !start || !marker ) continue;
      marker.position.set(start.x + dx, start.y + dy);
    }
  }

  /**
   * @param {PointerEvent} event
   */
  async #onMovePointerUp(event) {
    const state = this._moveState;
    this.#endMoveListeners();
    this._moveState = null;
    if ( !state ) return;

    const pos = this.#windowToLocal(event);
    if ( !pos || !this._moveMoved ) {
      // Click without meaningful drag: keep selection (already selected).
      // Revert any tiny jitter.
      for ( const id of state.ids ) {
        const start = state.starts[id];
        const marker = this.markers.get(id);
        if ( start && marker ) marker.position.set(start.x, start.y);
      }
      return;
    }

    const dx = pos.x - state.pointerStart.x;
    const dy = pos.y - state.pointerStart.y;
    const notes = readNotes();
    let changed = false;
    for ( const id of state.ids ) {
      const idx = notes.findIndex(n => n.id === id);
      if ( idx < 0 || notes[idx].locked ) continue;
      const start = state.starts[id];
      if ( !start ) continue;
      notes[idx] = {
        ...notes[idx],
        x: start.x + dx,
        y: start.y + dy,
        updatedAt: Date.now()
      };
      changed = true;
    }
    if ( changed ) {
      await writeNotes(notes);
      this.refresh();
    }
  }

  beginPreview(x0, y0) {
    this.clearPreview();
    this.clearSelection();
    this._dragOrigin = {x: x0, y: y0};
    this.preview = new PIXI.Graphics();
    this.preview.eventMode = "none";
    this.preview.zIndex = 200;
    (this.container ?? markerParent())?.addChild(this.preview);
    this.updatePreview(x0, y0);
  }

  updatePreview(x1, y1) {
    if ( !this.preview || !this._dragOrigin ) return;
    const {x, y, width, height} = normalizeRect(this._dragOrigin.x, this._dragOrigin.y, x1, y1);
    this.preview.clear();
    this.preview.lineStyle(2, MARKER_COLOR, 0.95)
      .beginFill(AREA_FILL, 0.18)
      .drawRect(x, y, Math.max(width, 1), Math.max(height, 1))
      .endFill();
  }

  clearPreview() {
    if ( this.preview && !this.preview.destroyed ) this.preview.destroy();
    this.preview = null;
    this._dragOrigin = null;
  }

  /**
   * @param {number} x1
   * @param {number} y1
   * @returns {Promise<object|null>}
   */
  async finishPreview(x1, y1) {
    const origin = this._dragOrigin;
    this.clearPreview();
    if ( !origin || !isDungeonMaster() ) return null;

    const rect = normalizeRect(origin.x, origin.y, x1, y1);
    if ( rect.width < MIN_AREA || rect.height < MIN_AREA ) {
      ui.notifications.info(game.i18n.localize("JINXED_TWEAKS.DmMapNotes.DragHint"));
      return null;
    }

    const note = makeNote(rect);
    const notes = readNotes();
    notes.push(note);
    await writeNotes(notes);
    this.refresh();
    this.select(note.id, {exclusive: true});
    return note;
  }
}

/* -------------------------------------------- */
/*  Layer interaction — never create Notes      */
/* -------------------------------------------- */

function canDragLeftStartGuard(wrapped, user, event) {
  if ( isDmNoteTool() ) return true;
  return wrapped(user, event);
}

function onDragLeftStartGuard(wrapped, event) {
  if ( !isDmNoteTool() ) return wrapped(event);
  // Do NOT call wrapped — that creates a canvas Note / journal pin preview.
  const origin = event.interactionData?.origin ?? localPoint(event);
  if ( !origin ) return;
  event.interactionData.jinxedDmNote = true;
  event.interactionData.cancelOnPause = true;
  try {
    canvas.notes?.preview?.removeChildren?.().forEach(c => c.destroy?.({children: true}));
  } catch { /* ignore */ }
  controller?.beginPreview(origin.x, origin.y);
}

function onDragLeftMoveGuard(wrapped, event) {
  if ( !event.interactionData?.jinxedDmNote ) return wrapped(event);
  const dest = event.interactionData.destination ?? localPoint(event);
  if ( dest ) controller?.updatePreview(dest.x, dest.y);
}

async function onDragLeftDropGuard(wrapped, event) {
  if ( !event.interactionData?.jinxedDmNote ) return wrapped(event);
  const dest = event.interactionData.destination ?? localPoint(event);
  if ( !dest ) {
    controller?.clearPreview();
    return;
  }
  const note = await controller?.finishPreview(dest.x, dest.y);
  if ( note ) openNotesWindow(note);
}

function onDragLeftCancelGuard(wrapped, event) {
  if ( event?.interactionData?.jinxedDmNote ) {
    controller?.clearPreview();
    return;
  }
  return wrapped(event);
}

/**
 * Clicks on empty notes canvas: clear DM selection. Never create journals via our tool.
 */
function onClickLeftGuard(wrapped, event) {
  if ( isDmNoteTool() ) return;
  if ( isDungeonMaster() && canvas.notes?.active ) controller?.clearSelection();
  return wrapped(event);
}

/**
 * Delete key removes selected DM notes first (any active canvas layer).
 */
async function onDeleteKeyGuard(wrapped, event) {
  if ( isDungeonMaster() && controller?.selectedIds?.size ) {
    await controller.deleteSelected();
    return true;
  }
  return wrapped(event);
}

/**
 * Remove all DM notes on the current level (Levels range, or all if Levels off).
 * @returns {Promise<number>} Count removed
 */
async function clearDmNotesForCurrentLevel() {
  if ( !isDungeonMaster() ) return 0;
  const notes = readNotes();
  if ( !notes.length ) return 0;

  const remaining = notes.filter(n => !noteOnCurrentLevel(n));
  const removed = notes.length - remaining.length;
  if ( !removed ) return 0;

  const removedIds = new Set(notes.filter(n => noteOnCurrentLevel(n)).map(n => n.id));
  await writeNotes(remaining);

  if ( controller ) {
    for ( const id of removedIds ) controller.selectedIds.delete(id);
    controller.refresh();
  }
  if ( notesApp?.note && removedIds.has(notesApp.note.id) ) {
    notesApp.note = null;
    notesApp.close({submitted: true});
  }
  return removed;
}

/**
 * After the built-in Clear Notes confirm, also wipe DM notes on this level.
 * @param {Function} wrapped
 */
async function deleteAllGuard(wrapped, ...args) {
  const result = await wrapped(...args);
  // DialogV2.confirm → false (No) or null (dismissed); yes runs the delete callback.
  if ( result === false || result === null ) return result;
  const removed = await clearDmNotesForCurrentLevel();
  if ( removed > 0 ) {
    ui.notifications.info(game.i18n.format("JINXED_TWEAKS.DmMapNotes.ClearedLevel", {count: removed}));
  }
  return result;
}

function noteCreateGuard(wrapped, data, context) {
  if ( isDmNoteTool() ) {
    log("Blocked Note.create while Add DM Note tool is active", "warn");
    return [];
  }
  return wrapped(data, context);
}

function registerWrapper(target, wrapper, type="MIXED") {
  if ( typeof libWrapper?.register === "function" && game.modules.get("lib-wrapper")?.active ) {
    libWrapper.register(WRAPPER_ID, target, wrapper, type);
    return true;
  }
  return false;
}

function patchPrototype(proto, method, guard) {
  if ( !proto || typeof proto[method] !== "function" ) return false;
  const key = `__jinxDmMapNotes_${method}`;
  if ( proto[method][key] ) return true;
  const original = proto[method];
  const patched = function(...args) {
    return guard.call(this, original.bind(this), ...args);
  };
  patched[key] = true;
  proto[method] = patched;
  return true;
}

/* -------------------------------------------- */
/*  Public apply                                */
/* -------------------------------------------- */

export function applyDmMapNotesTweaks() {
  Hooks.on("getSceneControlButtons", controls => {
    const notes = controls.notes;
    if ( !notes?.tools ) return;
    notes.tools[TOOL_NAME] = {
      name: TOOL_NAME,
      order: 2.5,
      title: "JINXED_TWEAKS.DmMapNotes.Tool",
      icon: "fa-solid fa-note-sticky",
      visible: isDungeonMaster(),
      interaction: true,
      control: true,
      creation: false,
      toolclip: {
        heading: "JINXED_TWEAKS.DmMapNotes.Tool",
        items: [{paragraph: "JINXED_TWEAKS.DmMapNotes.ToolHint"}]
      }
    };
  });

  const NotesLayer = CONFIG.Canvas?.layers?.notes?.layerClass;
  const proto = NotesLayer?.prototype;
  if ( proto ) {
    const pairs = [
      ["_canDragLeftStart", canDragLeftStartGuard, "MIXED"],
      ["_onDragLeftStart", onDragLeftStartGuard, "MIXED"],
      ["_onDragLeftMove", onDragLeftMoveGuard, "MIXED"],
      ["_onDragLeftDrop", onDragLeftDropGuard, "MIXED"],
      ["_onDragLeftCancel", onDragLeftCancelGuard, "MIXED"],
      ["_onClickLeft", onClickLeftGuard, "MIXED"],
      ["deleteAll", deleteAllGuard, "WRAPPER"]
    ];
    for ( const [method, guard, type] of pairs ) {
      if ( typeof proto[method] !== "function" ) continue;
      const target = `CONFIG.Canvas.layers.notes.layerClass.prototype.${method}`;
      if ( !registerWrapper(target, guard, type) ) patchPrototype(proto, method, guard);
    }
  }
  else log("NotesLayer prototype unavailable", "warn");

  // Delete works from any placeables layer while DM notes are selected.
  const PlaceablesLayer = foundry.canvas.layers.PlaceablesLayer;
  if ( PlaceablesLayer?.prototype && typeof PlaceablesLayer.prototype._onDeleteKey === "function" ) {
    if ( !registerWrapper(
      "foundry.canvas.layers.PlaceablesLayer.prototype._onDeleteKey",
      onDeleteKeyGuard,
      "MIXED"
    ) ) {
      patchPrototype(PlaceablesLayer.prototype, "_onDeleteKey", onDeleteKeyGuard);
    }
  }
  const InteractionLayer = foundry.canvas.layers.InteractionLayer;
  if ( InteractionLayer?.prototype && typeof InteractionLayer.prototype._onDeleteKey === "function" ) {
    if ( !registerWrapper(
      "foundry.canvas.layers.InteractionLayer.prototype._onDeleteKey",
      onDeleteKeyGuard,
      "MIXED"
    ) ) {
      patchPrototype(InteractionLayer.prototype, "_onDeleteKey", onDeleteKeyGuard);
    }
  }

  const NoteClass = CONFIG.Note?.documentClass;
  if ( NoteClass?.create ) {
    const target = "CONFIG.Note.documentClass.create";
    if ( !registerWrapper(target, noteCreateGuard, "MIXED") ) {
      const original = NoteClass.create.bind(NoteClass);
      if ( !NoteClass.create.__jinxDmMapNotes ) {
        NoteClass.create = function(data, context) {
          return noteCreateGuard(original, data, context);
        };
        NoteClass.create.__jinxDmMapNotes = true;
      }
    }
  }

  controller = new DmMapNotesController();
  notesApp = new DmMapNotesApp();

  // Only the dungeon master mounts the overlay.
  Hooks.on("canvasReady", () => {
    if ( isDungeonMaster() ) controller?.attach();
    else controller?.detach();
  });
  Hooks.on("canvasTearDown", () => {
    controller?.detach();
    notesApp?.close?.();
    closeContextMenu();
  });

  Hooks.on("updateScene", (scene, changes) => {
    if ( !isDungeonMaster() ) return;
    if ( scene.id !== canvas.scene?.id ) return;
    if ( foundry.utils.hasProperty(changes, `flags.${MODULE_ID}.${FLAG_KEY}`)
      || foundry.utils.hasProperty(changes, `flags.${MODULE_ID}`)
      || foundry.utils.hasProperty(changes, "flags") ) {
      controller?.refresh();
    }
  });

  Hooks.on("activateCanvasLayer", () => {
    if ( !isDungeonMaster() ) return;
    closeContextMenu();
    // Keep markers visible/interactive when switching away from Journal Notes.
    if ( controller?.container && !controller.container.destroyed ) {
      const parent = markerParent();
      if ( parent && controller.container.parent !== parent ) parent.addChild(controller.container);
      controller.container.eventMode = "static";
      controller.container.interactiveChildren = true;
      controller.container.visible = true;
    }
  });
  Hooks.on("renderSceneControls", () => {
    if ( isDungeonMaster() ) controller?.refresh();
  });
  Hooks.on("levelsUiChangeLevel", () => {
    if ( isDungeonMaster() ) controller?.refresh();
  });
  Hooks.on("controlToken", () => {
    if ( isDungeonMaster() ) controller?.refresh();
  });

  if ( canvas?.ready && isDungeonMaster() ) controller.attach();
  try { ui.controls?.render?.(); } catch { /* ignore */ }

  log("Add DM Note tool registered (always-on for GM; hidden from players/trusted)");
}
