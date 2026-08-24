/**
 * Campaign Codex — right-click Delete on hub and sheet tree sidebars.
 */

const MODULE_ID = "jinxed-tweaks";
const TARGET_MODULE_ID = "campaign-codex";
const PATCH_MARKER = "__jinxCodexSidebarDelete";

/**
 * @param {string} message
 * @param {"log"|"warn"|"error"} [level]
 */
function log(message, level="log") {
  console[level](`${MODULE_ID} | campaign-codex-sidebar-delete | ${message}`);
}

/**
 * @param {string} relativePath
 */
function campaignCodexUrl(relativePath) {
  return `/modules/${TARGET_MODULE_ID}/${String(relativePath || "").replace(/^\/+/, "")}`;
}

/**
 * @param {HTMLElement|null|undefined} element
 */
function getContextElement(element) {
  return element?.dataset ? element : (element?.[0] || element?.currentTarget || null);
}

/**
 * @param {HTMLElement|null|undefined} element
 */
function getTreeNodeUuid(element) {
  const node = element?.closest?.(".tree-node") || element;
  return String(node?.dataset?.uuid || node?.dataset?.sheetUuid || "").trim();
}

/**
 * @param {string} uuid
 */
function isCategoryTreeUuid(uuid) {
  return !uuid || uuid.startsWith("cat-") || uuid.startsWith("folder:");
}

/**
 * @param {HTMLElement|null|undefined} element
 */
function isCategoryTreeNode(element) {
  const node = element?.closest?.(".tree-node") || element;
  const type = String(node?.dataset?.type || "").trim().toLowerCase();
  if ( type === "category" ) return true;
  return isCategoryTreeUuid(getTreeNodeUuid(node));
}

/**
 * @param {string} uuid
 */
async function resolveJournalFromUuid(uuid) {
  if ( !uuid || isCategoryTreeUuid(uuid) ) return null;

  const doc = await fromUuid(uuid).catch(() => null);
  const journal = doc?.documentName === "JournalEntryPage" ? doc.parent : doc;
  if ( journal?.documentName !== "JournalEntry" ) return null;

  const { isCompendiumDocument } = await import(campaignCodexUrl("scripts/compendium-selector.js"));
  if ( isCompendiumDocument(journal) ) return null;

  return journal;
}

/**
 * @param {HTMLElement|null|undefined} target
 */
async function resolveJournalFromTreeTarget(target) {
  const element = getContextElement(target);
  if ( !element || isCategoryTreeNode(element) ) return null;
  return resolveJournalFromUuid(getTreeNodeUuid(element));
}

/**
 * @param {import("foundry.documents.JournalEntry")} journal
 */
async function confirmAndDeleteJournal(journal) {
  const confirmed = await foundry.applications.api.DialogV2.confirm({
    window: { title: game.i18n.localize("JINXED_TWEAKS.CodexSidebarDelete.Title") },
    content: `<p>${game.i18n.format("JINXED_TWEAKS.CodexSidebarDelete.Confirm", {
      name: foundry.utils.escapeHTML(journal.name || "this entry"),
    })}</p>`,
  });
  if ( !confirmed ) return;

  await journal.delete();
  ui.notifications.info(game.i18n.format("JINXED_TWEAKS.CodexSidebarDelete.Success", {
    name: journal.name || "Entry",
  }));
}

/**
 * @param {() => Promise<import("foundry.documents.JournalEntry")|null>} resolveJournal
 */
function buildDeleteContextOption(resolveJournal) {
  return {
    name: game.i18n.localize("SIDEBAR.Delete"),
    icon: '<i class="fas fa-trash"></i>',
    condition: () => game.user.isGM,
    callback: async (target) => {
      const journal = await resolveJournal(getContextElement(target));
      if ( journal ) await confirmAndDeleteJournal(journal);
    },
  };
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

async function patchHubSidebarDelete() {
  const [{ CampaignCodexHub }] = await Promise.all([
    import(campaignCodexUrl("scripts/campaign-codex-hub.js")),
  ]);

  patchPrototypeMethod(CampaignCodexHub.prototype, "_getSheetContextOptions", (original) => function jinxHubSidebarDeleteContextOptions() {
    const options = original.call(this);
    if ( !game.user.isGM ) return options;

    return [...options, buildDeleteContextOption(async (element) => {
      const el = this._getContextElement?.(element) ?? getContextElement(element);
      const uuid = String(el?.dataset?.uuid || "").trim();
      if ( !uuid ) return null;
      return resolveJournalFromUuid(uuid);
    })];
  }, `${PATCH_MARKER}HubContext`);
}

async function patchSheetTreeSidebarDelete() {
  const { CampaignCodexBaseSheet } = await import(campaignCodexUrl("scripts/sheets/base-sheet.js"));
  const TREE_TYPES = new Set(["tag", "group", "organization"]);

  patchPrototypeMethod(CampaignCodexBaseSheet.prototype, "_createContextMenus", (original) => function jinxSheetTreeSidebarDeleteContextMenus() {
    original.call(this);

    const sheetType = this.getSheetType?.();
    if ( !game.user.isGM || !TREE_TYPES.has(sheetType) ) return;

    this._createContextMenu(() => [buildDeleteContextOption((element) => resolveJournalFromTreeTarget(element))], ".tree-node", {
      fixed: true,
      hookName: "getJinxCodexSidebarDeleteContextOptions",
      parentClassHooks: false,
    });
  }, `${PATCH_MARKER}SheetContextMenus`);
}

/**
 * @returns {Promise<boolean>}
 */
export async function patchCodexSidebarDelete() {
  if ( !game.modules.get(TARGET_MODULE_ID)?.active ) return false;

  await patchHubSidebarDelete();
  await patchSheetTreeSidebarDelete();
  log("Campaign Codex sidebar delete context menu patched");
  return true;
}
