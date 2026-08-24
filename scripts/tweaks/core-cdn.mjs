/**
 * Core CDN — rewrite allowlisted media URLs to assets.jinx.gg *before* fetch/PIXI
 * load so browsers never follow a play→CDN 302 (Chromium CORS-redirect bug → grey maps).
 *
 * Allowlist must stay in sync with server/Caddyfile.
 * Tokens stay on origin (/Assets/Tokens/*).
 * Module *code* stays on origin; only media under modules is rewritten.
 * UK / throttled clients stay origin-only (no dual-host CDN storm).
 */

import {shouldPreferOriginMedia} from "./client-load-policy.mjs";

const MODULE_ID = "jinxed-tweaks";
const CDN_ORIGIN = "https://assets.jinx.gg";
/**
 * Temporary revive query for Worker Cache API entries poisoned by HEAD
 * responses (empty body cached under the GET key). Bump if edges are stale.
 * Safe: only appended on CDN media URLs; do not probe CDN with HEAD.
 */
const CDN_REVIVE = "20260802r3";

/**
 * Emergency switch: when true, allowlisted media is served from play.jinx.gg
 * instead of assets.jinx.gg for every client. Keep false so NA clients use CDN;
 * UK/throttle clients still get origin via shouldPreferOriginMedia().
 */
const FORCE_ORIGIN_MEDIA = false;

let loggedOriginOnly = false;

/** Full-tree prefixes (all file types except Tokens). */
const CDN_TREE_PREFIXES = [
  "/Assets",
  "/ddb-images"
];

/** Module media only (js/json/css stay on origin). */
const CDN_MODULE_PREFIXES = [
  "/modules/tomcartos-the-endless-horizon",
  "/modules/pirate-map-pack-six-artists",
  "/modules/fxmaster",
  "/modules/JB2A_DnD5e",
  "/modules/dice-so-nice",
  "/modules/vtta-tokenizer",
  "/modules/levels",
  "/modules/bossbar"
];

/** Visual media under modules (audio stays on origin — see AUDIO_EXT_RE). */
const MEDIA_EXT_RE = /\.(webp|png|jpe?g|gif|webm|mp4|svg|bmp|avif|apng)(?:$|\?)/i;
/** Audio is served from origin only (Sound / Dice So Nice fetch path). */
const AUDIO_EXT_RE = /\.(mp3|ogg|wav|flac|m4a)(?:$|\?)/i;

let installed = false;

function log(message, level="log") {
  console[level](`${MODULE_ID} | core-cdn | ${message}`);
}

/** Upgrade plain http:// for our own hosts to avoid mixed content. */
function upgradeInsecureJinxUrl(src) {
  if ( typeof src !== "string" || !src ) return src;
  if ( /^http:\/\/(?:www\.)?play\.jinx\.gg\//i.test(src)
    || /^http:\/\/assets\.jinx\.gg\//i.test(src) ) {
    return `https://${src.slice("http://".length)}`;
  }
  return src;
}

function isTokenPath(pathname) {
  return pathname === "/Assets/Tokens" || pathname.startsWith("/Assets/Tokens/");
}

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
 */
export function normalizeMalformedExternalUrl(src) {
  if ( typeof src !== "string" ) return src;
  const value = src.trim();
  const wrapped = value.match(/^https?:\/\/(?:www\.)?play\.jinx\.gg\/(https?)%3A\/(.+)$/i);
  if ( wrapped ) return `${wrapped[1].toLowerCase()}://${wrapped[2]}`;
  return value.replace(/^(https?):\/(?!\/)/i, (_, scheme) => `${scheme.toLowerCase()}://`);
}

function isJinxMediaHost(hostname="") {
  const host = String(hostname || "").toLowerCase();
  return host === "play.jinx.gg"
    || host === "www.play.jinx.gg"
    || host === "dm.jinx.gg"
    || host === "www.dm.jinx.gg"
    || host === "assets.jinx.gg"
    || host.endsWith(".assets.jinx.gg");
}

/**
 * Map stored media URLs (often absolute assets.jinx.gg / play.jinx.gg) back to a
 * Foundry FilePicker `current` path under Data/. Absolute https URLs otherwise
 * make FilePicker#_inferSourceAndTarget open at storage root.
 * @param {string} src
 * @returns {string}
 */
export function toFilePickerCurrent(src) {
  if ( typeof src !== "string" || !src.trim() ) return src;
  const value = normalizeMalformedExternalUrl(src.trim());
  if ( !/^https?:\/\//i.test(value) && !value.startsWith("//") ) {
    return value.replace(/[?#].*$/, "").replace(/^\/+/, "");
  }
  try {
    const url = new URL(value, "https://play.jinx.gg");
    if ( !isJinxMediaHost(url.hostname) ) return value;
    return pathnameForMatch(url.pathname).replace(/^\/+/, "");
  }
  catch {
    return src;
  }
}

function isCdnPath(pathname) {
  if ( !pathname || isTokenPath(pathname) || AUDIO_EXT_RE.test(pathname) ) return false;
  if ( CDN_TREE_PREFIXES.some(prefix => pathname === prefix || pathname.startsWith(`${prefix}/`)) ) {
    return true;
  }
  if ( !MEDIA_EXT_RE.test(pathname) ) return false;
  return CDN_MODULE_PREFIXES.some(prefix => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

/** Module i18n / code — must never be served from the CDN hostname. */
function isModuleCodePath(pathname) {
  if ( !pathname?.startsWith("/modules/") ) return false;
  if ( /\/(?:lang|languages)\//i.test(pathname) ) return true;
  return /\.(json|js|mjs|cjs|css|html?|map)$/i.test(pathname);
}

/**
 * Pin audio to the Foundry origin (relative path). Scene DB may already point
 * audio at assets.jinx.gg from an earlier bulk rewrite.
 * @param {string} src
 * @returns {string}
 */
function pinAudioToOrigin(src) {
  try {
    const url = new URL(src, "https://play.jinx.gg");
    if ( !AUDIO_EXT_RE.test(url.pathname) ) return src;
    return `${url.pathname}${url.search}${url.hash}`;
  }
  catch {
    return src;
  }
}

/**
 * Old Caddy rules 302'd whole modules (incl. lang JSON) to assets.jinx.gg.
 * Browsers may still have those redirects cached → Foundry sees non-200 and
 * logs "Unable to load requested localization file". Bust the cache key and
 * force origin for module code/i18n.
 * @param {string} src
 * @returns {string}
 */
function forceModuleCodeOrigin(src) {
  try {
    const onCdn = /^https?:\/\/assets\.jinx\.gg/i.test(src);
    const url = new URL(src, "https://play.jinx.gg");
    const path = pathnameForMatch(url.pathname);
    if ( !isModuleCodePath(path) ) return src;
    if ( onCdn ) {
      return `${path}?_jinxOrigin=1${url.hash || ""}`;
    }
    if ( !url.searchParams.has("_jinxOrigin") ) url.searchParams.set("_jinxOrigin", "1");
    // Prefer site-relative so we stay same-origin on play.jinx.gg
    if ( !/^https?:\/\//i.test(src) || /^https?:\/\/(www\.)?play\.jinx\.gg/i.test(src) ) {
      return `${url.pathname}${url.search}${url.hash}`;
    }
    return src;
  }
  catch {
    return src;
  }
}

function withCdnRevive(cdnUrl) {
  try {
    const url = new URL(cdnUrl);
    if ( url.searchParams.get("_r") === CDN_REVIVE ) return url.href;
    url.searchParams.set("_r", CDN_REVIVE);
    return url.href;
  }
  catch {
    return cdnUrl;
  }
}

/** @returns {boolean} */
function preferOriginMedia() {
  return FORCE_ORIGIN_MEDIA || shouldPreferOriginMedia();
}

function noteOriginOnlyOnce() {
  if ( loggedOriginOnly || !preferOriginMedia() ) return;
  loggedOriginOnly = true;
  const reason = FORCE_ORIGIN_MEDIA ? "FORCE_ORIGIN_MEDIA" : "UK/throttle";
  log(`origin-only (${reason})`);
}

/** Final URL for allowlisted media: origin (UK/throttle/emergency) or revived CDN. */
function mediaUrlForPath(pathname, search="", hash="") {
  const path = pathname.startsWith("/") ? pathname : `/${pathname}`;
  if ( preferOriginMedia() ) {
    noteOriginOnlyOnce();
    return `https://play.jinx.gg${path}?_jinxOrigin=1${hash || ""}`;
  }
  return withCdnRevive(`${CDN_ORIGIN}${path}${search || ""}${hash || ""}`);
}

export function rewriteToCdn(src) {
  if ( typeof src !== "string" || !src ) return src;
  src = normalizeMalformedExternalUrl(src);
  src = upgradeInsecureJinxUrl(src);
  if ( src.startsWith("data:") || src.startsWith("blob:") || src.startsWith("webkit") ) return src;

  try {
    const parsed = new URL(src, "https://play.jinx.gg");
    if ( parsed.searchParams.has("_jinxOrigin") ) return src;
    const path = pathnameForMatch(parsed.pathname);

    // Module code / i18n always origin (cache-busted away from poisoned 302s).
    if ( isModuleCodePath(path) || /^https?:\/\/assets\.jinx\.gg\/modules\//i.test(src) ) {
      return forceModuleCodeOrigin(src);
    }

    // Audio always origin — never CDN.
    if ( AUDIO_EXT_RE.test(src) || AUDIO_EXT_RE.test(path) ) return pinAudioToOrigin(src);

    if ( /^https?:\/\/assets\.jinx\.gg/i.test(src) ) {
      if ( !isCdnPath(path) ) return src;
      return mediaUrlForPath(parsed.pathname, "", parsed.hash);
    }

    if ( /^https?:\/\/(www\.)?play\.jinx\.gg/i.test(src) ) {
      if ( !isCdnPath(path) ) return src;
      return mediaUrlForPath(parsed.pathname, "", parsed.hash);
    }
    if ( /^https?:\/\//i.test(src) ) return src;

    // Absolute site path or Foundry relative path (PIXI basePath = origin).
    if ( !isCdnPath(path) ) return src;
    const url = new URL(src.startsWith("/") ? src : `/${src}`, "https://play.jinx.gg");
    return mediaUrlForPath(url.pathname, "", url.hash);
  }
  catch {
    return src;
  }
}

function isCdnUrl(src) {
  return typeof src === "string" && /^https?:\/\/assets\.jinx\.gg\//i.test(src);
}

function cdnToOriginBypass(src) {
  try {
    if ( !isCdnUrl(src) ) return src;
    const url = new URL(src);
    url.searchParams.set("_jinxOrigin", "1");
    return `https://play.jinx.gg${url.pathname}${url.search}${url.hash}`;
  }
  catch {
    return src;
  }
}

function withCorsOptions(options) {
  const next = options && typeof options === "object" ? {...options} : {};
  if ( next.cors == null ) next.cors = "anonymous";
  if ( next.crossOrigin == null ) next.crossOrigin = "anonymous";
  if ( next.crossorigin == null ) next.crossorigin = "anonymous";
  return next;
}

function wrapMethod(target, method, mutateArgs) {
  if ( !target || typeof target[method] !== "function" ) return false;
  if ( target[method].__jinxCdn ) return true;
  const original = target[method];
  const wrapped = function(...args) {
    mutateArgs(args, this);
    return original.apply(this, args);
  };
  wrapped.__jinxCdn = true;
  try {
    target[method] = wrapped;
    return true;
  }
  catch {
    try {
      Object.defineProperty(target, method, {
        configurable: true,
        writable: true,
        value: wrapped
      });
      return true;
    }
    catch {
      return false;
    }
  }
}

/**
 * Firefox logs "Invalid URI. Load of media resource failed" when audio/video
 * src is "", "null", "undefined", or whitespace. Prefer clearing the attribute.
 * @param {unknown} value
 * @returns {boolean}
 */
function isInvalidMediaSrc(value) {
  if ( value == null ) return true;
  if ( typeof value !== "string" ) return false;
  const v = value.trim();
  if ( !v ) return true;
  if ( v === "null" || v === "undefined" ) return true;
  if ( /^https?:\/\/\s*$/i.test(v) ) return true;
  return false;
}

function clearMediaSrc(el, desc) {
  try {
    el.removeAttribute("src");
  }
  catch {
    try {
      desc.set.call(el, "");
    }
    catch { /* ignore */ }
  }
}

function patchElementSrcCors(tag) {
  const Ctor = globalThis[tag];
  const proto = Ctor?.prototype;
  if ( !proto || proto.__jinxCdnCors ) return false;
  const desc = Object.getOwnPropertyDescriptor(proto, "src");
  if ( !desc?.set || !desc?.get ) return false;
  try {
    Object.defineProperty(proto, "src", {
      configurable: true,
      enumerable: desc.enumerable,
      get() {
        return desc.get.call(this);
      },
      set(value) {
        if ( isInvalidMediaSrc(value) ) {
          clearMediaSrc(this, desc);
          return;
        }
        // Drag ghosts must paint synchronously for setDragImage. Skip CDN/CORS
        // reloads here; createDragImage snapshots the already-decoded source.
        if ( this.parentElement?.id === "drag-preview" || this.closest?.("#drag-preview") ) {
          desc.set.call(this, value);
          return;
        }
        const next = rewriteToCdn(value);
        if ( isInvalidMediaSrc(next) ) {
          clearMediaSrc(this, desc);
          return;
        }
        if ( isCdnUrl(next) ) {
          try {
            // Re-assigning the same crossOrigin value can abort an in-flight /
            // cached decode and blank drag/thumbnail paints.
            if ( this.crossOrigin !== "anonymous" ) this.crossOrigin = "anonymous";
            this.addEventListener("error", () => {
              const current = desc.get.call(this);
              if ( current !== next ) return;
              desc.set.call(this, cdnToOriginBypass(next));
            }, {once: true});
          }
          catch { /* ignore */ }
        }
        desc.set.call(this, next);
      }
    });
    proto.__jinxCdnCors = true;
    return true;
  }
  catch {
    return false;
  }
}

/**
 * Rewrite CDN-bound URLs inside fetch() so PIXI loadImageBitmap / fetchResource
 * never hit a same-origin→CDN 302 (taints / fails CORS).
 */
function patchFetch() {
  let patched = 0;

  const wrapFetch = (owner, key="fetch") => {
    if ( !owner || typeof owner[key] !== "function" || owner[key].__jinxCdn ) return false;
    const original = owner[key].bind(owner);
    const wrapped = async function(input, init) {
      let cdnUrl = "";
      try {
        if ( typeof input === "string" ) {
          // Lang/code first (origin + cache-bust), then media → CDN.
          let next = forceModuleCodeOrigin(input);
          next = rewriteToCdn(next);
          if ( next !== input ) {
            const toCdn = isCdnUrl(next);
            input = next;
            if ( toCdn ) init = {...(init || {}), mode: "cors", credentials: "omit"};
          }
          if ( isCdnUrl(input) ) cdnUrl = input;
        }
        else if ( input instanceof Request ) {
          let next = forceModuleCodeOrigin(input.url);
          next = rewriteToCdn(next);
          if ( next !== input.url ) {
            const toCdn = isCdnUrl(next);
            input = new Request(next, input);
            if ( toCdn ) init = {...(init || {}), mode: "cors", credentials: "omit"};
          }
          if ( isCdnUrl(input.url) ) cdnUrl = input.url;
        }
      }
      catch { /* fall through */ }
      const response = await original(input, init);
      if ( !cdnUrl ) return response;

      // 404, or poisoned Worker cache (HTTP 200 + empty body).
      const emptyPoison = response?.ok && Number(response.headers.get("content-length") || -1) === 0;
      if ( response?.status !== 404 && !emptyPoison ) return response;

      const fallback = cdnToOriginBypass(cdnUrl);
      try {
        if ( input instanceof Request ) input = new Request(fallback, input);
        else input = fallback;
        init = {...(init || {}), mode: "cors", credentials: "same-origin"};
        return await original(input, init);
      }
      catch {
        return response;
      }
    };
    wrapped.__jinxCdn = true;
    try {
      owner[key] = wrapped;
      return true;
    }
    catch {
      try {
        Object.defineProperty(owner, key, {configurable: true, writable: true, value: wrapped});
        return true;
      }
      catch {
        return false;
      }
    }
  };

  if ( wrapFetch(globalThis) ) patched += 1;

  // PIXI uses settings.ADAPTER.fetch for createImageBitmap path.
  const adapter = globalThis.PIXI?.settings?.ADAPTER
    ?? globalThis.PIXI?.utils?.settings?.ADAPTER;
  if ( adapter && wrapFetch(adapter) ) patched += 1;

  return patched;
}

function patchPixiPreferences() {
  const Assets = globalThis.PIXI?.Assets;
  if ( !Assets ) return false;
  try {
    // Workers use an unpatched fetch(); play→CDN 302 inside a Worker fails CORS
    // and yields empty/grey scene textures. Force main-thread load + CORS.
    if ( typeof Assets.setPreferences === "function" ) {
      Assets.setPreferences({
        crossOrigin: "anonymous",
        preferWorkers: false
      });
      return true;
    }
  }
  catch { /* ignore */ }
  return false;
}

/**
 * Force loadTextures off workers (unpatched Worker fetch + 302 = grey maps).
 * Rewrite URLs on any exposed WorkerManager.loadImageBitmap as a backup.
 */
function patchWorkerManager() {
  let patched = 0;
  const parsers = [];
  try {
    const loader = globalThis.PIXI?.Assets?.loader;
    if ( Array.isArray(loader?._parsers) ) parsers.push(...loader._parsers);
    if ( Array.isArray(loader?.parsers) ) parsers.push(...loader.parsers);
  }
  catch { /* ignore */ }
  try {
    const list = globalThis.PIXI?.extensions?._managers
      ?? globalThis.PIXI?.extensions?.parsers;
    if ( Array.isArray(list) ) parsers.push(...list);
  }
  catch { /* ignore */ }

  for ( const p of parsers ) {
    if ( !p?.config || typeof p.load !== "function" ) continue;
    if ( !("preferWorkers" in p.config) && !("crossOrigin" in p.config) ) continue;
    if ( p.config.preferWorkers !== false ) {
      p.config.preferWorkers = false;
      patched += 1;
    }
    p.config.crossOrigin = "anonymous";
  }

  const WM = globalThis.PIXI?.WorkerManager;
  if ( WM && typeof WM.loadImageBitmap === "function"
    && wrapMethod(WM, "loadImageBitmap", args => {
      if ( typeof args[0] === "string" ) args[0] = rewriteToCdn(args[0]);
    }) ) patched += 1;

  return patched;
}

/**
 * Scene/Level documents keep the original media URL (often assets.jinx.gg).
 * We may fetch a rewritten URL (origin bypass / revive query). PIXI caches by
 * fetch URL, while getTexture(lt.src) looks up the document URL — mismatch
 * yields PIXI.Texture.EMPTY and an invisible map. Alias both keys.
 */
function aliasTextureCache(originalSrc, rewrittenSrc) {
  if ( !originalSrc || !rewrittenSrc || originalSrc === rewrittenSrc ) return;
  const Assets = globalThis.PIXI?.Assets;
  if ( !Assets?.cache?.set || !Assets.get ) return;
  try {
    const asset = Assets.get(rewrittenSrc);
    if ( !asset ) return;
    if ( !Assets.cache.has(originalSrc) ) Assets.cache.set(originalSrc, asset);
  }
  catch { /* ignore */ }
}

function wrapLoadTexture(target) {
  if ( !target || typeof target.loadTexture !== "function" || target.loadTexture.__jinxCdn ) {
    return Boolean(target?.loadTexture?.__jinxCdn);
  }
  const original = target.loadTexture;
  const wrapped = async function(src) {
    const rewritten = typeof src === "string" ? rewriteToCdn(src) : src;
    const asset = await original.call(this, rewritten);
    if ( typeof src === "string" && typeof rewritten === "string" ) {
      aliasTextureCache(src, rewritten);
    }
    return asset;
  };
  wrapped.__jinxCdn = true;
  try {
    target.loadTexture = wrapped;
    return true;
  }
  catch {
    try {
      Object.defineProperty(target, "loadTexture", {
        configurable: true, writable: true, value: wrapped
      });
      return true;
    }
    catch {
      return false;
    }
  }
}

function wrapGetCache(target) {
  if ( !target || typeof target.getCache !== "function" || target.getCache.__jinxCdn ) {
    return Boolean(target?.getCache?.__jinxCdn);
  }
  const original = target.getCache.bind(target);
  const wrapped = function(src) {
    let asset = original(src);
    if ( asset || typeof src !== "string" ) return asset;
    const rewritten = rewriteToCdn(src);
    if ( rewritten === src ) return null;
    asset = original(rewritten);
    if ( asset ) aliasTextureCache(src, rewritten);
    return asset;
  };
  wrapped.__jinxCdn = true;
  try {
    target.getCache = wrapped;
    return true;
  }
  catch {
    try {
      Object.defineProperty(target, "getCache", {
        configurable: true, writable: true, value: wrapped
      });
      return true;
    }
    catch {
      return false;
    }
  }
}

function patchGetTexture() {
  const canvas = globalThis.foundry?.canvas;
  if ( !canvas || typeof canvas.getTexture !== "function" || canvas.getTexture.__jinxCdn ) {
    return Boolean(canvas?.getTexture?.__jinxCdn);
  }
  const original = canvas.getTexture;
  const wrapped = function(src) {
    let tex = original(src);
    if ( tex || typeof src !== "string" || src.startsWith("#") ) return tex;
    const rewritten = rewriteToCdn(src);
    if ( rewritten === src ) return null;
    tex = original(rewritten);
    if ( tex ) aliasTextureCache(src, rewritten);
    return tex;
  };
  wrapped.__jinxCdn = true;
  try {
    canvas.getTexture = wrapped;
    return true;
  }
  catch {
    try {
      Object.defineProperty(canvas, "getTexture", {
        configurable: true, writable: true, value: wrapped
      });
      return true;
    }
    catch {
      return false;
    }
  }
}

function patchTextureLoaders() {
  let patched = 0;
  const TextureLoader = globalThis.foundry?.canvas?.TextureLoader;
  if ( !TextureLoader ) return 0;

  // Keep document URLs as load() keys; rewrite only inside loadTexture + alias.
  if ( wrapLoadTexture(TextureLoader.loader) ) patched += 1;
  if ( wrapLoadTexture(TextureLoader.prototype) ) patched += 1;
  if ( wrapGetCache(TextureLoader.loader) ) patched += 1;
  if ( wrapGetCache(TextureLoader.prototype) ) patched += 1;
  if ( patchGetTexture() ) patched += 1;

  // PIXI.Assets.load still rewrites the network URL; alias is handled above when
  // Foundry goes through TextureLoader. Direct Assets.load callers need rewrite.
  const PIXI = globalThis.PIXI;
  if ( PIXI?.Assets && wrapMethod(PIXI.Assets, "load", args => {
    const mapUrl = u => (typeof u === "string" ? rewriteToCdn(u) : u);
    if ( typeof args[0] === "string" ) args[0] = mapUrl(args[0]);
    else if ( Array.isArray(args[0]) ) args[0] = args[0].map(mapUrl);
  }) ) patched += 1;

  return patched;
}

/**
 * Actor/FilePicker drag previews call setDragImage immediately after assigning
 * img.src. CDN+CORS assignment is async even for cached URLs, so the ghost is
 * blank. Snapshot the already-decoded source image into a data URL instead.
 */
function patchDragDropCreateImage() {
  const patch = DragDrop => {
    if ( !DragDrop || typeof DragDrop.createDragImage !== "function" ) return false;
    if ( DragDrop.createDragImage.__jinxCdn ) return true;
    const original = DragDrop.createDragImage;
    const wrapped = function(img, width, height) {
      const div = original.call(this, img, width, height);
      const preview = div?.querySelector?.("img");
      if ( !preview || !img?.complete || !(img.naturalWidth > 0) ) return div;
      try {
        const canvas = document.createElement("canvas");
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        canvas.getContext("2d").drawImage(img, 0, 0);
        preview.removeAttribute("crossorigin");
        preview.src = canvas.toDataURL("image/png");
      }
      catch {
        // Tainted source: keep whatever createDragImage assigned.
      }
      return div;
    };
    wrapped.__jinxCdn = true;
    try {
      DragDrop.createDragImage = wrapped;
      return true;
    }
    catch {
      try {
        Object.defineProperty(DragDrop, "createDragImage", {
          configurable: true,
          writable: true,
          value: wrapped
        });
        return true;
      }
      catch {
        return false;
      }
    }
  };

  let patched = 0;
  const DragDrop = globalThis.foundry?.applications?.ux?.DragDrop;
  if ( patch(DragDrop) ) patched += 1;
  const impl = DragDrop?.implementation;
  if ( impl && impl !== DragDrop && patch(impl) ) patched += 1;
  return patched;
}

function patchHelpers() {
  let patched = 0;

  // foundry.utils.fetchResource is often frozen — skip assignment; fetch patch covers it.
  wrapMethod(foundry?.utils, "fetchResource", args => {
    if ( typeof args[0] === "string" ) {
      const next = rewriteToCdn(args[0]);
      args[0] = next;
      if ( isCdnUrl(next) ) {
        const opts = args[1] && typeof args[1] === "object" ? {...args[1]} : {};
        opts.mode = "cors";
        opts.credentials = "omit";
        args[1] = opts;
      }
    }
  });

  const AudioHelper = foundry?.audio?.AudioHelper ?? globalThis.AudioHelper;
  if ( AudioHelper ) {
    if ( wrapMethod(AudioHelper, "preloadSounds", args => {
      const map = args[0];
      if ( map && typeof map === "object" ) {
        for ( const [key, value] of Object.entries(map) ) {
          if ( typeof value === "string" ) map[key] = rewriteToCdn(value);
          else if ( value && typeof value === "object" && typeof value.src === "string" ) {
            value.src = rewriteToCdn(value.src);
          }
        }
      }
    }) ) patched += 1;

    if ( wrapMethod(AudioHelper.prototype ?? AudioHelper, "play", args => {
      const conf = args[0];
      if ( conf && typeof conf === "object" && typeof conf.src === "string" ) {
        conf.src = rewriteToCdn(conf.src);
      }
      else if ( typeof conf === "string" ) args[0] = rewriteToCdn(conf);
    }) ) patched += 1;
  }

  const VideoHelper = foundry?.helpers?.media?.VideoHelper
    ?? foundry?.canvas?.VideoHelper
    ?? globalThis.VideoHelper;
  if ( VideoHelper && wrapMethod(VideoHelper, "getSourceNode", args => {
    if ( typeof args[0] === "string" ) args[0] = rewriteToCdn(args[0]);
  }) ) patched += 1;

  const ImageHelper = foundry?.helpers?.media?.ImageHelper ?? globalThis.ImageHelper;
  if ( ImageHelper && wrapMethod(ImageHelper, "createThumbnail", args => {
    if ( typeof args[0] === "string" ) args[0] = rewriteToCdn(args[0]);
  }) ) patched += 1;

  return patched;
}

/**
 * Foundry FilePicker treats any http(s) current path as external and opens at
 * storage root. Scene/Level map fields often store assets.jinx.gg URLs — map
 * those back to relative Data paths before inference.
 */
function patchFilePickerCurrentPath() {
  const classes = new Set();
  const base = foundry?.applications?.apps?.FilePicker;
  if ( base ) classes.add(base);
  if ( base?.implementation ) classes.add(base.implementation);
  if ( globalThis.CONFIG?.ux?.FilePicker ) classes.add(CONFIG.ux.FilePicker);
  let patched = 0;
  for ( const Cls of classes ) {
    const proto = Cls?.prototype;
    if ( !proto || typeof proto._inferSourceAndTarget !== "function" ) continue;
    if ( proto._inferSourceAndTarget.isJinxedCdn ) continue;
    const original = proto._inferSourceAndTarget;
    function jinxedInferSourceAndTarget(target) {
      return original.call(this, toFilePickerCurrent(target));
    }
    jinxedInferSourceAndTarget.isJinxedCdn = true;
    proto._inferSourceAndTarget = jinxedInferSourceAndTarget;
    patched += 1;
  }
  return patched;
}

/**
 * Install CDN rewrite + CORS hooks. Safe to call multiple times.
 * Prefer calling at module evaluation so patches exist before scene texture loads.
 */
export function installCoreCdn() {
  let patched = 0;
  patched += patchFetch();
  if ( patchPixiPreferences() ) patched += 1;
  patched += patchWorkerManager();
  if ( patchElementSrcCors("HTMLImageElement") ) patched += 1;
  if ( patchElementSrcCors("HTMLVideoElement") ) patched += 1;
  if ( patchElementSrcCors("HTMLAudioElement") ) patched += 1;
  patched += patchDragDropCreateImage();
  patched += patchTextureLoaders();
  patched += patchHelpers();
  patched += patchFilePickerCurrentPath();

  if ( !installed ) {
    installed = true;
    if ( preferOriginMedia() ) {
      noteOriginOnlyOnce();
      log(`CDN rewrite + CORS active → origin-only (${patched} patch(es); workers off)`);
    }
    else {
      log(`CDN rewrite + CORS active → ${CDN_ORIGIN} (${patched} patch(es); workers off; Tokens + module code excluded)`);
    }
    // Late PIXI / TextureLoader readiness
    Hooks?.once?.("init", () => installCoreCdn());
    Hooks?.once?.("setup", () => installCoreCdn());
    Hooks?.once?.("canvasInit", () => installCoreCdn());
  }
  else if ( preferOriginMedia() ) {
    noteOriginOnlyOnce();
  }
  return patched;
}

/**
 * Registry entry — re-apply in case TextureLoader/PIXI were not ready at eval time.
 */
export function applyCoreCdnTweaks() {
  installCoreCdn();
}
