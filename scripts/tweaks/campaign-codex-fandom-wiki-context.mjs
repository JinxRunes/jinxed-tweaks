/**
 * Fandom wiki context search for OpenAI improvement passes.
 */

import { normalizeWikiTitle, wikiApiRequest } from "./campaign-codex-fandom-wiki-api.mjs";

const MODULE_ID = "jinxed-tweaks";
export const SETTING_WIKI_CONTEXT = "openaiWikiContextSearch";
const MAX_CONTEXT_ARTICLES = 6;
const MAX_EXCERPT_CHARS = 900;
const SKIP_TITLE_PREFIXES = /^(File|Category|Template|Help|User|Media|Wikipedia):/i;

/**
 * @param {string} message
 * @param {"log"|"warn"|"error"} [level]
 */
function log(message, level="log") {
  console[level](`${MODULE_ID} | fandom-wiki-context | ${message}`);
}

/**
 * @returns {boolean}
 */
export function isWikiContextSearchEnabled() {
  return game.settings.get(MODULE_ID, SETTING_WIKI_CONTEXT) !== false;
}

/**
 * @param {string} html
 * @param {string} wikiOrigin
 * @param {string} mainPageTitle
 */
export function extractLinkedWikiTitles(html, wikiOrigin, mainPageTitle) {
  const doc = new DOMParser().parseFromString(String(html || ""), "text/html");
  const titles = [];
  const seen = new Set();
  const mainKey = normalizeWikiTitle(mainPageTitle);

  for ( const anchor of doc.querySelectorAll("a[href]") ) {
    const href = anchor.getAttribute("href") || "";
    let title = "";

    try {
      if ( href.startsWith("/wiki/") ) {
        title = decodeURIComponent(href.slice(6).split("#")[0]);
      }
      else {
        const url = new URL(href, wikiOrigin);
        if ( url.origin === wikiOrigin && url.pathname.startsWith("/wiki/") ) {
          title = decodeURIComponent(url.pathname.slice(6).split("#")[0]);
        }
      }
    }
    catch {
      continue;
    }

    if ( !title || SKIP_TITLE_PREFIXES.test(title) ) continue;

    const key = normalizeWikiTitle(title);
    if ( !key || key === mainKey || seen.has(key) ) continue;

    seen.add(key);
    titles.push(title.replace(/_/g, " "));
  }

  return titles;
}

/**
 * @param {string} apiUrl
 * @param {string} pageTitle
 * @param {number} [limit]
 */
async function searchRelatedWikiArticles(apiUrl, pageTitle, limit=5) {
  const data = await wikiApiRequest(apiUrl, {
    action: "query",
    list: "search",
    srsearch: normalizeWikiTitle(pageTitle),
    srlimit: String(limit + 1),
  });

  const mainKey = normalizeWikiTitle(pageTitle);
  return (data?.query?.search || [])
    .map((result) => result.title)
    .filter((title) => normalizeWikiTitle(title) !== mainKey);
}

/**
 * @param {string} html
 */
function htmlToPlainExcerpt(html) {
  const doc = new DOMParser().parseFromString(String(html || ""), "text/html");
  const root = doc.querySelector(".mw-parser-output") || doc.body;
  root.querySelectorAll(
    "aside.portable-infobox, .navbox, .toc, sup.reference, .references, .mw-references-wrap, .mw-editsection"
  ).forEach((node) => node.remove());
  return root.textContent.replace(/\s+/g, " ").trim();
}

/**
 * @param {string} apiUrl
 * @param {string} pageTitle
 */
async function fetchWikiLeadExcerpt(apiUrl, pageTitle) {
  const data = await wikiApiRequest(apiUrl, {
    action: "parse",
    page: pageTitle,
    section: "0",
    prop: "text",
  });
  const html = data?.parse?.text?.["*"] || "";
  const text = htmlToPlainExcerpt(html);
  if ( !text ) return "";
  return text.length > MAX_EXCERPT_CHARS ? `${text.slice(0, MAX_EXCERPT_CHARS).trim()}…` : text;
}

/**
 * @param {string} html
 * @param {string} [entityName]
 */
export function detectWikiSourceFromHtml(html, entityName="") {
  const doc = new DOMParser().parseFromString(String(html || ""), "text/html");

  for ( const anchor of doc.querySelectorAll('a[href*=".fandom.com/wiki/"]') ) {
    try {
      const url = new URL(anchor.getAttribute("href") || "", window.location.href);
      if ( !url.hostname.endsWith(".fandom.com") ) continue;
      return {
        apiUrl: `${url.origin}/api.php`,
        origin: url.origin,
        pageTitle: String(entityName || "").trim().replace(/\s+/g, "_") || "Main_Page",
      };
    }
    catch {
      continue;
    }
  }

  return null;
}

/**
 * @param {{ apiUrl: string, origin: string, pageTitle: string, mainHtml: string }} options
 * @returns {Promise<Array<{ title: string, excerpt: string }>>}
 */
export async function fetchWikiImprovementContext(options) {
  if ( !isWikiContextSearchEnabled() ) return [];

  const { apiUrl, origin, pageTitle, mainHtml } = options;
  if ( !apiUrl || !pageTitle ) return [];

  const linkedTitles = extractLinkedWikiTitles(mainHtml, origin, pageTitle);
  let searchTitles = [];
  try {
    searchTitles = await searchRelatedWikiArticles(apiUrl, pageTitle);
  }
  catch ( error ) {
    log(`Wiki search failed: ${error?.message || error}`, "warn");
  }

  const chosen = [];
  const seen = new Set();
  const mainKey = normalizeWikiTitle(pageTitle);

  for ( const title of [...linkedTitles, ...searchTitles] ) {
    const key = normalizeWikiTitle(title);
    if ( !key || key === mainKey || seen.has(key) ) continue;
    seen.add(key);
    chosen.push(title);
    if ( chosen.length >= MAX_CONTEXT_ARTICLES ) break;
  }

  const articles = [];
  for ( const title of chosen ) {
    try {
      const excerpt = await fetchWikiLeadExcerpt(apiUrl, title);
      if ( excerpt ) articles.push({ title, excerpt });
    }
    catch ( error ) {
      log(`Excerpt fetch failed for "${title}": ${error?.message || error}`, "warn");
    }
  }

  log(`Loaded ${articles.length} related wiki article(s) for "${pageTitle}"`);
  return articles;
}
