/**
 * Campaign Codex — in-editor "Improve Writing" (OpenAI draft-only).
 *
 * Adds a prose-mirror toolbar action while a Campaign Codex field is being edited.
 * Improved HTML replaces the open editor draft only; persistence happens on Save.
 */

import { improveWikiHtml, isOpenAiConfigured } from "./openai.mjs";

let menuHookBound = false;

/**
 * @param {string} message
 * @param {"log"|"warn"|"error"} [level]
 */
function log(message, level="log") {
  console[level](`jinxed-tweaks | campaign-codex-improve | ${message}`);
}

/**
 * @param {string} relativePath
 */
function campaignCodexUrl(relativePath) {
  return `/modules/campaign-codex/${String(relativePath || "").replace(/^\/+/, "")}`;
}

/**
 * @param {HTMLElement|null|undefined} proseMirror
 */
function isCampaignCodexProseMirror(proseMirror) {
  return !!proseMirror?.closest?.(".campaign-codex");
}

/**
 * @param {string} a
 * @param {string} b
 */
function normalizedHtmlEquals(a, b) {
  return String(a || "").replace(/\s+/g, " ").trim() === String(b || "").replace(/\s+/g, " ").trim();
}

/**
 * @param {import("prosemirror-view").EditorView} view
 * @returns {{ html: string, from: number, to: number, isPartial: boolean }}
 */
function getProseMirrorSelectionTarget(view) {
  const PM = foundry.prosemirror;
  const { state } = view;
  const fullHtml = PM.dom.serializeString(state.doc.content);
  const { from, to, empty } = state.selection;

  if ( empty || from === to ) {
    return { html: fullHtml, from: 0, to: state.doc.content.size, isPartial: false };
  }

  const slice = state.doc.slice(from, to);
  const selectedHtml = PM.dom.serializeString(slice.content).trim();
  if ( !selectedHtml ) {
    return { html: fullHtml, from: 0, to: state.doc.content.size, isPartial: false };
  }

  if ( normalizedHtmlEquals(selectedHtml, fullHtml) ) {
    return { html: fullHtml, from: 0, to: state.doc.content.size, isPartial: false };
  }

  return { html: selectedHtml, from, to, isPartial: true };
}

/**
 * @param {HTMLElement} sourceEditor
 * @returns {{ html: string, from: number, to: number, isPartial: boolean }}
 */
function getSourceEditorSelectionTarget(sourceEditor) {
  const full = sourceEditor.value ?? "";
  const root = sourceEditor.querySelector("[contenteditable]");
  const selection = root?.ownerDocument.getSelection();

  if ( !selection?.rangeCount || selection.isCollapsed ) {
    return { html: full, from: 0, to: full.length, isPartial: false };
  }

  const selected = selection.toString();
  if ( !selected.trim() ) {
    return { html: full, from: 0, to: full.length, isPartial: false };
  }

  if ( !root ) {
    const start = full.indexOf(selected);
    if ( start < 0 ) return { html: full, from: 0, to: full.length, isPartial: false };
    return { html: selected, from: start, to: start + selected.length, isPartial: true };
  }

  const range = selection.getRangeAt(0);
  const preRange = range.cloneRange();
  preRange.selectNodeContents(root);
  preRange.setEnd(range.startContainer, range.startOffset);
  const from = preRange.toString().length;
  const to = from + selected.length;

  if ( from === 0 && to >= full.length ) {
    return { html: full, from: 0, to: full.length, isPartial: false };
  }

  return { html: selected, from, to, isPartial: true };
}

/**
 * @param {import("prosemirror-view").EditorView} view
 * @param {number} from
 * @param {number} to
 * @param {string} newHtml
 */
function replaceProseMirrorRange(view, from, to, newHtml) {
  const PM = foundry.prosemirror;
  const parsed = PM.dom.parseString(newHtml, PM.defaultSchema);
  const { state } = view;
  const transaction = state.tr.replaceWith(from, to, parsed.content);
  view.dispatch(transaction);
}

/**
 * @param {import("prosemirror-view").EditorView} view
 * @param {string} newHtml
 */
function replaceProseMirrorDraft(view, newHtml) {
  replaceProseMirrorRange(view, 0, view.state.doc.content.size, newHtml);
}

/**
 * @param {HTMLElement} sourceEditor
 * @param {number} from
 * @param {number} to
 * @param {string} newHtml
 */
function replaceSourceEditorRange(sourceEditor, from, to, newHtml) {
  const full = sourceEditor.value ?? "";
  sourceEditor.value = `${full.slice(0, from)}${newHtml}${full.slice(to)}`;
}

/**
 * @param {import("foundry.prosemirror.ProseMirrorMenu")} menu
 * @returns {{ html: string, from: number, to: number, isPartial: boolean, sourceEditor?: HTMLElement }}
 */
function getImproveTarget(menu) {
  const editorRoot = menu.view.dom.closest(".editor");
  const sourceEditor = editorRoot?.querySelector(":scope > code-mirror.source-editor");
  if ( sourceEditor ) return { ...getSourceEditorSelectionTarget(sourceEditor), sourceEditor };
  return getProseMirrorSelectionTarget(menu.view);
}

/**
 * @param {import("foundry.prosemirror.ProseMirrorMenu")} menu
 * @param {{ from: number, to: number, sourceEditor?: HTMLElement }} target
 * @param {string} improvedHtml
 */
function applyImprovedDraft(menu, target, improvedHtml) {
  if ( target.sourceEditor ) {
    replaceSourceEditorRange(target.sourceEditor, target.from, target.to, improvedHtml);
    return;
  }

  if ( target.from === 0 && target.to === menu.view.state.doc.content.size ) {
    replaceProseMirrorDraft(menu.view, improvedHtml);
    return;
  }

  replaceProseMirrorRange(menu.view, target.from, target.to, improvedHtml);
}

/**
 * @param {HTMLElement} proseMirror
 */
async function resolveEntityName(proseMirror) {
  const journalUuid = proseMirror.dataset.ccJournalUuid
    || proseMirror.getAttribute("document-uuid")
    || proseMirror.dataset.documentUuid
    || "";

  if ( !journalUuid ) return "Entry";

  try {
    const doc = await foundry.utils.fromUuid(journalUuid);
    if ( doc?.documentName === "JournalEntryPage" ) return doc.parent?.name || doc.name || "Entry";
    return doc?.name || "Entry";
  }
  catch {
    return "Entry";
  }
}

/**
 * @param {import("foundry.prosemirror.ProseMirrorMenu")} menu
 */
async function handleImproveWriting(menu) {
  if ( !game.user.isGM ) return;
  if ( !isOpenAiConfigured() ) {
    ui.notifications.warn("Add your OpenAI API key in Jinxed Tweaks module settings first.");
    return;
  }

  const proseMirror = menu.view.dom.closest("prose-mirror");
  if ( !proseMirror?.open ) return;

  const target = getImproveTarget(menu);
  if ( !String(target.html || "").trim() ) {
    ui.notifications.warn(game.i18n.localize("JINXED_TWEAKS.OpenAI.ImproveWritingEmpty"));
    return;
  }

  const notification = ui.notifications?.info?.(
    game.i18n.localize(target.isPartial
      ? "JINXED_TWEAKS.OpenAI.ImproveWritingSelectionProgress"
      : "JINXED_TWEAKS.OpenAI.ImproveWritingProgress"),
    { permanent: true },
  );

  try {
    const { detectWikiSourceFromHtml } = await import("./campaign-codex-fandom-wiki-context.mjs");
    const entityName = await resolveEntityName(proseMirror);
    const wikiSource = detectWikiSourceFromHtml(target.html, entityName);
    const improved = await improveWikiHtml(target.html, {
      entityName,
      pageTitle: entityName,
      wikiSource: wikiSource || undefined,
    });

    if ( normalizedHtmlEquals(improved, target.html) ) {
      ui.notifications.info(game.i18n.localize("JINXED_TWEAKS.OpenAI.ImproveWritingNoChanges"));
      return;
    }

    applyImprovedDraft(menu, target, improved);
    ui.notifications.info(game.i18n.localize(target.isPartial
      ? "JINXED_TWEAKS.OpenAI.ImproveWritingSelectionDone"
      : "JINXED_TWEAKS.OpenAI.ImproveWritingDone"));
  }
  catch ( error ) {
    const message = error?.message || String(error);
    log(`Improve failed: ${message}`, "error");
    console.error(error);
    ui.notifications.error(game.i18n.format("JINXED_TWEAKS.OpenAI.ImproveWritingFailed", { message }));
  }
  finally {
    notification?.remove?.();
  }
}

/**
 * @param {import("foundry.prosemirror.ProseMirrorMenu")} menu
 * @param {object[]} items
 */
function onGetProseMirrorMenuItems(menu, items) {
  if ( !game.user.isGM || !isOpenAiConfigured() ) return;

  const proseMirror = menu.view.dom.closest("prose-mirror");
  if ( !isCampaignCodexProseMirror(proseMirror) ) return;
  if ( items.some((item) => item.action === "jinx-improve-writing") ) return;

  const improveItem = {
    action: "jinx-improve-writing",
    title: game.i18n.localize("JINXED_TWEAKS.OpenAI.ImproveWriting"),
    icon: '<i class="fas fa-wand-magic-sparkles fa-fw"></i>',
    scope: menu.constructor._MENU_ITEM_SCOPES.BOTH,
    cssClass: "jinx-improve-writing right",
    cmd: () => handleImproveWriting(menu),
  };

  const saveIndex = items.findIndex((item) => item.action === "save");
  if ( saveIndex >= 0 ) items.splice(saveIndex, 0, improveItem);
  else items.push(improveItem);
}

/**
 * @returns {Promise<boolean>}
 */
export async function patchImproveWriting() {
  if ( menuHookBound ) return true;

  await import(campaignCodexUrl("scripts/sheets/base-sheet.js"));
  Hooks.on("getProseMirrorMenuItems", onGetProseMirrorMenuItems);
  menuHookBound = true;
  log("In-editor Improve Writing patched");
  return true;
}
