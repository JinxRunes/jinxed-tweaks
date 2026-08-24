/**
 * Campaign Codex — UI polish.
 *
 * - Flatten sidebar tab category counts (remove pill/oval background).
 * - Add the missing "new faction" ribbon on location (city) sheet factions tab.
 * - Faction sheets: Known People tab + left-sidebar Known People / Quests menus.
 * - Rename Campaign Codex "NPCs" category/labels to "People".
 * - Hide redundant "Information" heading on entry info tabs.
 * - Fandom wiki importer on Info tab (Information, Description, Society, History).
 * - In-editor Improve Writing (OpenAI) on all Campaign Codex prose fields while editing.
 * - Auto-link codex entry names in Information/Notes prose.
 */

import { patchFandomWikiImporter } from "./campaign-codex-fandom-wiki.mjs";
import { patchImproveWriting } from "./campaign-codex-improve-writing.mjs";
import { patchCodexAutoLink } from "./campaign-codex-auto-link.mjs";
import { patchCodexImagePicker } from "./campaign-codex-image-picker.mjs";
import { patchCodexProseMirrorRecovery } from "./campaign-codex-prosemirror.mjs";
import { patchCodexHubFolders } from "./campaign-codex-hub-folders.mjs";
import { applyCampaignCodexOrganizations } from "./campaign-codex-organizations.mjs";
import { patchCodexSidebarDelete } from "./campaign-codex-sidebar-delete.mjs";
import { isTagLikeCodexSheet } from "./campaign-codex-organization-shared.mjs";

const PEOPLE_LABEL = "People";

const TARGET_MODULE_ID = "campaign-codex";
const KNOWN_PEOPLE_TAB_KEY = "knownPeople";
const FACTION_SIDEBAR_NAV_CLASS = "jinx-faction-sidebar-nav";
const PATCH_MARKER = "__jinxFactionSidebar";

/** @type {typeof import("modules/campaign-codex/scripts/sheets/tag-sheet.js").TagSheet | null} */
let TagSheetClass = null;

function log(message, level="log") {
  console[level](`jinxed-tweaks | campaign-codex | ${message}`);
}

/**
 * Campaign Codex only registers main.js as an esmodule; subpaths need absolute /modules/ URLs.
 * @param {string} relativePath
 */
function campaignCodexUrl(relativePath) {
  return `/modules/${TARGET_MODULE_ID}/${String(relativePath || "").replace(/^\/+/, "")}`;
}

/**
 * @param {string} relativePath
 */
async function importCampaignCodex(relativePath) {
  return import(campaignCodexUrl(relativePath));
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
 * @param {import("modules/campaign-codex/scripts/sheets/tag-sheet.js").TagSheet} sheet
 * @returns {boolean}
 */
function isFactionTagSheet(sheet) {
  return sheet?.getSheetType?.() === "tag" || sheet?.constructor === TagSheetClass;
}

/**
 * @param {import("modules/campaign-codex/scripts/sheets/tag-sheet.js").TagSheet} sheet
 * @returns {string}
 */
function getKnownPeopleLabel(sheet) {
  return sheet._labelOverride(sheet.document, KNOWN_PEOPLE_TAB_KEY) || "Known People";
}

/**
 * @param {import("modules/campaign-codex/scripts/sheets/tag-sheet.js").TagSheet} sheet
 * @param {object} context
 */
async function generateKnownPeopleTab(sheet, context) {
  const { localize, format } = await importCampaignCodex("scripts/helper.js");
  const { TemplateComponents } = await importCampaignCodex("scripts/sheets/template-components.js");

  const label = getKnownPeopleLabel(sheet);
  const people = context.associatesWithoutTaggedNPCs || [];
  let buttons = "";

  if ( context.isGM ) {
    if ( canvas.scene && people.length > 0 ) {
      buttons += `<i class="fas fa-street-view refresh-btn npcs-to-map-button" data-action="npcsToMapButton" title="${foundry.utils.escapeHTML(format("button.droptoscene", { type: localize("names.npc") }))}"></i>`;
    }
    const title = format("button.title", { type: localize("names.npc") });
    buttons += `<i class="refresh-btn fas fa-user-plus create-npc-button" data-action="createNPCJournal" title="${foundry.utils.escapeHTML(title)}"></i>`;
  }

  let content = TemplateComponents.contentHeader(TemplateComponents.getAsset("icon", "npc"), label, buttons || null);
  if ( context.isGM ) {
    content += TemplateComponents.dropZone("associate", "fas fa-user-friends", "", "");
  }

  if ( people.length > 0 ) {
    content += TemplateComponents.entityGrid(people, "associate", true);
  }
  else {
    content += TemplateComponents.emptyState("npc");
  }

  return `<div class="tab-panel associates" data-tab="${KNOWN_PEOPLE_TAB_KEY}">${content}</div>`;
}

/**
 * @param {object[]} tabPanels
 * @param {object} tab
 */
function upsertTabPanel(tabPanels, tab) {
  const index = tabPanels.findIndex((entry) => entry.key === tab.key);
  if ( index >= 0 ) {
    tabPanels[index] = { ...tabPanels[index], ...tab };
    return;
  }

  const infoIndex = tabPanels.findIndex((entry) => entry.key === "info");
  tabPanels.splice(infoIndex >= 0 ? infoIndex + 1 : 0, 0, tab);
}

/**
 * @param {import("modules/campaign-codex/scripts/sheets/tag-sheet.js").TagSheet} sheet
 * @param {object} context
 */
async function buildKnownPeopleTabPanel(sheet, context) {
  const { TemplateComponents } = await importCampaignCodex("scripts/sheets/template-components.js");
  const { CampaignCodexBaseSheet } = await importCampaignCodex("scripts/sheets/base-sheet.js");

  const associates = context.associatesWithoutTaggedNPCs || [];
  const peopleCount = CampaignCodexBaseSheet.countVisibleEntitiesForStats(associates);
  const isMainView = !sheet._selectedSheet;
  const isActive = isMainView && sheet._currentTab === KNOWN_PEOPLE_TAB_KEY;

  return {
    key: KNOWN_PEOPLE_TAB_KEY,
    label: getKnownPeopleLabel(sheet),
    icon: TemplateComponents.getAsset("icon", "npc"),
    active: isActive,
    content: isActive ? await generateKnownPeopleTab(sheet, context) : "",
    statistic: { value: peopleCount, view: peopleCount > 0 },
  };
}

/**
 * @param {import("modules/campaign-codex/scripts/sheets/tag-sheet.js").TagSheet} sheet
 * @param {object} context
 */
async function augmentTagSheetContext(sheet, context) {
  if ( !isTagLikeCodexSheet(sheet) ) return context;
  if ( context.isShowingSelectedView || sheet._selectedSheet ) return context;
  if ( !Array.isArray(context.tabPanels) ) return context;

  const knownPeopleTab = await buildKnownPeopleTabPanel(sheet, context);
  upsertTabPanel(context.tabPanels, knownPeopleTab);

  if ( !sheet._selectedSheet && sheet._currentTab ) {
    for ( const tab of context.tabPanels ) {
      tab.active = tab.key === sheet._currentTab;
    }
  }

  const questsTab = context.tabPanels.find((tab) => tab.key === "quests");
  if ( questsTab && !questsTab.statistic ) {
    questsTab.statistic = { value: context.quests?.length ?? 0, view: (context.quests?.length ?? 0) > 0 };
  }

  const navHtml = await buildFactionSidebarNavHtml(sheet, {
    associates: context.associatesWithoutTaggedNPCs || [],
  });
  if ( !context.leftPanel?.includes(FACTION_SIDEBAR_NAV_CLASS) ) {
    context.leftPanel = navHtml + (context.leftPanel || "");
  }

  if ( !sheet._selectedSheet && context.tabPanels.length > 0
    && (!sheet._currentTab || !context.tabPanels.find((tab) => tab.key === sheet._currentTab)) ) {
    sheet._currentTab = context.tabPanels[0].key;
    for ( const tab of context.tabPanels ) {
      tab.active = tab.key === sheet._currentTab;
    }
  }

  return context;
}

/**
 * @param {import("modules/campaign-codex/scripts/sheets/tag-sheet.js").TagSheet} sheet
 * @param {number} peopleCount
 * @param {number} questCount
 * @param {string} npcIcon
 * @param {string} questsLabel
 */
function generateFactionSidebarNav(sheet, peopleCount, questCount, npcIcon, questsLabel) {
  const peopleLabel = getKnownPeopleLabel(sheet);
  const currentTab = sheet._currentTab;
  const docName = foundry.utils.escapeHTML(sheet.document.name);
  const docUuid = sheet.document.uuid;

  const renderItem = (key, label, icon, count, active) => {
    const statHtml = count > 0 ? `<span class="tab-stat">${count}</span>` : "";
    return `<div class="tab-item${active ? " active" : ""}" data-tab="${key}" data-tab-label="${foundry.utils.escapeHTML(label)}" data-document-name="${docName}" data-uuid="${docUuid}" data-cc-sheet-tab="true" data-action="ccChangeTab">
      <i class="${icon}"></i>
      <span class="tab-label">${foundry.utils.escapeHTML(label)}</span>
      ${statHtml}
    </div>`;
  };

  return `<nav class="sidebar-tabs ${FACTION_SIDEBAR_NAV_CLASS}">
    ${renderItem(KNOWN_PEOPLE_TAB_KEY, peopleLabel, npcIcon, peopleCount, currentTab === KNOWN_PEOPLE_TAB_KEY)}
    ${renderItem("quests", questsLabel, "fas fa-scroll", questCount, currentTab === "quests")}
  </nav>`;
}

/**
 * @param {import("modules/campaign-codex/scripts/sheets/tag-sheet.js").TagSheet} sheet
 * @param {object} [leftPanelData]
 */
async function buildFactionSidebarNavHtml(sheet, leftPanelData) {
  const { CampaignCodexBaseSheet } = await importCampaignCodex("scripts/sheets/base-sheet.js");
  const { TemplateComponents } = await importCampaignCodex("scripts/sheets/template-components.js");
  const { localize } = await importCampaignCodex("scripts/helper.js");

  const associates = leftPanelData?.associates
    || sheet._processedData?.associates?.filter((npc) => npc.tag !== true)
    || [];
  const quests = sheet._processedData?.linkedQuests || [];
  const peopleCount = CampaignCodexBaseSheet.countVisibleEntitiesForStats(associates);
  const questCount = quests.length;
  const npcIcon = TemplateComponents.getAsset("icon", "npc");
  const questsLabel = sheet._labelOverride(sheet.document, "quests") || localize("names.quests");

  return generateFactionSidebarNav(sheet, peopleCount, questCount, npcIcon, questsLabel);
}

/**
 * @param {import("modules/campaign-codex/scripts/sheets/tag-sheet.js").TagSheet} sheet
 * @param {HTMLElement} root
 */
async function ensureFactionSidebarNavInDom(sheet, root) {
  if ( !isTagLikeCodexSheet(sheet) || sheet._selectedSheet ) return;
  const treeContainer = root.querySelector(".group-tree-container");
  if ( !treeContainer || treeContainer.querySelector(`.${FACTION_SIDEBAR_NAV_CLASS}`) ) return;

  const navHtml = await buildFactionSidebarNavHtml(sheet);
  treeContainer.insertAdjacentHTML("afterbegin", navHtml);
}

/**
 * @param {HTMLElement} root
 * @param {string} tabName
 */
function syncFactionSidebarNavActive(root, tabName) {
  root.querySelectorAll(`.${FACTION_SIDEBAR_NAV_CLASS} .tab-item`).forEach((item) => {
    item.classList.toggle("active", item.dataset.tab === tabName);
  });
}

/**
 * @returns {Promise<boolean>}
 */
async function patchTagSheetFactionSidebar() {
  const { TagSheet } = await importCampaignCodex("scripts/sheets/tag-sheet.js");
  TagSheetClass = TagSheet;
  const proto = TagSheet.prototype;

  const scrollable = TagSheet.PARTS?.main?.scrollable;
  const scrollTarget = `.group-tab-panel.${KNOWN_PEOPLE_TAB_KEY}`;
  if ( Array.isArray(scrollable) && !scrollable.includes(scrollTarget) ) {
    scrollable.push(scrollTarget);
  }

  patchPrototypeMethod(proto, "_getTabDefinitions", (original) => function jinxTagTabDefinitions() {
    const tabs = original.call(this);
    if ( tabs.some((tab) => tab.key === KNOWN_PEOPLE_TAB_KEY) ) return tabs;
    const infoIndex = tabs.findIndex((tab) => tab.key === "info");
    const insertAt = infoIndex >= 0 ? infoIndex + 1 : 0;
    tabs.splice(insertAt, 0, { key: KNOWN_PEOPLE_TAB_KEY, label: "Known People" });
    return tabs;
  });

  patchPrototypeMethod(proto, "_prepareContext", (original) => async function jinxTagPrepareContext(options) {
    const context = await original.call(this, options);
    try {
      return await augmentTagSheetContext(this, context);
    }
    catch ( error ) {
      log(`augmentTagSheetContext failed: ${error?.message || error}`, "error");
      console.error(error);
      return context;
    }
  });

  patchPrototypeMethod(proto, "_generateLeftPanel", (original) => async function jinxTagLeftPanel(data) {
    const html = await original.call(this, data);
    if ( !isTagLikeCodexSheet(this) || this._selectedSheet || html.includes(FACTION_SIDEBAR_NAV_CLASS) ) return html;
    const navHtml = await buildFactionSidebarNavHtml(this, data);
    return navHtml + html;
  }, `${PATCH_MARKER}LeftPanel`);

  patchPrototypeMethod(proto, "_showTab", (original) => function jinxTagShowTab(tabName, html) {
    if ( isTagLikeCodexSheet(this) && !this._selectedSheet && tabName === KNOWN_PEOPLE_TAB_KEY ) {
      this._currentTab = tabName;
      syncFactionSidebarNavActive(html, tabName);
      this.render(false);
      return;
    }

    original.call(this, tabName, html);
    syncFactionSidebarNavActive(html, tabName);
  }, `${PATCH_MARKER}ShowTab`);

  patchPrototypeMethod(proto, "_onRender", (original) => async function jinxTagOnRender(context, options) {
    await original.call(this, context, options);
    if ( !isTagLikeCodexSheet(this) || this._selectedSheet ) return;
    const root = this.element;
    if ( !root ) return;
    await ensureFactionSidebarNavInDom(this, root);
    if ( this._currentTab ) syncFactionSidebarNavActive(root, this._currentTab);
  }, `${PATCH_MARKER}OnRender`);

  log("Faction sheet Known People / Quests sidebar patched");
  return true;
}

function getCreateFactionTooltipTitle(localize, format) {
  const faction = localize("names.faction") || "Faction";
  return format("button.title", { type: faction });
}

/**
 * @param {typeof import("modules/campaign-codex/scripts/helper.js").localize} localize
 * @param {typeof import("modules/campaign-codex/scripts/helper.js").format} format
 */
function buildCreateFactionRibbon(localize, format) {
  const title = getCreateFactionTooltipTitle(localize, format);
  const escaped = foundry.utils.escapeHTML(title);
  return `<i class="fas fa-people-group refresh-btn create-faction-button" data-action="createTag" title="${escaped}" data-tooltip="${escaped}" aria-label="${escaped}"></i>`;
}

/**
 * @param {import("modules/campaign-codex/scripts/sheets/location-sheet.js").LocationSheet} sheet
 * @param {object} data
 */
async function generateLocationFactionsTab(sheet, data) {
  const { localize, format } = await importCampaignCodex("scripts/helper.js");
  const { TemplateComponents } = await importCampaignCodex("scripts/sheets/template-components.js");

  const label = sheet._labelOverride(sheet.document, "factions") || localize("names.factions");
  let buttons = "";
  if ( data?.isGM ) {
    buttons = buildCreateFactionRibbon(localize, format);
  }

  return `
      ${TemplateComponents.contentHeader("fas fa-people-group", label, buttons || null)}
      ${TemplateComponents.entityGrid(data.taggedNPCs, "npc", true, false)}
    `;
}

/**
 * NPC sheets label the createTag ribbon with names.npc upstream.
 * @returns {Promise<boolean>}
 */
async function patchNpcFactionsTabTooltip() {
  const { NPCSheet } = await importCampaignCodex("scripts/sheets/npc-sheet.js");
  const proto = NPCSheet.prototype;

  patchPrototypeMethod(proto, "_generateFactionsTab", (original) => async function jinxNpcFactionsTab(context) {
    const content = await original.call(this, context);
    const { localize, format } = await importCampaignCodex("scripts/helper.js");
    const ribbon = buildCreateFactionRibbon(localize, format);
    return content.replace(
      /<i class="fas fa-people-group refresh-btn create-npc-button" data-action="createTag" title="[^"]*"><\/i>/,
      ribbon
    );
  }, "__jinxFactionCreateTooltip");

  log("NPC factions tab create-faction tooltip patched");
  return true;
}

/**
 * @returns {Promise<boolean>}
 */
async function patchLocationFactionsTab() {
  const { LocationSheet } = await importCampaignCodex("scripts/sheets/location-sheet.js");
  patchPrototypeMethod(LocationSheet.prototype, "_generateFactionsTab", (original) => async function jinxLocationFactionsTab(data) {
    return generateLocationFactionsTab(this, data);
  }, "__jinxCampaignCodex");
  log("Location factions tab patched");
  return true;
}

/**
 * Campaign Codex Hub and sheets use CAMPAIGN_CODEX.names.npcs for the NPC category.
 */
function patchNpcCategoryLabel() {
  const languages = game.i18n?.languages?.length ? game.i18n.languages : [game.i18n.lang || "en"];
  for ( const lang of languages ) {
    const translations = game.i18n.translations?.[lang];
    if ( !translations ) continue;
    foundry.utils.setProperty(translations, "CAMPAIGN_CODEX.names.npcs", PEOPLE_LABEL);
  }
  log("NPCs category label set to People");
}

/**
 * Campaign Codex UI tweaks.
 */
export async function applyCampaignCodexTweaks() {
  if ( !game.modules.get(TARGET_MODULE_ID)?.active ) {
    log("Skipped (inactive or missing)");
    return;
  }

  await patchLocationFactionsTab();
  await patchNpcFactionsTabTooltip();
  await patchTagSheetFactionSidebar();
  await patchFandomWikiImporter();
  await patchImproveWriting();
  await patchCodexAutoLink();
  await patchCodexImagePicker();
  await patchCodexProseMirrorRecovery();
  await patchCodexHubFolders();
  await applyCampaignCodexOrganizations();
  await patchCodexSidebarDelete();
  patchNpcCategoryLabel();
  log("Campaign Codex UI tweaks active");
}
