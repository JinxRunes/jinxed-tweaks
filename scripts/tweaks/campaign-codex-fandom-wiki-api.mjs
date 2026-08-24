/**
 * Shared Fandom / MediaWiki API helpers for Campaign Codex wiki import.
 */

/**
 * @param {string} title
 */
export function normalizeWikiTitle(title) {
  return decodeURIComponent(String(title || ""))
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/**
 * @param {string} input
 */
export function parseFandomWikiUrl(input) {
  let url;
  try {
    url = new URL(String(input || "").trim());
  }
  catch {
    throw new Error("Invalid URL.");
  }

  if ( !url.hostname.endsWith(".fandom.com") ) {
    throw new Error("URL must be a Fandom wiki article (for example, criticalrole.fandom.com/wiki/Page_Name).");
  }

  const match = url.pathname.match(/^\/wiki\/(.+)$/i);
  if ( !match ) {
    throw new Error("URL must point to a wiki article path (/wiki/Page_Title).");
  }

  const pageTitle = decodeURIComponent(match[1]);
  return {
    apiUrl: `${url.origin}/api.php`,
    origin: url.origin,
    pageTitle,
  };
}

/**
 * @param {string} apiUrl
 * @param {Record<string, string>} params
 */
export async function wikiApiRequest(apiUrl, params) {
  const url = new URL(apiUrl);
  for ( const [key, value] of Object.entries(params) ) {
    url.searchParams.set(key, value);
  }
  url.searchParams.set("format", "json");
  url.searchParams.set("origin", "*");

  const response = await fetch(url.toString());
  if ( !response.ok ) {
    throw new Error(`Wiki request failed (${response.status}).`);
  }

  const data = await response.json();
  if ( data.error ) {
    throw new Error(data.error.info || data.error.code || "Wiki request failed.");
  }
  return data;
}
