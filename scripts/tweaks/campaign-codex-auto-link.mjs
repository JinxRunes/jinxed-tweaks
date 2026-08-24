/**
 * Campaign Codex — automatic cross-linking of codex entry names in prose.
 */

const MODULE_ID = "jinxed-tweaks";
const TARGET_MODULE_ID = "campaign-codex";
const SETTING_ENABLED = "codexAutoLink";
const SETTING_MIN_NAME_LENGTH = "codexAutoLinkMinLength";
const PATCH_MARKER = "__jinxCodexAutoLink";

/** @type {Array<{ name: string, uuid: string, type: string, pattern: RegExp }> | null} */
let cachedIndex = null;
let hooksBound = false;

/**
 * @param {string} message
 * @param {"log"|"warn"|"error"} [level]
 */
function log(message, level="log") {
  console[level](`${MODULE_ID} | campaign-codex-auto-link | ${message}`);
}

/**
 * @param {string} relativePath
 */
function campaignCodexUrl(relativePath) {
  return `/modules/${TARGET_MODULE_ID}/${String(relativePath || "").replace(/^\/+/, "")}`;
}

/**
 * @param {string} value
 */
function escapeRegex(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * @param {string} name
 */
function buildNamePattern(name) {
  const flexible = escapeRegex(name.trim()).replace(/\s+/g, "\\s+");
  return new RegExp(`(?<![\\w'’\\-])(${flexible})(?![\\w'’\\-])`, "i");
}

/**
 * @param {string} a
 * @param {string} b
 */
function namesMatch(a, b) {
  return String(a || "").localeCompare(String(b || ""), undefined, { sensitivity: "accent" }) === 0;
}

export function invalidateCodexNameIndex() {
  cachedIndex = null;
}

/**
 * @returns {boolean}
 */
export function isCodexAutoLinkEnabled() {
  return game.settings.get(MODULE_ID, SETTING_ENABLED) !== false;
}

/**
 * @returns {Promise<Array<{ name: string, uuid: string, type: string, pattern: RegExp }>>}
 */
async function getCodexNameIndex() {
  if ( cachedIndex ) return cachedIndex;

  const { getCodexType } = await import(campaignCodexUrl("scripts/helper.js"));
  const minLength = Number(game.settings.get(MODULE_ID, SETTING_MIN_NAME_LENGTH)) || 4;
  const observer = globalThis.CONST?.DOCUMENT_OWNERSHIP_LEVELS?.OBSERVER ?? 2;
  const entries = [];

  for ( const journal of game.journal ) {
    const type = getCodexType(journal);
    if ( !type ) continue;

    const name = String(journal.name || "").trim();
    if ( name.length < minLength ) continue;

    if ( !game.user.isGM && journal.testUserPermission?.(game.user, observer) !== true ) {
      continue;
    }

    entries.push({
      name,
      uuid: journal.uuid,
      type,
      pattern: buildNamePattern(name),
    });
  }

  entries.sort((a, b) => b.name.length - a.name.length);
  cachedIndex = entries;
  return entries;
}

/**
 * @param {Text} node
 */
function shouldLinkTextNode(node) {
  const parent = node.parentElement;
  if ( !parent ) return false;
  if ( parent.closest("a, button, code, pre, script, style, textarea, prose-mirror, .reference, sup.reference") ) {
    return false;
  }
  if ( String(node.textContent || "").includes("@UUID[") ) return false;
  return true;
}

/**
 * @param {string} text
 * @param {Array<{ name: string, uuid: string, pattern: RegExp }>} index
 * @param {string} [excludeUuid]
 */
function linkPlainText(text, index, excludeUuid) {
  let result = "";
  let position = 0;

  while ( position < text.length ) {
    let matchText = null;
    let matchEntry = null;

    for ( const entry of index ) {
      if ( entry.uuid === excludeUuid ) continue;
      entry.pattern.lastIndex = 0;
      const slice = text.slice(position);
      const match = entry.pattern.exec(slice);
      if ( match?.index !== 0 ) continue;
      if ( !matchText || match[0].length > matchText.length ) {
        matchText = match[0];
        matchEntry = entry;
      }
    }

    if ( matchText && matchEntry ) {
      result += `@UUID[${matchEntry.uuid}]{${matchText}}`;
      position += matchText.length;
    }
    else {
      result += text[position];
      position += 1;
    }
  }

  return result;
}

/**
 * @param {string} html
 * @param {{ excludeUuid?: string }} [options]
 */
export async function linkCodexEntitiesInHtml(html, options={}) {
  if ( !isCodexAutoLinkEnabled() ) return String(html || "");
  const source = String(html || "");
  if ( !source.trim() ) return source;

  const index = await getCodexNameIndex();
  if ( !index.length ) return source;

  const excludeUuid = options.excludeUuid || "";
  const doc = new DOMParser().parseFromString(`<div id="jinx-codex-link-root">${source}</div>`, "text/html");
  const root = doc.getElementById("jinx-codex-link-root");
  if ( !root ) return source;

  for ( const anchor of [...root.querySelectorAll("a")] ) {
    const label = anchor.textContent?.trim();
    if ( !label ) continue;
    const entry = index.find((item) => namesMatch(item.name, label));
    if ( !entry || entry.uuid === excludeUuid ) continue;
    anchor.replaceWith(doc.createTextNode(`@UUID[${entry.uuid}]{${label}}`));
  }

  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const textNodes = [];
  let node = walker.nextNode();
  while ( node ) {
    textNodes.push(node);
    node = walker.nextNode();
  }

  for ( const textNode of textNodes ) {
    if ( !shouldLinkTextNode(textNode) ) continue;
    const linked = linkPlainText(textNode.textContent, index, excludeUuid);
    if ( linked !== textNode.textContent ) {
      textNode.textContent = linked;
    }
  }

  return root.innerHTML;
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

function bindCodexAutoLinkHooks() {
  if ( hooksBound ) return;
  hooksBound = true;

  const invalidate = () => invalidateCodexNameIndex();
  Hooks.on("createJournalEntry", invalidate);
  Hooks.on("updateJournalEntry", invalidate);
  Hooks.on("deleteJournalEntry", invalidate);
}

/**
 * @param {import("modules/campaign-codex/scripts/journal-content-helper.js").JournalContentHelper} JournalContentHelper
 */
function shouldAutoLinkContentKey(contentKey) {
  const key = String(contentKey || "").trim().toLowerCase();
  return key === "info" || key === "notes" || key.startsWith("custom-info-");
}

export function registerCodexAutoLinkSettings() {
  game.settings.register(MODULE_ID, SETTING_ENABLED, {
    name: "JINXED_TWEAKS.CodexAutoLink.EnabledName",
    hint: "JINXED_TWEAKS.CodexAutoLink.EnabledHint",
    scope: "world",
    config: true,
    restricted: true,
    type: Boolean,
    default: true,
  });

  game.settings.register(MODULE_ID, SETTING_MIN_NAME_LENGTH, {
    name: "JINXED_TWEAKS.CodexAutoLink.MinNameLengthName",
    hint: "JINXED_TWEAKS.CodexAutoLink.MinNameLengthHint",
    scope: "world",
    config: true,
    restricted: true,
    type: Number,
    default: 4,
    range: { min: 2, max: 20, step: 1 },
  });
}

/**
 * @returns {Promise<boolean>}
 */
export async function patchCodexAutoLink() {
  const [{ CampaignCodexBaseSheet }, { JournalContentHelper }] = await Promise.all([
    import(campaignCodexUrl("scripts/sheets/base-sheet.js")),
    import(campaignCodexUrl("scripts/journal-content-helper.js")),
  ]);

  bindCodexAutoLinkHooks();

  if ( !JournalContentHelper.set[PATCH_MARKER] ) {
    const originalSet = JournalContentHelper.set;
    JournalContentHelper.set = async function jinxCodexAutoLinkSet(document, contentKey, value) {
      let nextValue = value;
      if (
        shouldAutoLinkContentKey(contentKey)
        && JournalContentHelper.isCampaignCodexJournal(document)
      ) {
        try {
          const journal = JournalContentHelper.getJournal(document);
          nextValue = await linkCodexEntitiesInHtml(String(value || ""), { excludeUuid: journal?.uuid });
        }
        catch ( error ) {
          log(`Auto-link failed during save; storing unlinked content: ${error?.message || error}`, "warn");
          console.error(error);
        }
      }
      try {
        return await originalSet.call(this, document, contentKey, nextValue);
      }
      catch ( error ) {
        const message = error?.message || String(error);
        log(`Failed to save Campaign Codex content: ${message}`, "error");
        console.error(error);
        ui.notifications.error(game.i18n.format("JINXED_TWEAKS.CodexProseMirror.SaveFailed", { message }));
        throw error;
      }
    };
    JournalContentHelper.set[PATCH_MARKER] = true;
  }

  patchPrototypeMethod(CampaignCodexBaseSheet.prototype, "_prepareContext", (original) => async function jinxCodexAutoLinkPrepareContext(options) {
    const context = await original.call(this, options);
    if ( !isCodexAutoLinkEnabled() || !context?.sheetData ) return context;

    const excludeUuid = this.document?.uuid;

    let description = context.sheetData.description;
    if ( Array.isArray(description) ) description = description[0] || "";
    const linkedDescription = await linkCodexEntitiesInHtml(String(description || ""), { excludeUuid });
    context.sheetData.enrichedDescription = await foundry.applications.ux.TextEditor.implementation.enrichHTML(
      linkedDescription,
      { async: true, secrets: this.document.isOwner },
    );

    let notes = context.sheetData.notes;
    if ( Array.isArray(notes) ) notes = notes[0] || "";
    const linkedNotes = await linkCodexEntitiesInHtml(String(notes || ""), { excludeUuid });
    if ( this._currentTab === "notes" ) {
      context.sheetData.enrichedNotes = await foundry.applications.ux.TextEditor.implementation.enrichHTML(linkedNotes, {
        async: true,
        secrets: this.document.isOwner,
      });
    }

    return context;
  }, `${PATCH_MARKER}PrepareContext`);

  log("Campaign Codex auto-linking patched");
  return true;
}
