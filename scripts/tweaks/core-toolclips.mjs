/**
 * Core toolclips — avoid Chromium `ERR_CACHE_OPERATION_NOT_SUPPORTED` on .webm.
 *
 * Foundry injects `<video src="toolclips/...">` into tooltips. Some Chromium
 * builds log a Cache API network error for those media loads even when the file
 * exists and plays. Rewrite src → data attribute, then hydrate via fetch
 * (`cache: "no-store"`) + blob URL so the Cache Storage path is skipped.
 */

function log(message, level="log") {
  console[level](`jinxed-tweaks | core-toolclips | ${message}`);
}

/**
 * @param {string} html
 * @returns {string}
 */
function rewriteToolclipHtml(html) {
  if ( typeof html !== "string" || !html.includes("toolclips/") ) return html;
  return html.replace(
    /<video(\s[^>]*?)src="([^"]*toolclips\/[^"]+)"([^>]*)>/gi,
    '<video$1data-jinxed-toolclip-src="$2" preload="none"$3>'
  );
}

/**
 * @param {ParentNode|null|undefined} root
 */
async function hydrateToolclipVideos(root) {
  if ( !root?.querySelectorAll ) return;
  for ( const video of root.querySelectorAll("video[data-jinxed-toolclip-src]") ) {
    const src = video.getAttribute("data-jinxed-toolclip-src");
    video.removeAttribute("data-jinxed-toolclip-src");
    if ( !src ) continue;
    try {
      const response = await fetch(src, {cache: "no-store"});
      if ( !response.ok ) {
        video.src = src;
        continue;
      }
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      video.src = objectUrl;
      video.addEventListener("emptied", () => URL.revokeObjectURL(objectUrl), {once: true});
      void video.play()?.catch(() => undefined);
    }
    catch (error) {
      log(`Toolclip hydrate failed (${src}): ${error?.message || error}`, "warn");
      video.src = src;
    }
  }
}

/**
 * Load toolclip videos without tripping Chromium's Cache Storage media error.
 */
export function applyCoreToolclipTweaks() {
  const TooltipManager = foundry.helpers.interaction.TooltipManager;
  if ( !TooltipManager?.prototype?.activate ) {
    log("TooltipManager.activate missing; skip", "warn");
    return;
  }
  if ( TooltipManager.prototype.activate.isJinxedToolclip ) return;

  const original = TooltipManager.prototype.activate;
  function jinxedTooltipActivate(element, options={}) {
    const opts = {...options};
    if ( typeof opts.html === "string" ) opts.html = rewriteToolclipHtml(opts.html);

    if ( element?.dataset?.tooltipHtml?.includes("toolclips/") ) {
      element.dataset.tooltipHtml = rewriteToolclipHtml(element.dataset.tooltipHtml);
    }

    const result = original.call(this, element, opts);
    void hydrateToolclipVideos(this.tooltip ?? document.getElementById("tooltip"));
    return result;
  }
  jinxedTooltipActivate.isJinxedToolclip = true;
  TooltipManager.prototype.activate = jinxedTooltipActivate;

  log("Toolclip videos hydrate via no-store fetch + blob URL");
}
