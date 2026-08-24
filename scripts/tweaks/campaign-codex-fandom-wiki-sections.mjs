/**
 * Shared Fandom wiki section detection for import + dialog preview.
 */

import { parseFandomWikiUrl, wikiApiRequest } from "./campaign-codex-fandom-wiki-api.mjs";

/** @type {ReadonlySet<string>} */
/** Wiki meta sections skipped at import (references, galleries). Editorial filtering is left to the AI. */
export const SKIP_WIKI_SECTION_TITLES = new Set([
  "references",
  "external links",
  "see also",
  "gallery",
  "image gallery",
  "videos",
  "navigation",
  "notes and references",
  "further reading",
  "sources",
  "citations",
  "bibliography",
]);

/**
 * @param {string} line
 */
export function normalizeSectionTitle(line) {
  const div = document.createElement("div");
  div.innerHTML = String(line || "");
  return div.textContent.replace(/\s+/g, " ").trim().toLowerCase();
}

/**
 * @param {string} title
 */
export function isSkippedWikiSection(title) {
  return SKIP_WIKI_SECTION_TITLES.has(normalizeSectionTitle(title));
}

/**
 * @param {Array<{ level?: string, line?: string }>} sections
 */
export function getImportableH2Sections(sections) {
  return (sections || []).filter((section) => {
    return section.level === "2" && !isSkippedWikiSection(section.line);
  });
}

/**
 * @param {string} line
 */
export function formatWikiSectionLabel(line) {
  const div = document.createElement("div");
  div.innerHTML = String(line || "");
  return div.textContent.replace(/\s+/g, " ").trim();
}

/**
 * @param {string} url
 */
export async function previewWikiArticleSections(url) {
  const { apiUrl, pageTitle, origin } = parseFandomWikiUrl(url);
  const sectionsData = await wikiApiRequest(apiUrl, { action: "parse", page: pageTitle, prop: "sections" });
  const pageLabel = sectionsData?.parse?.title || pageTitle;
  const h2Sections = getImportableH2Sections(sectionsData?.parse?.sections || []);
  const titles = h2Sections.map((section) => formatWikiSectionLabel(section.line)).filter(Boolean);

  if ( !titles.length ) {
    const fullPageData = await wikiApiRequest(apiUrl, { action: "parse", page: pageTitle, prop: "text" });
    const fullPageHtml = fullPageData?.parse?.text?.["*"] || "";
    if ( fullPageHtml.includes("mw-parser-output") ) titles.push("Information");
  }

  return {
    pageTitle: pageLabel,
    origin,
    sectionCount: titles.length,
    sectionTitles: titles,
  };
}
