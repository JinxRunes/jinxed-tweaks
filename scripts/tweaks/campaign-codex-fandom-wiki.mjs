/**
 * Campaign Codex — Fandom wiki importer.
 *
 * Adds an Info-tab import button on all Campaign Codex sheet types that imports
 * all wiki h2 sections from a Fandom article. Optional OpenAI pass reorganizes
 * and polishes formatting when an API key is configured.
 */

import {
  improveWikiHtml,
  isOpenAiWikiImproveOnImportEnabled,
} from "./openai.mjs";
import { parseFandomWikiUrl, wikiApiRequest } from "./campaign-codex-fandom-wiki-api.mjs";
import { promptFandomWikiImport } from "./campaign-codex-fandom-wiki-dialog.mjs";
import {
  getImportableH2Sections,
  normalizeSectionTitle,
} from "./campaign-codex-fandom-wiki-sections.mjs";

import {
  closeProseMirrorEditor,
  isProseMirrorEditorActive,
} from "./campaign-codex-prosemirror.mjs";

const TARGET_MODULE_ID = "campaign-codex";
const PATCH_MARKER = "__jinxFandomWiki";
const IMPORT_ACTION = "jinxImportFandomWiki";
const IMPORT_BUTTON_CLASS = "jinx-fandom-wiki-import";

const WIKI_CLEANUP_SELECTORS = [
  "sup.reference",
  ".mw-editsection",
  "ol.references",
  ".references",
  ".mw-references-wrap",
  ".mw-ext-cite-error",
  "span.error",
  "#toc",
  ".toc",
  ".navbox",
  ".mbox-small",
  ".noprint",
  ".mw-empty-elt",
  "figure",
  "picture",
  ".thumb",
  ".gallery",
  ".pi-image",
  ".pi-image-thumbnail",
  ".pi-image-collection",
  ".image-caption",
  ".infobox-image",
  'span[typeof="mw:File"]',
  "a.mw-file-description",
  "a.image",
  ".mw-file-element",
];

/**
 * @param {string} text
 */
function isArtistCreditText(text) {
  const normalized = String(text || "").replace(/\s+/g, " ").trim();
  if ( !normalized || normalized.length > 400 ) return false;
  if ( /\bby\s+[\w'’.-]+(?:\s+[\w'’.-]+)*\s+from\b/i.test(normalized) ) return true;
  if ( /^(?:art|image|portrait|symbol|map|illustration)\s+by\b/i.test(normalized) ) return true;
  if ( /\bby\b/i.test(normalized) && /\bp\.\s*\d+/i.test(normalized) ) return true;
  return false;
}

/**
 * @param {string} href
 */
function isWikiMediaHref(href) {
  return /\/images\/|\/wiki\/File:|static\.wikia\.nocookie\.net/i.test(href)
    || /\.(?:png|jpe?g|gif|webp|svg)(?:[?#/]|$)/i.test(href);
}

/**
 * @param {ParentNode} root
 */
function stripWikiImagesAndCredits(root) {
  root.querySelectorAll('span[typeof="mw:File"]').forEach((node) => node.remove());
  root.querySelectorAll("img, video, source[srcset], svg").forEach((node) => node.remove());

  root.querySelectorAll("a[href]").forEach((anchor) => {
    const href = anchor.getAttribute("href") || "";
    const text = anchor.textContent.replace(/\s+/g, "").trim();
    if ( isWikiMediaHref(href) && !text ) anchor.remove();
  });

  root.querySelectorAll("a.image, a.mw-file-description").forEach((anchor) => {
    if ( !anchor.textContent.replace(/\s+/g, "").trim() ) anchor.remove();
  });

  for ( const node of [...root.querySelectorAll("p, figcaption, small, .caption, .thumbcaption, li")]) {
    const text = node.textContent.replace(/\s+/g, " ").trim();
    if ( isArtistCreditText(text) ) node.remove();
  }
}

/**
 * @param {string} message
 * @param {"log"|"warn"|"error"} [level]
 */
function log(message, level="log") {
  console[level](`jinxed-tweaks | campaign-codex-fandom | ${message}`);
}

/**
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

const INFO_PANEL_SELECTORS = [
  '.tab-panel.info[data-tab="info"]',
  '.group-tab-panel.info[data-tab="info"]',
];

const IMPORT_BUTTON_HTML = `<i class="fas fa-book-open refresh-btn ${IMPORT_BUTTON_CLASS}" data-action="${IMPORT_ACTION}" title="Import from Fandom Wiki" data-tooltip="Import from Fandom Wiki" aria-label="Import from Fandom Wiki"></i>`;

/**
 * @param {import("modules/campaign-codex/scripts/sheets/base-sheet.js").CampaignCodexBaseSheet} sheet
 */
function shouldShowWikiImportButton(sheet) {
  if ( !game.user.isGM ) return false;
  if ( sheet._selectedSheet ) return false;
  if ( sheet.getSheetType?.() === "quest" ) return false;
  if ( sheet.element?.classList?.contains("quest-sheet") ) return false;
  return true;
}

/**
 * @param {HTMLElement|null|undefined} root
 */
function findInfoHeaderActions(root) {
  if ( !root ) return null;

  for ( const selector of INFO_PANEL_SELECTORS ) {
    const headerActions = root.querySelector(`${selector} .content-header .header-actions`);
    if ( headerActions ) return headerActions;
  }

  return root.querySelector(
    '.tab-panel.info .content-header .header-actions, .group-tab-panel.info .content-header .header-actions',
  );
}

/**
 * @param {import("modules/campaign-codex/scripts/sheets/base-sheet.js").CampaignCodexBaseSheet} sheet
 */
function ensureWikiImportButton(sheet) {
  if ( !shouldShowWikiImportButton(sheet) ) return;

  const headerActions = findInfoHeaderActions(sheet.element);
  if ( !headerActions ) return;

  if ( !headerActions.querySelector(`.${IMPORT_BUTTON_CLASS}`) ) {
    headerActions.insertAdjacentHTML("afterbegin", IMPORT_BUTTON_HTML);
  }
}

/**
 * @param {import("modules/campaign-codex/scripts/sheets/base-sheet.js").CampaignCodexBaseSheet} sheet
 */
function findInfoProseMirror(sheet) {
  const selectors = [
    '.tab-panel.info prose-mirror[data-cc-content-key="info"]',
    '.group-tab-panel.info prose-mirror[data-cc-content-key="info"]',
    'prose-mirror[data-cc-content-key="info"]',
    '.tab-panel.info prose-mirror.cc-prosemirror',
    '.group-tab-panel.info prose-mirror.cc-prosemirror',
  ];

  for ( const selector of selectors ) {
    const editor = sheet.element?.querySelector(selector);
    if ( editor ) return editor;
  }

  return null;
}

/**
 * @param {import("modules/campaign-codex/scripts/sheets/base-sheet.js").CampaignCodexBaseSheet} sheet
 */
function closeInfoProseMirrorEditor(sheet) {
  closeProseMirrorEditor(findInfoProseMirror(sheet));
}

/**
 * @param {import("modules/campaign-codex/scripts/sheets/base-sheet.js").CampaignCodexBaseSheet} sheet
 * @param {string} html
 */
async function applyCodexInfoHtml(sheet, html) {
  const { JournalContentHelper } = await importCampaignCodex("scripts/journal-content-helper.js");
  const editor = findInfoProseMirror(sheet);

  if ( isProseMirrorEditorActive(editor) ) {
    editor.value = html;
    closeProseMirrorEditor(editor);
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  else {
    closeInfoProseMirrorEditor(sheet);
  }

  await JournalContentHelper.set(sheet.document, JournalContentHelper.INFO_KEY, html);

  if ( sheet._processedData ) sheet._processedData = null;
  await sheet.render(true);

  const refreshedEditor = findInfoProseMirror(sheet);
  if ( refreshedEditor && "value" in refreshedEditor ) {
    refreshedEditor.value = html;
  }
}

/**
 * @param {ParentNode} root
 * @param {string} wikiOrigin
 */
function cleanWikiRoot(root, wikiOrigin) {
  for ( const selector of WIKI_CLEANUP_SELECTORS ) {
    root.querySelectorAll(selector).forEach((node) => node.remove());
  }

  stripWikiImagesAndCredits(root);

  root.querySelectorAll("a[href]").forEach((anchor) => {
    const href = anchor.getAttribute("href");
    if ( !href ) return;
    if ( href.startsWith("/wiki/") ) {
      anchor.setAttribute("href", `${wikiOrigin}${href}`);
    }
  });

  root.querySelectorAll("p").forEach((paragraph) => {
    const text = paragraph.textContent.replace(/\s+/g, " ").trim();
    if ( text.startsWith("Cite error:") ) {
      paragraph.remove();
      return;
    }
    if ( !text && !paragraph.querySelector("img, video") ) {
      paragraph.remove();
    }
  });
}

/**
 * @param {string} html
 * @param {string} wikiOrigin
 */
function cleanWikiHtml(html, wikiOrigin) {
  const doc = new DOMParser().parseFromString(String(html || ""), "text/html");
  const root = doc.querySelector(".mw-parser-output") || doc.body;
  cleanWikiRoot(root, wikiOrigin);
  return root.innerHTML.trim();
}

/**
 * @param {string} fullPageHtml
 * @param {string} wikiOrigin
 */
function extractInformationHtml(fullPageHtml, wikiOrigin) {
  const doc = new DOMParser().parseFromString(String(fullPageHtml || ""), "text/html");
  const parser = doc.querySelector(".mw-parser-output");
  if ( !parser ) return "";

  const output = doc.createElement("div");
  const infobox = parser.querySelector("aside.portable-infobox, .portable-infobox");
  if ( infobox ) {
    const clone = infobox.cloneNode(true);
    cleanWikiRoot(clone, wikiOrigin);
    output.appendChild(clone);
  }

  const lead = doc.createElement("div");
  let reachedContent = false;
  for ( const child of parser.children ) {
    if ( child.matches("aside.portable-infobox, .portable-infobox, #toc, .toc, p.mw-empty-elt") ) {
      continue;
    }
    if ( child.matches("h2") ) {
      reachedContent = true;
      break;
    }
    if ( child.matches("p") ) {
      lead.appendChild(child.cloneNode(true));
    }
  }

  if ( lead.childNodes.length ) {
    cleanWikiRoot(lead, wikiOrigin);
    if ( output.childNodes.length ) {
      output.appendChild(doc.createElement("hr"));
    }
    const heading = doc.createElement("h2");
    heading.textContent = "Information";
    output.appendChild(heading);
    while ( lead.firstChild ) {
      output.appendChild(lead.firstChild);
    }
  }
  else if ( output.childNodes.length && !reachedContent ) {
    const heading = doc.createElement("h2");
    heading.textContent = "Information";
    output.insertBefore(heading, output.firstChild);
  }

  return output.innerHTML.trim();
}

/**
 * @param {string} fullPageHtml
 * @param {string} wikiOrigin
 */
function extractInfoboxHtml(fullPageHtml, wikiOrigin) {
  const doc = new DOMParser().parseFromString(String(fullPageHtml || ""), "text/html");
  const parser = doc.querySelector(".mw-parser-output");
  const infobox = parser?.querySelector("aside.portable-infobox, .portable-infobox");
  if ( !infobox ) return "";

  const clone = infobox.cloneNode(true);
  cleanWikiRoot(clone, wikiOrigin);
  return clone.outerHTML.trim();
}

/**
 * @param {string} html
 * @param {string} infoboxHtml
 */
function prependInfobox(html, infoboxHtml) {
  const body = String(html || "").trim();
  const infobox = String(infoboxHtml || "").trim();
  if ( !infobox || body.includes("portable-infobox") ) return body;
  if ( !body ) return infobox;
  return `${infobox}<hr>${body}`;
}

/**
 * @param {string} apiUrl
 * @param {string} pageTitle
 * @param {string} sectionIndex
 */
async function fetchWikiSectionHtml(apiUrl, pageTitle, sectionIndex) {
  const data = await wikiApiRequest(apiUrl, {
    action: "parse",
    page: pageTitle,
    section: sectionIndex,
    prop: "text",
  });
  return data?.parse?.text?.["*"] || "";
}

/**
 * @param {string} url
 */
export async function importFandomWikiSections(url) {
  const { apiUrl, origin, pageTitle } = parseFandomWikiUrl(url);

  const [sectionsData, fullPageData] = await Promise.all([
    wikiApiRequest(apiUrl, { action: "parse", page: pageTitle, prop: "sections" }),
    wikiApiRequest(apiUrl, { action: "parse", page: pageTitle, prop: "text" }),
  ]);

  const pageLabel = sectionsData?.parse?.title || pageTitle;
  const h2Sections = getImportableH2Sections(sectionsData?.parse?.sections || []);
  const fullPageHtml = fullPageData?.parse?.text?.["*"] || "";
  const informationBlock = extractInformationHtml(fullPageHtml, origin);
  const infoboxHtml = extractInfoboxHtml(fullPageHtml, origin);
  const hasInformationHeading = h2Sections.some(
    (section) => normalizeSectionTitle(section.line) === "information",
  );

  const parts = [];

  if ( !h2Sections.length ) {
    if ( informationBlock ) parts.push(informationBlock);
  }
  else {
    if ( !hasInformationHeading && informationBlock ) {
      parts.push(informationBlock);
    }

    for ( const section of h2Sections ) {
      const raw = await fetchWikiSectionHtml(apiUrl, pageTitle, section.index);
      let html = cleanWikiHtml(raw, origin);
      if ( normalizeSectionTitle(section.line) === "information" ) {
        html = prependInfobox(html, infoboxHtml);
      }
      if ( html ) parts.push(html);
    }
  }

  if ( !parts.length ) {
    throw new Error(game.i18n.format("JINXED_TWEAKS.FandomWiki.NoImportableSections", { title: pageLabel }));
  }

  return {
    html: parts.join("<hr>"),
    pageTitle: pageLabel,
    sectionCount: parts.length,
  };
}

/**
 * @param {import("modules/campaign-codex/scripts/sheets/base-sheet.js").CampaignCodexBaseSheet} sheet
 * @param {string} html
 * @param {{ pageTitle?: string, wikiSource?: { apiUrl: string, origin: string, pageTitle: string }, improveWithAi?: boolean }} [context]
 */
async function maybeImproveImportedHtml(sheet, html, context={}) {
  if ( context.improveWithAi === false ) return html;
  if ( !isOpenAiWikiImproveOnImportEnabled() && context.improveWithAi !== true ) return html;

  const notification = ui.notifications?.info?.(
    game.i18n.localize("JINXED_TWEAKS.OpenAI.ImproveWritingProgress"),
    { permanent: true },
  );
  try {
    return await improveWikiHtml(html, {
      pageTitle: context.pageTitle,
      entityName: sheet.document.name,
      codexSheetType: sheet.getSheetType?.() || undefined,
      wikiSource: context.wikiSource,
      reorganize: true,
    });
  }
  finally {
    notification?.remove?.();
  }
}

/**
 * @param {import("modules/campaign-codex/scripts/sheets/base-sheet.js").CampaignCodexBaseSheet} sheet
 */
async function handleFandomWikiImport(sheet) {
  const options = await promptFandomWikiImport(sheet);
  if ( !options ) return;

  const notification = ui.notifications?.info?.(
    game.i18n.localize("JINXED_TWEAKS.FandomWiki.Importing"),
    { permanent: true },
  );
  try {
    const wikiSource = parseFandomWikiUrl(options.url);
    let { html, pageTitle } = await importFandomWikiSections(options.url);

    if ( options.importMode === "append" ) {
      const { JournalContentHelper } = await importCampaignCodex("scripts/journal-content-helper.js");
      const existing = JournalContentHelper.get(sheet.document, JournalContentHelper.INFO_KEY);
      if ( String(existing || "").trim() ) {
        html = `${existing}<hr>${html}`;
      }
    }

    html = await maybeImproveImportedHtml(sheet, html, {
      pageTitle,
      wikiSource,
      improveWithAi: options.improveWithAi,
    });
    await applyCodexInfoHtml(sheet, html);

    const enhanced = options.improveWithAi
      ? ` ${game.i18n.localize("JINXED_TWEAKS.FandomWiki.ImportEnhancedSuffix")}`
      : "";
    ui.notifications.info(game.i18n.format("JINXED_TWEAKS.FandomWiki.ImportSuccess", {
      title: pageTitle,
      enhanced,
    }));
  }
  catch ( error ) {
    const message = error?.message || String(error);
    log(`Import failed: ${message}`, "error");
    console.error(error);
    ui.notifications.error(game.i18n.format("JINXED_TWEAKS.FandomWiki.ImportFailed", { message }));
  }
  finally {
    notification?.remove?.();
  }
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
export async function patchFandomWikiImporter() {
  const [
    { CampaignCodexBaseSheet },
    { GroupSheet },
    { TagSheet },
  ] = await Promise.all([
    importCampaignCodex("scripts/sheets/base-sheet.js"),
    importCampaignCodex("scripts/sheets/group-sheet.js"),
    importCampaignCodex("scripts/sheets/tag-sheet.js"),
  ]);
  const BaseSheet = CampaignCodexBaseSheet;

  if ( !BaseSheet.DEFAULT_OPTIONS.actions[IMPORT_ACTION] ) {
    BaseSheet.DEFAULT_OPTIONS.actions[IMPORT_ACTION] = async function jinxImportFandomWiki(event) {
      event?.preventDefault?.();
      if ( !game.user.isGM ) return;
      await handleFandomWikiImport(this);
    };
  }

  patchPrototypeMethod(BaseSheet.prototype, "_onRender", (original) => async function jinxFandomWikiOnRender(context, options) {
    await original.call(this, context, options);
    ensureWikiImportButton(this);
  }, `${PATCH_MARKER}OnRender`);

  patchPrototypeMethod(BaseSheet.prototype, "_showTab", (original) => function jinxFandomWikiShowTab(tabName, html) {
    original.call(this, tabName, html);
    if ( tabName === "info" ) ensureWikiImportButton(this);
  }, `${PATCH_MARKER}ShowTab`);

  // Group (Regions) and Tag (Factions) override _showTab without calling super.
  for ( const SheetClass of [GroupSheet, TagSheet] ) {
    patchPrototypeMethod(SheetClass.prototype, "_showTab", (original) => function jinxFandomWikiGroupShowTab(tabName, html) {
      original.call(this, tabName, html);
      if ( tabName === "info" ) ensureWikiImportButton(this);
    }, `${PATCH_MARKER}ShowTab`);
  }

  log("Fandom wiki importer patched");
  return true;
}
