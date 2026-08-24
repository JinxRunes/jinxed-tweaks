/**
 * Limit parallel texture/media fetches for clients that tend to trip ISP
 * anti-abuse (UK residential links flooding many HTTPS requests on join).
 *
 * Detection default: browser timezone in the UK set.
 * World setting loadThrottleMode: auto | always | off.
 * Same clients also get origin-only media via core-cdn.
 */

import {getLoadThrottleMode, shouldThrottle} from "./client-load-policy.mjs";

const MODULE_ID = "jinxed-tweaks";
const SETTING_KEY = "loadThrottleMode";
const TEXTURE_MAX_CONCURRENT = 4;
const FETCH_MAX_CONCURRENT = 6;

const MEDIA_EXT_RE = /\.(webp|png|jpe?g|gif|webm|mp4|svg|bmp|avif|apng)(?:$|\?)/i;

let installed = false;
let active = false;
let logged = false;
/** @type {InstanceType<typeof foundry.utils.Semaphore>|null} */
let fetchSemaphore = null;

function log(message, level="log") {
  console[level](`${MODULE_ID} | load-throttle | ${message}`);
}

/**
 * Register world setting (call from Hooks.once("init")).
 */
export function registerLoadThrottleSettings() {
  game.settings.register(MODULE_ID, SETTING_KEY, {
    name: "JINXED_TWEAKS.LoadThrottle.Name",
    hint: "JINXED_TWEAKS.LoadThrottle.Hint",
    scope: "world",
    config: true,
    type: String,
    choices: {
      auto: "JINXED_TWEAKS.LoadThrottle.Auto",
      always: "JINXED_TWEAKS.LoadThrottle.Always",
      off: "JINXED_TWEAKS.LoadThrottle.Off"
    },
    default: "auto",
    onChange: () => {
      active = shouldThrottle();
      if ( active ) ensureFetchSemaphore();
      log(`Mode changed → ${getLoadThrottleMode()} (active=${active})`);
    }
  });
}

export {shouldThrottle};

function ensureFetchSemaphore() {
  if ( fetchSemaphore ) return fetchSemaphore;
  const Semaphore = foundry?.utils?.Semaphore;
  if ( !Semaphore ) return null;
  fetchSemaphore = new Semaphore(FETCH_MAX_CONCURRENT);
  return fetchSemaphore;
}

/**
 * @param {string} url
 * @returns {boolean}
 */
function isThrottledMediaUrl(url) {
  if ( typeof url !== "string" || !url ) return false;
  if ( url.startsWith("data:") || url.startsWith("blob:") ) return false;
  try {
    const parsed = new URL(url, window.location.href);
    if ( !MEDIA_EXT_RE.test(parsed.pathname) && !MEDIA_EXT_RE.test(url) ) return false;

    const host = parsed.hostname.toLowerCase();
    if ( host === "assets.jinx.gg" || host.endsWith(".assets.jinx.gg") ) return true;

    const path = parsed.pathname;
    const sameOrigin = parsed.origin === window.location.origin
      || /^(www\.)?play\.jinx\.gg$/i.test(host);
    if ( !sameOrigin ) return false;

    return path.startsWith("/Assets/")
      || path.startsWith("/ddb-images/")
      || path.startsWith("/modules/");
  }
  catch {
    return MEDIA_EXT_RE.test(url);
  }
}

/**
 * @param {unknown} input
 * @returns {string}
 */
function urlFromFetchInput(input) {
  if ( typeof input === "string" ) return input;
  if ( input instanceof Request ) return input.url;
  try {
    return String(input?.url ?? "");
  }
  catch {
    return "";
  }
}

function applyCanvasTextureLimit(canvas) {
  if ( !canvas || !shouldThrottle() ) return;
  const opts = canvas.loadTexturesOptions ?? {expireCache: true, additionalSources: []};
  opts.maxConcurrent = TEXTURE_MAX_CONCURRENT;
  canvas.loadTexturesOptions = opts;
}

function wrapTextureLoaderLoad(target) {
  if ( !target || typeof target.load !== "function" || target.load.__jinxLoadThrottle ) {
    return Boolean(target?.load?.__jinxLoadThrottle);
  }
  const original = target.load.bind(target);
  const wrapped = function(sources, options={}) {
    const next = options && typeof options === "object" ? {...options} : {};
    if ( shouldThrottle() && (next.maxConcurrent == null || next.maxConcurrent <= 0) ) {
      next.maxConcurrent = TEXTURE_MAX_CONCURRENT;
    }
    return original(sources, next);
  };
  wrapped.__jinxLoadThrottle = true;
  try {
    target.load = wrapped;
    return true;
  }
  catch {
    try {
      Object.defineProperty(target, "load", {
        configurable: true, writable: true, value: wrapped
      });
      return true;
    }
    catch {
      return false;
    }
  }
}

function wrapFetch(owner, key="fetch") {
  if ( !owner || typeof owner[key] !== "function" || owner[key].__jinxLoadThrottle ) {
    return Boolean(owner?.[key]?.__jinxLoadThrottle);
  }
  const original = owner[key].bind(owner);
  const wrapped = async function(input, init) {
    if ( !shouldThrottle() ) return original(input, init);
    const url = urlFromFetchInput(input);
    if ( !isThrottledMediaUrl(url) ) return original(input, init);

    const sem = ensureFetchSemaphore();
    if ( !sem ) return original(input, init);
    return sem.add(() => original(input, init));
  };
  wrapped.__jinxLoadThrottle = true;
  // Preserve CDN marker if we wrap a CDN-patched fetch.
  if ( owner[key].__jinxCdn ) wrapped.__jinxCdn = true;
  try {
    owner[key] = wrapped;
    return true;
  }
  catch {
    try {
      Object.defineProperty(owner, key, {
        configurable: true, writable: true, value: wrapped
      });
      return true;
    }
    catch {
      return false;
    }
  }
}

function patchFetchThrottle() {
  let patched = 0;
  if ( wrapFetch(globalThis) ) patched += 1;
  const adapter = globalThis.PIXI?.settings?.ADAPTER
    ?? globalThis.PIXI?.utils?.settings?.ADAPTER;
  if ( adapter && wrapFetch(adapter) ) patched += 1;
  return patched;
}

function patchTextureLoaders() {
  let patched = 0;
  const TextureLoader = globalThis.foundry?.canvas?.TextureLoader;
  if ( !TextureLoader ) return 0;
  if ( wrapTextureLoaderLoad(TextureLoader.loader) ) patched += 1;
  if ( wrapTextureLoaderLoad(TextureLoader.prototype) ) patched += 1;
  return patched;
}

/**
 * Install throttle hooks/patches when the mode says we should.
 */
export function applyCoreLoadThrottleTweaks() {
  active = shouldThrottle();
  if ( !active ) {
    log("inactive (not UK / mode off)");
  }
  else {
    ensureFetchSemaphore();
    if ( !logged ) {
      logged = true;
      const reason = getLoadThrottleMode() === "always"
        ? "mode=always"
        : "UK timezone";
      log(`active (${reason}, maxConcurrent=${TEXTURE_MAX_CONCURRENT}, fetch=${FETCH_MAX_CONCURRENT})`);
    }
  }

  if ( installed ) {
    patchTextureLoaders();
    patchFetchThrottle();
    return;
  }
  installed = true;

  Hooks.on("canvasInit", canvas => {
    if ( shouldThrottle() ) applyCanvasTextureLimit(canvas);
  });

  patchTextureLoaders();
  patchFetchThrottle();

  Hooks.once("setup", () => {
    patchTextureLoaders();
    patchFetchThrottle();
  });
  Hooks.once("ready", () => {
    patchTextureLoaders();
    patchFetchThrottle();
    active = shouldThrottle();
    if ( active && !logged ) {
      logged = true;
      log(`active (UK timezone, maxConcurrent=${TEXTURE_MAX_CONCURRENT}, fetch=${FETCH_MAX_CONCURRENT})`);
    }
  });
}
