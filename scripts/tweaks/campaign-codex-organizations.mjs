/**
 * Campaign Codex — Organizations sheet type (parallel to Factions / tag).
 */

import {
  ORGANIZATION_FOLDER_NAME,
  ORGANIZATION_SHEET_CLASS,
  ORGANIZATION_TYPE,
  campaignCodexUrl,
  filterFactionTaggedAssociates,
  filterOrganizationTaggedAssociates,
  getAssociateCodexType,
  getJournalCodexType,
  patchI18nOrganizationLabels,
} from "./campaign-codex-organization-shared.mjs";

const MODULE_ID = "jinxed-tweaks";
const TARGET_MODULE_ID = "campaign-codex";
const PATCH_MARKER = "__jinxOrganizations";

/** @type {typeof import("modules/campaign-codex/scripts/sheets/tag-sheet.js").TagSheet | null} */
let TagSheetClass = null;

/**
 * @param {string} message
 * @param {"log"|"warn"|"error"} [level]
 */
function log(message, level="log") {
  console[level](`${MODULE_ID} | campaign-codex-organizations | ${message}`);
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
 * @param {object} ctor
 * @param {string} method
 * @param {Function} wrapperFactory receives (originalBound, ...args)
 * @param {string} [marker]
 */
function patchStaticMethod(ctor, method, wrapperFactory, marker=PATCH_MARKER) {
  if ( !ctor || typeof ctor[method] !== "function" || ctor[method]?.[marker] ) return false;
  const original = ctor[method].bind(ctor);
  const patched = function(...args) {
    return wrapperFactory(original, ...args);
  };
  patched[marker] = true;
  ctor[method] = patched;
  return true;
}

/**
 * @param {string|Function} target
 * @param {Function} wrapper
 * @param {"WRAPPER"|"MIXED"} [type]
 */
function registerLibWrapper(target, wrapper, type="WRAPPER") {
  if ( typeof libWrapper?.register !== "function" || !game.modules.get("lib-wrapper")?.active ) return false;
  const label = typeof target === "function" ? (target.name || "function") : target;
  try {
    libWrapper.register(MODULE_ID, target, wrapper, type);
    return true;
  }
  catch ( error ) {
    log(`libWrapper ${label}: ${error?.message || error}`, "warn");
    return false;
  }
}

/**
 * @returns {import("foundry.documents.Folder")|null}
 */
function findOrganizationFolder() {
  return game.folders?.find?.((folder) => folder.type === "JournalEntry"
    && (folder.getFlag?.(TARGET_MODULE_ID, "type") === ORGANIZATION_TYPE
      || folder.name === ORGANIZATION_FOLDER_NAME)) || null;
}

/**
 * @returns {Promise<import("foundry.documents.Folder")|null>}
 */
async function ensureOrganizationFolder() {
  const existing = findOrganizationFolder();
  if ( existing ) return existing;

  const { getFolderColor } = await import(campaignCodexUrl("scripts/helper.js"));
  return Folder.create({
    name: ORGANIZATION_FOLDER_NAME,
    type: "JournalEntry",
    color: getFolderColor?.(ORGANIZATION_TYPE) || "#4a5568",
    flags: {
      [TARGET_MODULE_ID]: {
        type: ORGANIZATION_TYPE,
        autoOrganize: true,
      },
    },
  });
}

/**
 * @param {import("foundry.documents.Actor")|string|null} linkedActor
 * @param {string} name
 * @param {boolean} [openSheet]
 */
export async function createOrganizationJournal(linkedActor=null, name="New Organization", openSheet=false) {
  if ( !game.campaignCodex?.createTagJournal ) {
    ui.notifications.error("Campaign Codex is unavailable.");
    return null;
  }

  const folder = await ensureOrganizationFolder();
  const doc = await game.campaignCodex.createTagJournal(linkedActor, name, false);
  if ( !doc ) return null;

  await doc.update({
    folder: folder?.id ?? doc.folder?.id ?? null,
    flags: {
      [TARGET_MODULE_ID]: { type: ORGANIZATION_TYPE },
      core: { sheetClass: ORGANIZATION_SHEET_CLASS },
    },
  });

  if ( openSheet ) doc.sheet.render(true);
  return doc;
}

/**
 * @param {typeof import("modules/campaign-codex/scripts/sheets/tag-sheet.js").TagSheet} TagSheet
 */
export function defineOrganizationSheet(TagSheet) {
  class OrganizationSheet extends TagSheet {
    static DEFAULT_OPTIONS = foundry.utils.mergeObject(
      foundry.utils.deepClone(TagSheet.DEFAULT_OPTIONS),
      {
        classes: ["campaign-codex", "sheet", "journal-sheet", "group-sheet", "organization-sheet"],
        window: {
          title: "Campaign Codex Organization Sheet",
          icon: "fas fa-landmark",
        },
      },
      { inplace: false },
    );

    getSheetType() {
      return ORGANIZATION_TYPE;
    }

    async _prepareContext(options) {
      const context = await super._prepareContext(options);
      if ( !this._processedData ) return context;

      const { localize } = await import(campaignCodexUrl("scripts/helper.js"));
      const associates = this._processedData.associates || [];
      context.taggedNPCs = filterOrganizationTaggedAssociates(associates);
      context.associatesWithoutTaggedNPCs = associates.filter((entry) => !filterOrganizationTaggedAssociates([entry]).length);

      const leftPanelData = {
        regionLinks: context.regionLinks,
        locationLinks: context.locationLinks,
        linkedShops: context.linkedShops,
        linkedGroups: this._processedData.linkedGroups || [],
        associates: context.associatesWithoutTaggedNPCs,
        factions: context.taggedNPCs,
      };
      context.leftPanel = await this._generateLeftPanel(leftPanelData);
      context.sheetType = ORGANIZATION_TYPE;
      context.sheetTypeLabel = context.sheetTypeLabelOverride || localize("names.organization") || "Organization";

      for ( const tab of context.tabPanels || [] ) {
        if ( tab.key === "factions" ) {
          tab.label = this._labelOverride(this.document, "factions")
            || localize("names.organizations")
            || "Organizations";
        }
      }

      return context;
    }

    async _generateTreeNodes(data) {
      const { localize } = await import(campaignCodexUrl("scripts/helper.js"));
      const { TemplateComponents } = await import(campaignCodexUrl("scripts/sheets/template-components.js"));
      const html = await super._generateTreeNodes({
        ...data,
        factions: [],
      });

      const organizations = (data.factions || []).map((item) => ({
        name: item.name,
        uuid: item.uuid,
        type: "organization",
        displayIcon: item.iconOverride || TemplateComponents.getAsset("icon", ORGANIZATION_TYPE),
        isSelected: this._selectedSheet?.uuid === item.uuid,
        isClickable: true,
        hasChildren: false,
        hidden: !!item.hidden,
        id: item.id,
      }));

      if ( !organizations.length ) return html;

      const orgTree = await foundry.applications.handlebars.renderTemplate(
        "modules/campaign-codex/templates/partials/tag-tree-node.hbs",
        {
          node: {
            name: localize("names.organizations") || "Organizations",
            type: "category",
            uuid: "cat-organizations",
            displayIcon: TemplateComponents.getAsset("icon", ORGANIZATION_TYPE),
            hasChildren: true,
            children: organizations,
            isExpanded: this._expandedNodes.has("cat-organizations"),
            isClickable: false,
          },
          isGM: game.user.isGM,
        },
      );

      return `${html}${orgTree}`;
    }

    async _generateFactionsTab(context) {
      const { localize } = await import(campaignCodexUrl("scripts/helper.js"));
      const { TemplateComponents } = await import(campaignCodexUrl("scripts/sheets/template-components.js"));
      const label = this._labelOverride(this.document, "factions") || localize("names.organizations") || "Organizations";
      return `
        ${TemplateComponents.contentHeader("fas fa-landmark", label)}
        ${TemplateComponents.entityGrid(context.taggedNPCs, ORGANIZATION_TYPE, true, false)}
      `;
    }

    async _handleJournalDrop(data, event) {
      const journals = await this._resolveDroppedJournals(data);
      if ( !journals.length ) return super._handleJournalDrop(data, event);

      let shouldRender = false;
      for ( const journal of journals ) {
        const ownerJournal = journal.documentName === "JournalEntryPage" ? journal.parent : journal;
        if ( !ownerJournal || ownerJournal.uuid === this.document.uuid ) continue;
        const journalType = getJournalCodexType(ownerJournal);
        if ( journalType !== ORGANIZATION_TYPE ) continue;
        await game.campaignCodex.linkNPCToNPC(this.document, ownerJournal);
        shouldRender = true;
      }

      if ( shouldRender ) {
        this.render(true);
        return;
      }

      return super._handleJournalDrop(data, event);
    }
  }

  return OrganizationSheet;
}

/**
 * @param {Array<object>} associates
 */
function splitTaggedAssociatesForLocation(associates) {
  const tagged = associates.filter((entry) => entry.tag === true);
  return {
    taggedFactions: filterFactionTaggedAssociates(tagged),
    taggedOrganizations: filterOrganizationTaggedAssociates(tagged),
  };
}

/**
 * @param {object} context
 */
function enrichLocationOrNpcContext(context) {
  const split = splitTaggedAssociatesForLocation(context.taggedNPCs || []);
  context.taggedFactions = split.taggedFactions;
  context.taggedOrganizations = split.taggedOrganizations;
  context.taggedNPCs = split.taggedFactions;
  return context;
}

/**
 * @param {object} sheet
 * @param {object} context
 * @param {Function} localize
 */
async function generateOrganizationsTab(sheet, context, localize) {
  const { TemplateComponents } = await import(campaignCodexUrl("scripts/sheets/template-components.js"));
  const { format } = await import(campaignCodexUrl("scripts/helper.js"));
  const label = sheet._labelOverride?.(sheet.document, "organizations") || localize("names.organizations") || "Organizations";
  let buttons = "";
  if ( context.isGM ) {
    const title = format("button.title", { type: localize("names.organization") || "Organization" });
    const escaped = foundry.utils.escapeHTML(title);
    buttons = `<i class="fas fa-landmark refresh-btn create-organization-button" data-action="createOrganization" title="${escaped}" data-tooltip="${escaped}" aria-label="${escaped}"></i>`;
  }
  return `
    ${TemplateComponents.contentHeader("fas fa-landmark", label, buttons || null)}
    ${TemplateComponents.entityGrid(context.taggedOrganizations || [], ORGANIZATION_TYPE, true, false)}
  `;
}

async function patchAssociatesResolution() {
  const { CampaignCodexLinkers } = await import(campaignCodexUrl("scripts/sheets/linkers.js"));

  const normalizeTaggedEntry = (entry, parentType) => {
    const childType = getAssociateCodexType(entry);
    if ( parentType === ORGANIZATION_TYPE && childType === ORGANIZATION_TYPE ) {
      return { ...entry, tag: true, type: ORGANIZATION_TYPE };
    }
    if ( parentType === "tag" && childType === ORGANIZATION_TYPE ) {
      return { ...entry, tag: false };
    }
    if ( parentType === ORGANIZATION_TYPE && childType === "tag" ) {
      return { ...entry, tag: false };
    }
    if ( parentType === "tag" && childType === "tag" ) {
      return { ...entry, tag: true, type: "faction" };
    }
    return entry;
  };

  patchPrototypeMethod(CampaignCodexLinkers, "getAssociates", (original) => async function jinxOrgGetAssociates(doc, uuids) {
    const associates = await original.call(this, doc, uuids);
    const parentType = getJournalCodexType(doc);
    return associates.map((entry) => normalizeTaggedEntry(entry, parentType));
  }, `${PATCH_MARKER}Associates`);

  if ( CampaignCodexLinkers.getLinkedNPCs ) {
    patchPrototypeMethod(CampaignCodexLinkers, "getLinkedNPCs", (original) => async function jinxOrgGetLinkedNPCs(doc, uuids) {
      const linked = await original.call(this, doc, uuids);
      const parentType = getJournalCodexType(doc);
      return linked.map((entry) => normalizeTaggedEntry(entry, parentType));
    }, `${PATCH_MARKER}LinkedNPCs`);
  }
}

async function patchTagSheetFactionFilter() {
  const { TagSheet } = await import(campaignCodexUrl("scripts/sheets/tag-sheet.js"));
  TagSheetClass = TagSheet;

  patchPrototypeMethod(TagSheet.prototype, "_prepareContext", (original) => async function jinxOrgTagPrepareContext(options) {
    const context = await original.call(this, options);
    if ( this.getSheetType?.() !== "tag" || !this._processedData ) return context;

    const associates = this._processedData.associates || [];
    context.taggedNPCs = filterFactionTaggedAssociates(associates);
    context.associatesWithoutTaggedNPCs = associates.filter((entry) => !filterFactionTaggedAssociates([entry]).length);

    const leftPanelData = {
      regionLinks: context.regionLinks,
      locationLinks: context.locationLinks,
      linkedShops: context.linkedShops,
      linkedGroups: this._processedData.linkedGroups || [],
      associates: context.associatesWithoutTaggedNPCs,
      factions: context.taggedNPCs,
    };
    context.leftPanel = await this._generateLeftPanel(leftPanelData);
    return context;
  }, `${PATCH_MARKER}TagPrepare`);
}

async function patchLocationAndNpcSheets() {
  const [{ LocationSheet }, { NPCSheet }] = await Promise.all([
    import(campaignCodexUrl("scripts/sheets/location-sheet.js")),
    import(campaignCodexUrl("scripts/sheets/npc-sheet.js")),
  ]);
  const { localize } = await import(campaignCodexUrl("scripts/helper.js"));
  const { TemplateComponents } = await import(campaignCodexUrl("scripts/sheets/template-components.js"));

  const patchSheet = (SheetClass) => {
    patchPrototypeMethod(SheetClass.prototype, "_prepareContext", (original) => async function jinxOrgLocationNpcPrepareContext(options) {
      const context = await original.call(this, options);
      enrichLocationOrNpcContext(context);

      const visibleOrganizationCount = this.constructor.countVisibleEntitiesForStats(context.taggedOrganizations || []);
      const orgTab = {
        key: "organizations",
        statistic: { value: visibleOrganizationCount, view: visibleOrganizationCount > 0 },
        active: this._currentTab === "organizations",
        content: this._currentTab === "organizations"
          ? await generateOrganizationsTab(this, context, localize)
          : "",
        label: localize("names.organizations") || "Organizations",
        icon: TemplateComponents.getAsset("icon", ORGANIZATION_TYPE),
      };

      const factionsIndex = context.tabPanels?.findIndex((tab) => tab.key === "factions") ?? -1;
      if ( factionsIndex >= 0 ) context.tabPanels.splice(factionsIndex + 1, 0, orgTab);
      else context.tabPanels?.push(orgTab);

      return context;
    }, `${PATCH_MARKER}LocationNpc`);

    if ( SheetClass.prototype._handleJournalDrop ) {
      patchPrototypeMethod(SheetClass.prototype, "_handleJournalDrop", (original) => async function jinxOrgSheetJournalDrop(data, event) {
        const journals = await this._resolveDroppedJournals(data);
        if ( !journals.length ) return original.call(this, data, event);

        let shouldRender = false;
        for ( const journal of journals ) {
          const ownerJournal = journal.documentName === "JournalEntryPage" ? journal.parent : journal;
          if ( !ownerJournal || ownerJournal.uuid === this.document.uuid ) continue;
          const journalType = getJournalCodexType(ownerJournal);
          if ( journalType !== ORGANIZATION_TYPE ) continue;

          const myType = getJournalCodexType(this.document);
          if ( myType === "location" ) await game.campaignCodex.linkLocationToNPC(this.document, ownerJournal);
          else if ( myType === "region" ) await game.campaignCodex.linkRegionToNPC(this.document, ownerJournal);
          else if ( myType === "shop" ) await game.campaignCodex.linkShopToNPC(this.document, ownerJournal);
          else if ( myType === "npc" ) await game.campaignCodex.linkNPCToNPC(this.document, ownerJournal);
          else continue;

          shouldRender = true;
        }

        if ( shouldRender ) {
          this.render(true);
          return;
        }

        return original.call(this, data, event);
      }, `${PATCH_MARKER}JournalDrop`);
    }
  };

  patchSheet(LocationSheet);
  patchSheet(NPCSheet);
}

async function patchBaseSheetLinking() {
  const { CampaignCodexBaseSheet } = await import(campaignCodexUrl("scripts/sheets/base-sheet.js"));

  if ( !CampaignCodexBaseSheet.DEFAULT_OPTIONS.actions.createOrganization ) {
    CampaignCodexBaseSheet.DEFAULT_OPTIONS.actions.createOrganization = async function onCreateOrganization(event) {
      event.stopPropagation();
      event.preventDefault();
      const { localize } = await import(campaignCodexUrl("scripts/helper.js"));
      const name = await foundry.applications.api.DialogV2.prompt({
        window: { title: localize("names.organization") || "Organization" },
        content: '<div class="form-group"><label>Name</label><input type="text" name="entryName" autofocus></div>',
        ok: {
          label: "Create",
          callback: (_evt, button) => String(button.form.elements.entryName.value || "").trim(),
        },
        cancel: { label: localize("dialog.cancel") },
        rejectClose: false,
      }).catch(() => null);
      if ( !name ) return;
      const orgJournal = await createOrganizationJournal(null, name, false);
      if ( orgJournal ) await this._linkTagToSheet(event, orgJournal.uuid);
    };
  }

  patchPrototypeMethod(CampaignCodexBaseSheet.prototype, "_linkTagToSheet", (original) => async function jinxOrgLinkTagToSheet(event, tagUuid) {
    const myType = getJournalCodexType(this.document);
    const tagDoc = await fromUuid(tagUuid);
    if ( !tagDoc ) return original.call(this, event, tagUuid);

    const tagType = getJournalCodexType(tagDoc);
    if ( myType === ORGANIZATION_TYPE && tagType === ORGANIZATION_TYPE ) {
      await game.campaignCodex.linkNPCToNPC(this.document, tagDoc);
      return;
    }

    return original.call(this, event, tagUuid);
  }, `${PATCH_MARKER}LinkTag`);

  patchPrototypeMethod(CampaignCodexBaseSheet.prototype, "getSheetType", (original) => function jinxOrgGetSheetType() {
    const explicit = getJournalCodexType(this.document);
    if ( explicit === ORGANIZATION_TYPE ) return ORGANIZATION_TYPE;
    return original.call(this);
  }, `${PATCH_MARKER}GetSheetType`);
}

const HUB_TYPE_ORDER = ["npc", "quest", "group", "region", "location", "shop", "tag", "organization"];

/**
 * @param {object} doc
 */
function resolveHubDocument(doc) {
  if ( !doc?.uuid ) return doc;
  const journal = fromUuidSync(doc.uuid);
  const resolvedType = getJournalCodexType(journal) || doc.type;
  if ( !journal || resolvedType === doc.type ) return doc;

  const data = journal.getFlag?.(TARGET_MODULE_ID, "data") || {};
  const groupOverride = String(data.sheetTypeLabelOverride || "").trim()
    || String(journal.getFlag?.(TARGET_MODULE_ID, "type") || "").trim().toLowerCase();

  return {
    ...doc,
    type: resolvedType,
    groupOverride,
    sheetTypeLabelOverride: String(data.sheetTypeLabelOverride || "").trim(),
  };
}

/**
 * @param {Array<{ type: string, label: string, icon: string, count: number }>} stats
 */
function sortDashboardStats(stats) {
  const order = new Map(HUB_TYPE_ORDER.map((type, index) => [type, index]));
  return [...stats].sort((left, right) => {
    const leftOrder = order.has(left.type) ? order.get(left.type) : HUB_TYPE_ORDER.length;
    const rightOrder = order.has(right.type) ? order.get(right.type) : HUB_TYPE_ORDER.length;
    if ( leftOrder !== rightOrder ) return leftOrder - rightOrder;
    return left.label.localeCompare(right.label, undefined, { numeric: true });
  });
}

/**
 * @param {object} context
 */
async function enrichHubOrganizationContext(context) {
  const { TemplateComponents } = await import(campaignCodexUrl("scripts/sheets/template-components.js"));
  const { localize } = await import(campaignCodexUrl("scripts/helper.js"));
  const orgLabel = localize("names.organizations") || "Organizations";
  const orgIcon = TemplateComponents.getAsset("icon", ORGANIZATION_TYPE);
  const orgJournals = game.journal.filter((journal) => getJournalCodexType(journal) === ORGANIZATION_TYPE);

  const hubState = game.user?.getFlag?.("campaign-codex", "hubState") || {};
  const requestedBrowse = String(hubState.browseType || "").trim().toLowerCase();
  if ( requestedBrowse === ORGANIZATION_TYPE && !context.isTypeBrowser ) {
    context.isHome = false;
    context.isTypeBrowser = true;
    context.typeBrowser = {
      type: ORGANIZATION_TYPE,
      label: orgLabel,
      icon: orgIcon,
      items: orgJournals.map((journal) => ({
        id: journal.id,
        uuid: journal.uuid,
        name: journal.name,
        img: journal.getFlag?.(TARGET_MODULE_ID, "image") || TemplateComponents.getAsset("image", ORGANIZATION_TYPE),
        showImage: true,
        tags: [],
      })),
    };
  }
  else if ( context.typeBrowser?.type === ORGANIZATION_TYPE ) {
    context.typeBrowser = {
      ...context.typeBrowser,
      label: orgLabel,
      icon: orgIcon,
      items: orgJournals.map((journal) => ({
        id: journal.id,
        uuid: journal.uuid,
        name: journal.name,
        img: journal.getFlag?.(TARGET_MODULE_ID, "image") || TemplateComponents.getAsset("image", ORGANIZATION_TYPE),
        showImage: true,
        tags: [],
      })),
    };
  }

  const stats = Array.isArray(context.dashboardStats) ? [...context.dashboardStats] : [];
  const orgIndex = stats.findIndex((entry) => entry.type === ORGANIZATION_TYPE);
  const orgCount = orgJournals.length;

  if ( orgIndex === -1 ) {
    stats.push({
      type: ORGANIZATION_TYPE,
      label: orgLabel,
      icon: orgIcon,
      count: orgCount,
    });
  }
  else {
    stats[orgIndex] = {
      ...stats[orgIndex],
      label: orgLabel,
      icon: orgIcon,
      count: orgCount,
    };
  }

  const tagIndex = stats.findIndex((entry) => entry.type === "tag");
  if ( tagIndex >= 0 && orgCount > 0 ) {
    const miscounted = orgJournals.filter((journal) => journal.getFlag?.(TARGET_MODULE_ID, "type") === "tag").length;
    if ( miscounted > 0 ) {
      stats[tagIndex] = {
        ...stats[tagIndex],
        count: Math.max(0, (stats[tagIndex].count || 0) - miscounted),
      };
    }
  }

  context.dashboardStats = sortDashboardStats(stats);
}

async function patchHub() {
  const [{ CampaignCodexHub }] = await Promise.all([
    import(campaignCodexUrl("scripts/campaign-codex-hub.js")),
  ]);
  const { localize } = await import(campaignCodexUrl("scripts/helper.js"));
  const { TemplateComponents } = await import(campaignCodexUrl("scripts/sheets/template-components.js"));
  const { createFromScene } = await import(campaignCodexUrl("scripts/helper.js"));

  patchPrototypeMethod(CampaignCodexHub.prototype, "_getDocumentGroup", (original) => function jinxOrgHubGroup(doc) {
    return original.call(this, resolveHubDocument(doc));
  }, `${PATCH_MARKER}HubGroup`);

  patchPrototypeMethod(CampaignCodexHub.prototype, "_prepareContext", (original) => async function jinxOrgHubPrepareContext(options) {
    const context = await original.call(this, options);
    await enrichHubOrganizationContext(context);
    return context;
  }, `${PATCH_MARKER}HubContext`);

  patchPrototypeMethod(CampaignCodexHub.prototype, "_promptCreateSheet", (original) => async function jinxOrgHubCreateSheet(folderId=null) {
    const createType = await foundry.applications.api.DialogV2.prompt({
      window: { title: "Create Campaign Codex Sheet" },
      content: `
        <div class="form-group">
          <label>Sheet Type</label>
          <select name="sheetType">
            <option value="group">Group</option>
            <option value="region">Region</option>
            <option value="location">Location</option>
            <option value="shop">Entry</option>
            <option value="npc">NPC</option>
            <option value="tag">Faction</option>
            <option value="${ORGANIZATION_TYPE}">Organization</option>
            <option value="quest">Quest</option>
          </select>
        </div>
      `,
      ok: {
        icon: '<i class="fas fa-check"></i>',
        label: "Create",
        callback: (_event, button) => button.form.elements.sheetType.value,
      },
      cancel: {
        icon: '<i class="fas fa-times"></i>',
        label: localize("dialog.cancel"),
      },
      rejectClose: false,
    }).catch(() => null);

    if ( !createType ) return;
    if ( createType === ORGANIZATION_TYPE ) {
      const name = await foundry.applications.api.DialogV2.prompt({
        window: { title: "Create Organization" },
        content: '<div class="form-group"><label>Name</label><input type="text" name="entryName" autofocus></div>',
        ok: {
          label: "Create",
          callback: (_event, button) => String(button.form.elements.entryName.value || "").trim(),
        },
        cancel: { label: localize("dialog.cancel") },
        rejectClose: false,
      }).catch(() => null);
      if ( !name ) return;
      const doc = await createOrganizationJournal(null, name, false);
      if ( doc && folderId && doc.folder?.id !== folderId ) await doc.update({ folder: folderId });
      doc?.sheet.render(true);
      return;
    }

    return createFromScene(createType, { folderId });
  }, `${PATCH_MARKER}HubCreate`);
}

async function patchHelperSurfaces() {
  const helperUrl = campaignCodexUrl("scripts/helper.js");
  const helper = await import(helperUrl);

  if ( typeof helper.getCodexType === "function" ) {
    registerLibWrapper(helper.getCodexType, function(wrapped, ...args) {
      const journal = args[0];
      const explicit = String(journal?.getFlag?.(TARGET_MODULE_ID, "type") || "").trim().toLowerCase();
      if ( explicit === ORGANIZATION_TYPE ) return ORGANIZATION_TYPE;
      if ( journal?.flags?.core?.sheetClass === ORGANIZATION_SHEET_CLASS ) return ORGANIZATION_TYPE;
      return wrapped(...args);
    });
  }

  if ( typeof helper.getCampaignCodexFolder === "function" ) {
    registerLibWrapper(helper.getCampaignCodexFolder, function(wrapped, codexType, ...args) {
      if ( codexType === ORGANIZATION_TYPE ) {
        return findOrganizationFolder() || wrapped(codexType, ...args);
      }
      return wrapped(codexType, ...args);
    });
  }

  if ( typeof helper.createFromScene === "function" ) {
    registerLibWrapper(helper.createFromScene, async function(wrapped, type, options={}) {
      if ( type !== ORGANIZATION_TYPE ) return wrapped(type, options);
      const { promptForName } = helper;
      const name = await promptForName("Organization");
      if ( !name ) return;
      const doc = await createOrganizationJournal(null, name, false);
      const folderId = String(options.folderId || "").trim() || null;
      if ( doc && folderId && doc.folder?.id !== folderId ) await doc.update({ folder: folderId });
      doc?.sheet.render(true);
      return doc;
    });
  }

  const { TemplateComponents } = await import(campaignCodexUrl("scripts/sheets/template-components.js"));
  const getAssetWrapper = function(wrapped, assetKind, sheetType) {
    if ( sheetType === ORGANIZATION_TYPE ) {
      if ( assetKind === "icon" ) return "fas fa-landmark";
      if ( assetKind === "image" ) return "modules/campaign-codex/assets/images/placeholder-tag.webp";
    }
    return wrapped(assetKind, sheetType);
  };

  if ( typeof TemplateComponents?.getAsset === "function" ) {
    if ( !registerLibWrapper(TemplateComponents.getAsset, getAssetWrapper, "MIXED") ) {
      patchStaticMethod(TemplateComponents, "getAsset", getAssetWrapper);
    }
  }

  const journalProto = foundry.documents?.JournalEntry?.prototype;
  if ( journalProto?.getFlag ) {
    registerLibWrapper(journalProto.getFlag, function(wrapped, scope, key, ...args) {
      const value = wrapped(scope, key, ...args);
      if ( scope !== TARGET_MODULE_ID || key !== "type" ) return value;
      const explicit = String(value || "").trim().toLowerCase();
      if ( explicit ) return value;
      if ( this.flags?.core?.sheetClass === ORGANIZATION_SHEET_CLASS ) return ORGANIZATION_TYPE;
      return value;
    }, "MIXED");
  }
}

async function patchJournalDirectoryButton() {
  const observer = new MutationObserver(() => {
    const header = document.querySelector("#journal .directory-header .header-actions");
    if ( !header || header.querySelector(".create-organization-btn") || !game.user.isGM ) return;

    const button = document.createElement("button");
    button.type = "button";
    button.className = "create-organization-btn cc-create-buttons";
    button.title = "Create Organization";
    button.innerHTML = '<i class="fas fa-landmark"></i>';
    button.addEventListener("click", async () => {
      const { promptForName } = await import(campaignCodexUrl("scripts/helper.js"));
      const name = await promptForName("Organization");
      if ( name ) await createOrganizationJournal(null, name, true);
    });

    const tagButton = header.querySelector(".create-tag-btn");
    if ( tagButton ) tagButton.insertAdjacentElement("afterend", button);
    else header.append(button);
  });

  observer.observe(document.body, { childList: true, subtree: true });
}

/**
 * @returns {Promise<boolean>}
 */
export async function applyCampaignCodexOrganizations() {
  if ( !game.modules.get(TARGET_MODULE_ID)?.active ) return false;

  const { TagSheet } = await import(campaignCodexUrl("scripts/sheets/tag-sheet.js"));
  const OrganizationSheet = defineOrganizationSheet(TagSheet);

  const DocumentSheetConfig = foundry.applications.apps.DocumentSheetConfig;
  DocumentSheetConfig.registerSheet(JournalEntry, MODULE_ID, OrganizationSheet, {
    types: ["base"],
    label: "Campaign Codex Organization",
    makeDefault: false,
  });

  game.campaignCodex.createOrganizationJournal = createOrganizationJournal;

  patchI18nOrganizationLabels();
  await patchHelperSurfaces();
  await patchAssociatesResolution();
  await patchTagSheetFactionFilter();
  await patchBaseSheetLinking();
  await patchLocationAndNpcSheets();
  await patchHub();
  patchJournalDirectoryButton();
  await ensureOrganizationFolder();

  log("Campaign Codex Organizations enabled");
  return true;
}

export { ORGANIZATION_TYPE, ORGANIZATION_SHEET_CLASS };
