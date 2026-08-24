/**
 * Media URL helpers for FilePicker paths (shared by Campaign Codex and optional CDN layer).
 */

function pathnameForMatch(pathname) {
  try {
    return decodeURIComponent(pathname.replace(/\/{2,}/g, "/"));
  }
  catch {
    return pathname.replace(/\/{2,}/g, "/");
  }
}

/**
 * Repair external URLs imported with one slash, or already resolved by the
 * browser into a play.jinx.gg path such as `/https%3A/www.example.com/a.png`.
 * @param {string} src
 */
export function normalizeMalformedExternalUrl(src) {
  if ( typeof src !== "string" ) return src;
  const value = src.trim();
  const wrapped = value.match(/^https?:\/\/(?:www\.)?play\.jinx\.gg\/(https?)%3A\/(.+)$/i);
  if ( wrapped ) return `${wrapped[1].toLowerCase()}://${wrapped[2]}`;
  return value.replace(/^(https?):\/(?!\/)/i, (_, scheme) => `${scheme.toLowerCase()}://`);
}

/**
 * @param {string} hostname
 */
function isKnownMediaHost(hostname="") {
  const host = String(hostname || "").toLowerCase();
  if ( host === window.location.hostname.toLowerCase() ) return true;
  return host === "play.jinx.gg"
    || host === "www.play.jinx.gg"
    || host === "dm.jinx.gg"
    || host === "www.dm.jinx.gg"
    || host === "assets.jinx.gg"
    || host.endsWith(".assets.jinx.gg");
}

/**
 * Map stored absolute media URLs back to a Foundry FilePicker `current` path under Data/.
 * @param {string} src
 */
export function toFilePickerCurrent(src) {
  if ( typeof src !== "string" || !src.trim() ) return src;
  const value = normalizeMalformedExternalUrl(src.trim());
  if ( !/^https?:\/\//i.test(value) && !value.startsWith("//") ) {
    return value.replace(/[?#].*$/, "").replace(/^\/+/, "");
  }
  try {
    const url = new URL(value, window.location.origin);
    if ( !isKnownMediaHost(url.hostname) ) return value;
    return pathnameForMatch(url.pathname).replace(/^\/+/, "");
  }
  catch {
    return src;
  }
}
