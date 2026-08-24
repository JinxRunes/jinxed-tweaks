/**
 * Campaign Codex Hub — category folders under type groups (e.g. People).
 *
 * GMs can right-click a type category to add folders, then drag entries into them.
 * Uses Foundry Journal folders under the Campaign Codex type roots when available,
 * with a virtual-folder fallback when organized folders are disabled.
 */

const MODULE_ID = "jinxed-tweaks";
const TARGET_MODULE_ID = "campaign-codex";
const PATCH_MARKER = "__jinxCodexHubFolders";
const SETTING_VIRTUAL_FOLDERS = "codexHubVirtualFolders";
const VIRTUAL_FOLDER_PREFIX = "virtual:";

/**
 * @param {string} message
 * @param {"log"|"warn"|"error"} [level]
 */
function log(message, level="log") {
  console[level](`${MODULE_ID} | campaign-codex-hub-folders | ${message}`);
}

/**
 * @param {string} relativePath
 */
function campaignCodexUrl(relativePath) {
  return `/modules/${TARGET_MODULE_ID}/${String(relativePath || "").replace(/^\/+/, "")}`;
}

/**
 * @returns {{ folders: Record<string, { id: string, name: string, typeKey: string, parentId: string|null }>, assignments: Record<string, string> }}
 */
function getVirtualFolderState() {
  const state = game.settings.get(MODULE_ID, SETTING_VIRTUAL_FOLDERS);
  if ( !state || typeof state !== "object" ) return { folders: {}, assignments: {} };
  return {
    folders: state.folders || {},
    assignments: state.assignments || {},
  };
}

/**
 * @param {{ folders: Record<string, object>, assignments: Record<string, string> }} state
 */
async function setVirtualFolderState(state) {
  await game.settings.set(MODULE_ID, SETTING_VIRTUAL_FOLDERS, state);
}

/**
 * @param {string} typeKey
 */
function codexTypeFromGroupKey(typeKey) {
  return String(typeKey || "").replace(/^type:/, "").trim().toLowerCase();
}

/**
 * @param {Folder} folder
 * @param {Folder} rootFolder
 */
function isFolderUnderRoot(folder, rootFolder) {
  if ( !folder || !rootFolder ) return false;
  if ( folder.id === rootFolder.id ) return true;
  let current = folder.folder;
  while ( current ) {
    if ( current.id === rootFolder.id ) return true;
    current = current.folder;
  }
  return false;
}

/**
 * @param {Folder} folder
 * @param {Folder} rootFolder
 */
function getRelativeFolderSegments(folder, rootFolder) {
  const segments = [];
  let current = folder;
  while ( current && current.id !== rootFolder.id ) {
    segments.unshift({
      key: `folder:${current.id}`,
      label: current.name || "Folder",
      folderId: current.id,
      canCreate: true,
      icon: "fas fa-folder",
      sortKey: current.name || "",
    });
    current = current.folder;
  }
  return segments;
}

/**
 * @param {string} typeKey
 */
function getVirtualFoldersForType(typeKey) {
  const { folders } = getVirtualFolderState();
  return Object.values(folders).filter((folder) => folder.typeKey === typeKey);
}

/**
 * @param {Map<string, object>} siblings
 * @param {Array<{ key: string, label: string, folderId: string, canCreate?: boolean, icon?: string, sortKey?: string }>} segments
 */
function ensureFolderTreeNodes(siblings, segments) {
  let map = siblings;
  for ( const segment of segments ) {
    let node = map.get(segment.key);
    if ( !node ) {
      node = {
        ...segment,
        directDocs: [],
        childMap: new Map(),
        isVirtual: segment.folderId?.startsWith?.(VIRTUAL_FOLDER_PREFIX),
      };
      map.set(segment.key, node);
    }
    map = node.childMap;
  }
}

/**
 * @param {Map<string, object>} folderTree
 * @param {string} codexType
 */
function addEmptyFoundrySubfolders(folderTree, codexType) {
  const rootFolder = getCampaignCodexFolderSafe(codexType);
  if ( !rootFolder ) return;

  for ( const folder of game.folders ) {
    if ( folder.type !== "JournalEntry" || folder.folder?.id !== rootFolder.id ) continue;
    ensureFolderTreeNodes(folderTree, getRelativeFolderSegments(folder, rootFolder));
  }
}

/**
 * @param {Map<string, object>} siblings
 * @param {Array<{ key: string, label: string, folderId: string, canCreate?: boolean, icon?: string, sortKey?: string }>} segments
 * @param {object} docItem
 */
function addDocToFolderTree(siblings, segments, docItem) {
  if ( !segments.length ) return;
  let node = null;
  let map = siblings;
  for ( const segment of segments ) {
    node = map.get(segment.key);
    if ( !node ) {
      node = {
        ...segment,
        directDocs: [],
        childMap: new Map(),
        isVirtual: segment.folderId?.startsWith?.(VIRTUAL_FOLDER_PREFIX),
      };
      map.set(segment.key, node);
    }
    map = node.childMap;
  }
  node?.directDocs.push(docItem);
}

/**
 * @param {Map<string, object>} nodes
 * @param {Set<string>} expandedGroups
 */
function finalizeFolderNodes(nodes, expandedGroups) {
  return [...nodes.values()]
    .sort((a, b) => String(a.sortKey || a.label).localeCompare(String(b.sortKey || b.label), undefined, { numeric: true }))
    .map((node) => {
      const children = finalizeFolderNodes(node.childMap, expandedGroups);
      const isOpen = expandedGroups.has(node.key);
      return {
        key: node.key,
        label: node.label,
        icon: node.icon === "fas fa-folder" && isOpen ? "fas fa-folder-open" : node.icon,
        folderId: node.folderId,
        folderCreatable: node.canCreate !== false,
        count: node.directDocs.length + children.reduce((total, child) => total + child.count, 0),
        isOpen,
        items: node.directDocs,
        children,
      };
    });
}

/**
 * @param {Array<object>} items
 * @param {string} codexType
 * @param {string} typeKey
 * @param {Set<string>} expandedGroups
 */
function splitGroupItemsByFolders(items, codexType, typeKey, expandedGroups) {
  const rootFolder = getCampaignCodexFolderSafe(codexType);
  const useOrganized = game.settings.get(TARGET_MODULE_ID, "useOrganizedFolders") !== false;
  const virtualState = getVirtualFolderState();
  const virtualFolders = getVirtualFoldersForType(typeKey);
  const folderTree = new Map();
  const rootItems = [];

  for ( const item of items ) {
    const journal = fromUuidSync(item.uuid);
    let segments = [];

    if ( useOrganized && rootFolder && journal?.folder && journal.folder.id !== rootFolder.id
      && isFolderUnderRoot(journal.folder, rootFolder) ) {
      segments = getRelativeFolderSegments(journal.folder, rootFolder);
    }
    else {
      const virtualFolderId = virtualState.assignments[item.uuid];
      const virtualFolder = virtualFolderId ? virtualState.folders[virtualFolderId] : null;
      if ( virtualFolder && virtualFolder.typeKey === typeKey ) {
        const chain = [];
        let current = virtualFolder;
        while ( current ) {
          chain.unshift({
            key: `${VIRTUAL_FOLDER_PREFIX}${current.id}`,
            label: current.name,
            folderId: `${VIRTUAL_FOLDER_PREFIX}${current.id}`,
            canCreate: true,
            icon: "fas fa-folder",
            sortKey: current.name,
          });
          current = current.parentId ? virtualState.folders[current.parentId] : null;
        }
        segments = chain;
      }
    }

    if ( segments.length ) addDocToFolderTree(folderTree, segments, item);
    else rootItems.push(item);
  }

  for ( const virtualFolder of virtualFolders ) {
  const key = `${VIRTUAL_FOLDER_PREFIX}${virtualFolder.id}`;
    if ( !folderTree.has(key) ) {
      folderTree.set(key, {
        key,
        label: virtualFolder.name,
        folderId: key,
        canCreate: true,
        icon: "fas fa-folder",
        sortKey: virtualFolder.name,
        directDocs: [],
        childMap: new Map(),
        isVirtual: true,
      });
    }
  }

  if ( useOrganized ) addEmptyFoundrySubfolders(folderTree, codexType);

  return {
    folderChildren: finalizeFolderNodes(folderTree, expandedGroups),
    rootItems,
  };
}

/**
 * @param {string} codexType
 */
function getCampaignCodexFolderSafe(codexType) {
  try {
    const helper = game.modules.get(TARGET_MODULE_ID)?.api?.getCampaignCodexFolder;
    if ( typeof helper === "function" ) return helper(codexType);
  }
  catch { /* ignore */ }

  return game.settings.get(TARGET_MODULE_ID, "useOrganizedFolders") === false
    ? null
    : game.folders?.find?.((folder) => {
      const type = folder.getFlag?.(TARGET_MODULE_ID, "type");
      return folder.type === "JournalEntry" && type === codexType && folder.getFlag?.(TARGET_MODULE_ID, "autoOrganize");
    }) || null;
}

/**
 * @returns {Set<string>}
 */
function getHubExpandedGroups() {
  const saved = game.user?.getFlag?.("campaign-codex", "hubState") || {};
  return new Set(Array.isArray(saved.expandedGroups) ? saved.expandedGroups : []);
}

/**
 * @param {object} context
 */
function enrichTypeGroupsWithFolders(context) {
  if ( context.isFolderGroupMode || context.groupMode !== "type" ) return;

  const expandedGroups = getHubExpandedGroups();

  for ( const group of context.groups ) {
    if ( !group.key?.startsWith?.("type:") ) continue;
    const codexType = codexTypeFromGroupKey(group.key);
    const items = Array.isArray(group.items) ? group.items : [];
    const split = splitGroupItemsByFolders(items, codexType, group.key, expandedGroups);

    group.folderChildren = split.folderChildren;
    group.rootItems = split.rootItems;
    group.hasCategoryFolders = split.folderChildren.length > 0
      || Boolean(getCampaignCodexFolderSafe(codexType))
      || getVirtualFoldersForType(group.key).length > 0;
  }
}

/**
 * @param {string} typeKey
 * @param {string|null} parentFolderId
 */
async function promptCreateCategoryFolder(typeKey, parentFolderId = null) {
  const codexType = codexTypeFromGroupKey(typeKey);
  const { ensureCampaignCodexFolders, getCampaignCodexFolder } = await import(campaignCodexUrl("scripts/helper.js"));
  const name = await foundry.applications.api.DialogV2.prompt({
    window: { title: game.i18n.localize("JINXED_TWEAKS.CodexHubFolders.CreateFolderTitle") },
    content: `<div class="form-group"><label>${game.i18n.localize("JINXED_TWEAKS.CodexHubFolders.FolderName")}</label><input type="text" name="folderName" autofocus></div>`,
    ok: {
      label: game.i18n.localize("JINXED_TWEAKS.CodexHubFolders.CreateFolder"),
      icon: '<i class="fas fa-folder-plus"></i>',
      callback: (_event, button) => String(button.form.elements.folderName.value || "").trim(),
    },
    cancel: { label: game.i18n.localize("Cancel") },
    rejectClose: false,
  }).catch(() => null);

  if ( !name ) return null;

  if ( game.settings.get(TARGET_MODULE_ID, "useOrganizedFolders") !== false ) {
    await ensureCampaignCodexFolders();
    const root = getCampaignCodexFolder(codexType);
    if ( root ) {
      let parentId = root.id;
      if ( parentFolderId && !parentFolderId.startsWith(VIRTUAL_FOLDER_PREFIX) ) {
        parentId = parentFolderId;
      }
      else if ( parentFolderId?.startsWith?.(VIRTUAL_FOLDER_PREFIX) ) {
        parentId = root.id;
      }
      return Folder.create({ name, type: "JournalEntry", folder: parentId });
    }
  }

  const state = getVirtualFolderState();
  const id = foundry.utils.randomID();
  const parentVirtualId = parentFolderId?.startsWith?.(VIRTUAL_FOLDER_PREFIX)
    ? parentFolderId.slice(VIRTUAL_FOLDER_PREFIX.length)
    : null;
  state.folders[id] = { id, name, typeKey, parentId: parentVirtualId };
  await setVirtualFolderState(state);
  return { id: `${VIRTUAL_FOLDER_PREFIX}${id}`, name };
}

/**
 * @param {string} folderId
 */
async function promptRenameCategoryFolder(folderId) {
  const isVirtual = folderId.startsWith(VIRTUAL_FOLDER_PREFIX);
  const currentName = isVirtual
    ? getVirtualFolderState().folders[folderId.slice(VIRTUAL_FOLDER_PREFIX.length)]?.name
    : game.folders.get(folderId)?.name;

  const name = await foundry.applications.api.DialogV2.prompt({
    window: { title: game.i18n.localize("JINXED_TWEAKS.CodexHubFolders.RenameFolderTitle") },
    content: `<div class="form-group"><label>${game.i18n.localize("JINXED_TWEAKS.CodexHubFolders.FolderName")}</label><input type="text" name="folderName" value="${foundry.utils.escapeHTML(currentName || "")}" autofocus></div>`,
    ok: {
      label: game.i18n.localize("JINXED_TWEAKS.CodexHubFolders.RenameFolder"),
      callback: (_event, button) => String(button.form.elements.folderName.value || "").trim(),
    },
    cancel: { label: game.i18n.localize("Cancel") },
    rejectClose: false,
  }).catch(() => null);

  if ( !name || name === currentName ) return;

  if ( isVirtual ) {
    const state = getVirtualFolderState();
    const id = folderId.slice(VIRTUAL_FOLDER_PREFIX.length);
    if ( state.folders[id] ) {
      state.folders[id].name = name;
      await setVirtualFolderState(state);
    }
    return;
  }

  const folder = game.folders.get(folderId);
  if ( folder ) await folder.update({ name });
}

/**
 * @param {string} folderId
 */
async function deleteCategoryFolder(folderId) {
  const confirmed = await foundry.applications.api.DialogV2.confirm({
    window: { title: game.i18n.localize("JINXED_TWEAKS.CodexHubFolders.DeleteFolderTitle") },
    content: `<p>${game.i18n.localize("JINXED_TWEAKS.CodexHubFolders.DeleteFolderConfirm")}</p>`,
  });
  if ( !confirmed ) return;

  if ( folderId.startsWith(VIRTUAL_FOLDER_PREFIX) ) {
    const state = getVirtualFolderState();
    const id = folderId.slice(VIRTUAL_FOLDER_PREFIX.length);
    delete state.folders[id];
    for ( const [uuid, assignedId] of Object.entries(state.assignments) ) {
      if ( assignedId === id ) delete state.assignments[uuid];
    }
    for ( const folder of Object.values(state.folders) ) {
      if ( folder.parentId === id ) folder.parentId = null;
    }
    await setVirtualFolderState(state);
    return;
  }

  const folder = game.folders.get(folderId);
  if ( folder ) await folder.delete();
}

/**
 * @param {string} journalUuid
 * @param {string|null} folderId
 * @param {string} typeKey
 */
async function assignJournalToCategoryFolder(journalUuid, folderId, typeKey) {
  const journal = await fromUuid(journalUuid);
  if ( journal?.documentName !== "JournalEntry" ) return;

  const codexType = codexTypeFromGroupKey(typeKey);
  const rootFolder = getCampaignCodexFolderSafe(codexType);
  const useOrganized = game.settings.get(TARGET_MODULE_ID, "useOrganizedFolders") !== false;

  if ( !folderId ) {
    if ( useOrganized && rootFolder ) {
      await journal.update({ folder: rootFolder.id });
      return;
    }
    const state = getVirtualFolderState();
    delete state.assignments[journalUuid];
    await setVirtualFolderState(state);
    return;
  }

  if ( folderId.startsWith(VIRTUAL_FOLDER_PREFIX) ) {
    const state = getVirtualFolderState();
    const virtualId = folderId.slice(VIRTUAL_FOLDER_PREFIX.length);
    if ( !state.folders[virtualId] ) return;
    state.assignments[journalUuid] = virtualId;
    await setVirtualFolderState(state);
    if ( useOrganized && rootFolder && journal.folder?.id !== rootFolder.id ) {
      await journal.update({ folder: rootFolder.id });
    }
    return;
  }

  if ( useOrganized ) {
    await journal.update({ folder: folderId });
    return;
  }

  const state = getVirtualFolderState();
  delete state.assignments[journalUuid];
  await setVirtualFolderState(state);
}

/**
 * @param {HTMLElement|null|undefined} element
 * @returns {string}
 */
function getTypeGroupKeyFromElement(element) {
  let current = element?.closest?.(".cc-hub-type-group");
  while ( current ) {
    const key = String(current.dataset?.groupKey || "").trim();
    if ( key.startsWith("type:") ) return key;
    current = current.parentElement?.closest?.(".cc-hub-type-group");
  }
  return "";
}

/**
 * @param {HTMLElement} target
 */
function resolveDropTarget(target) {
  const folderHeading = target.closest(".cc-hub-category-folder-heading[data-folder-id]");
  if ( folderHeading ) {
    return {
      folderId: String(folderHeading.dataset.folderId || "").trim() || null,
      typeKey: getTypeGroupKeyFromElement(folderHeading),
    };
  }

  const typeHeading = target.closest(".cc-hub-type-group-heading[data-type-group-key]");
  if ( typeHeading ) {
    return {
      folderId: null,
      typeKey: String(typeHeading.dataset.typeGroupKey || "").trim() || null,
    };
  }

  return null;
}

/**
 * @param {DragEvent} event
 */
function parseJournalUuidFromDragEvent(event) {
  try {
    const raw = event.dataTransfer?.getData("text/plain");
    if ( !raw ) return "";
    const data = JSON.parse(raw);
    if ( data?.type === "JournalEntry" && data.uuid ) return data.uuid;
    if ( data?.documentName === "JournalEntry" && data.uuid ) return data.uuid;
  }
  catch { /* ignore */ }
  return "";
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
export async function patchCodexHubFolders() {
  const [{ CampaignCodexHub }] = await Promise.all([
    import(campaignCodexUrl("scripts/campaign-codex-hub.js")),
  ]);

  if ( !CampaignCodexHub.PARTS?.main?.[PATCH_MARKER] ) {
    CampaignCodexHub.PARTS.main.template = "modules/jinxed-tweaks/templates/codex-hub.hbs";
    CampaignCodexHub.PARTS.main[PATCH_MARKER] = true;
  }

  if ( !CampaignCodexHub.DEFAULT_OPTIONS.dragDrop?.[0]?.[PATCH_MARKER] ) {
    CampaignCodexHub.DEFAULT_OPTIONS.dragDrop[0].dropSelector = [
      ".cc-hub-folder-group-heading[data-folder-id]",
      ".cc-hub-type-group-heading[data-type-group-key]",
    ].join(", ");
    CampaignCodexHub.DEFAULT_OPTIONS.dragDrop[0][PATCH_MARKER] = true;
  }

  const proto = CampaignCodexHub.prototype;

  patchPrototypeMethod(proto, "_prepareContext", (original) => async function jinxHubFoldersPrepareContext(options) {
    const context = await original.call(this, options);
    enrichTypeGroupsWithFolders(context);
    return context;
  }, `${PATCH_MARKER}PrepareContext`);

  patchPrototypeMethod(proto, "_getFolderGroupContextOptions", (original) => function jinxHubFoldersFolderContextOptions(target) {
    const options = original.call(this, target);
    if ( !game.user.isGM ) return options;

    const element = this._getContextElement?.(target) ?? (target?.dataset ? target : (target?.[0] || null));
    if ( !element?.classList?.contains?.("cc-hub-category-folder-heading") ) return options;

    const folderId = String(element.dataset?.folderId || "").trim();
    const typeKey = getTypeGroupKeyFromElement(element);
    if ( !folderId || !typeKey.startsWith("type:") ) return options;

    const hub = this;
    return [{
      name: game.i18n.localize("JINXED_TWEAKS.CodexHubFolders.CreateSubfolder"),
      icon: '<i class="fas fa-folder-plus"></i>',
      callback: async () => {
        await promptCreateCategoryFolder(typeKey, folderId);
        hub.invalidateDocumentIndex();
        await hub.render(false);
      },
    }, ...options, {
      name: game.i18n.localize("JINXED_TWEAKS.CodexHubFolders.RenameFolder"),
      icon: '<i class="fas fa-pen"></i>',
      callback: async () => {
        await promptRenameCategoryFolder(folderId);
        hub.invalidateDocumentIndex();
        await hub.render(false);
      },
    }, {
      name: game.i18n.localize("JINXED_TWEAKS.CodexHubFolders.DeleteFolder"),
      icon: '<i class="fas fa-trash"></i>',
      callback: async () => {
        await deleteCategoryFolder(folderId);
        hub.invalidateDocumentIndex();
        await hub.render(false);
      },
    }];
  }, `${PATCH_MARKER}FolderContext`);

  patchPrototypeMethod(proto, "_onFirstRender", (original) => async function jinxHubFoldersOnFirstRender(context, options) {
    await original.call(this, context, options);

    this._createContextMenu(() => [{
      name: game.i18n.localize("JINXED_TWEAKS.CodexHubFolders.CreateFolder"),
      icon: '<i class="fas fa-folder-plus"></i>',
      condition: () => game.user.isGM,
      callback: async (target) => {
        const element = target?.dataset ? target : (target?.[0] || target?.currentTarget || null);
        const typeKey = String(element?.dataset?.typeGroupKey || "").trim();
        if ( !typeKey.startsWith("type:") ) return;
        await promptCreateCategoryFolder(typeKey);
        this.invalidateDocumentIndex();
        await this.render(false);
      },
    }], ".cc-hub-type-group-heading[data-type-group-key]", {
      fixed: true,
      hookName: "getJinxCodexHubTypeFolderContextOptions",
      parentClassHooks: false,
    });
  }, `${PATCH_MARKER}OnFirstRender`);

  patchPrototypeMethod(proto, "_onRender", (original) => async function jinxHubFoldersOnRender(context, options) {
    await original.call(this, context, options);
    if ( this.element?.dataset?.jinxCodexFolderDrops ) return;
    this.element.dataset.jinxCodexFolderDrops = "1";

    this.element.addEventListener("dragover", (event) => {
      if ( !game.user.isGM ) return;
      const hubState = game.user.getFlag("campaign-codex", "hubState") || {};
      if ( hubState.groupMode && hubState.groupMode !== "type" ) return;
      if ( !resolveDropTarget(event.target) ) return;
      event.preventDefault();
      if ( event.dataTransfer ) event.dataTransfer.dropEffect = "move";
    });

    this.element.addEventListener("drop", async (event) => {
      if ( !game.user.isGM ) return;
      const hubState = game.user.getFlag("campaign-codex", "hubState") || {};
      if ( hubState.groupMode && hubState.groupMode !== "type" ) return;
      const dropTarget = resolveDropTarget(event.target);
      const journalUuid = parseJournalUuidFromDragEvent(event);
      if ( !dropTarget?.typeKey?.startsWith?.("type:") || !journalUuid ) return;
      event.preventDefault();
      event.stopPropagation();
      await assignJournalToCategoryFolder(journalUuid, dropTarget.folderId, dropTarget.typeKey);
      this.invalidateDocumentIndex();
      await this.render(false);
    });
  }, `${PATCH_MARKER}OnRender`);

  log("Campaign Codex hub category folders patched");
  return true;
}

export function registerCodexHubFolderSettings() {
  game.settings.register(MODULE_ID, SETTING_VIRTUAL_FOLDERS, {
    name: "Codex Hub Virtual Folders",
    scope: "world",
    config: false,
    type: Object,
    default: { folders: {}, assignments: {} },
  });
}
