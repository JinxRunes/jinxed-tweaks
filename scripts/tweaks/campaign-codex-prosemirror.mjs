/**
 * Campaign Codex — prose-mirror editor recovery.
 *
 * Foundry toggled editors can get stuck with `open` set but not `.active` when
 * activation fails or a render races a save. The edit button then does nothing.
 */

const TARGET_MODULE_ID = "campaign-codex";
const PATCH_MARKER = "__jinxCodexProseMirror";
const RECOVERY_FLAG = "jinxPmRecovery";

/**
 * @param {string} message
 * @param {"log"|"warn"|"error"} [level]
 */
function log(message, level="log") {
  console[level](`jinxed-tweaks | campaign-codex-prosemirror | ${message}`);
}

/**
 * @param {string} relativePath
 */
function campaignCodexUrl(relativePath) {
  return `/modules/${TARGET_MODULE_ID}/${String(relativePath || "").replace(/^\/+/, "")}`;
}

/**
 * @param {HTMLElement|null|undefined} editor
 */
export function isProseMirrorEditorActive(editor) {
  return !!editor?.classList?.contains("active");
}

/**
 * @param {HTMLElement|null|undefined} editor
 */
export function isProseMirrorEditorStuck(editor) {
  return !!editor?.hasAttribute?.("open") && !isProseMirrorEditorActive(editor);
}

/**
 * Clear a stuck toggled editor without persisting a draft.
 * @param {HTMLElement|null|undefined} editor
 */
export function resetStuckProseMirrorEditor(editor) {
  if ( !editor?.matches?.("prose-mirror[toggled]") ) return;
  if ( !isProseMirrorEditorStuck(editor) ) return;

  editor.removeAttribute("open");
  editor.classList.remove("active");
  editor.classList.add("inactive");

  const button = editor.querySelector(":scope > button.toggle");
  if ( button ) button.disabled = editor.disabled;
}

/**
 * Close a toggled editor. Active editors save through Foundry; stuck editors reset.
 * @param {HTMLElement|null|undefined} editor
 */
export function closeProseMirrorEditor(editor) {
  if ( !editor?.matches?.("prose-mirror[toggled]") ) return;

  if ( isProseMirrorEditorActive(editor) ) {
    editor.open = false;
    return;
  }

  resetStuckProseMirrorEditor(editor);
}

/**
 * @param {HTMLElement} editor
 */
function bindProseMirrorRecovery(editor) {
  if ( editor.dataset[RECOVERY_FLAG] ) return;
  editor.dataset[RECOVERY_FLAG] = "true";

  editor.addEventListener("click", (event) => {
    if ( !event.target.closest("button.toggle") ) return;
    resetStuckProseMirrorEditor(editor);
  }, true);

  editor.addEventListener("open", () => {
    window.setTimeout(() => {
      if ( isProseMirrorEditorStuck(editor) ) {
        log("Recovering prose-mirror editor that failed to activate", "warn");
        resetStuckProseMirrorEditor(editor);
        ui.notifications.warn(game.i18n.localize("JINXED_TWEAKS.CodexProseMirror.RecoverFailedOpen"));
      }
    }, 5000);
  });
}

/**
 * @param {object} proto
 * @param {string} method
 * @param {Function} wrapperFactory
 * @param {string} [marker]
 */
function patchPrototypeMethod(proto, method, wrapperFactory, marker=PATCH_MARKER) {
  if ( proto[method]?.[marker] ) return;
  const original = proto[method];
  proto[method] = wrapperFactory(original);
  proto[method][marker] = true;
}

/**
 * @returns {Promise<boolean>}
 */
export async function patchCodexProseMirrorRecovery() {
  const { CampaignCodexBaseSheet } = await import(campaignCodexUrl("scripts/sheets/base-sheet.js"));
  const proto = CampaignCodexBaseSheet.prototype;

  patchPrototypeMethod(proto, "_activateEditorListeners", (original) => function jinxCodexProseMirrorActivateEditorListeners(html) {
    original.call(this, html);
    html.querySelectorAll("prose-mirror[toggled]").forEach((editor) => bindProseMirrorRecovery(editor));
  }, `${PATCH_MARKER}ActivateListeners`);

  log("Campaign Codex prose-mirror recovery patched");
  return true;
}
