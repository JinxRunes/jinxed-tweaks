/**
 * Temporary / targeted scene-load tracer.
 *
 * Arms only for configured user names (default: Martin2) or ?jinxLoadTrace=1.
 * Logs Foundry load stages, in-flight media fetches, and hang snapshots to the
 * client console and relays the same events to connected GMs over the module socket.
 */

const MODULE_ID = "jinxed-tweaks";
const SETTING_KEY = "loadTraceUsers";
const SOCKET_EVENT = `module.${MODULE_ID}`;
const HEARTBEAT_MS = 5_000;
const HANG_MS = 45_000;
const DEFAULT_USERS = "Martin2";

/** @type {Map<string, {url: string, started: number, kind: string}>} */
const inFlight = new Map();
/** @type {{t: number, stage: string, detail?: object}[]} */
const stages = [];
let sessionId = "";
let armed = false;
let hangTimer = null;
let heartbeatTimer = null;
let lastStage = "boot";
let canvasDrawStarted = 0;
let installed = false;

function log(message, level="log") {
  console[level](`${MODULE_ID} | load-trace | ${message}`);
}

function now() {
  return performance.now();
}

function elapsed() {
  return Math.round(now());
}

/**
 * @returns {string[]}
 */
function getTargetNames() {
  try {
    const raw = game.settings?.get?.(MODULE_ID, SETTING_KEY);
    if ( typeof raw === "string" ) {
      return raw.split(",").map(s => s.trim()).filter(Boolean);
    }
  }
  catch {
    /* settings not registered yet */
  }
  return DEFAULT_USERS.split(",").map(s => s.trim()).filter(Boolean);
}

/**
 * @returns {boolean}
 */
export function shouldTraceLoad() {
  try {
    if ( new URLSearchParams(window.location.search).get("jinxLoadTrace") === "1" ) return true;
  }
  catch { /* ignore */ }
  const name = game.user?.name;
  if ( !name ) return false;
  const targets = getTargetNames().map(n => n.toLocaleLowerCase("en-US"));
  if ( !targets.length ) return false;
  return targets.includes(String(name).toLocaleLowerCase("en-US"));
}

/**
 * Register world setting (call from Hooks.once("init")).
 */
export function registerLoadTraceSettings() {
  game.settings.register(MODULE_ID, SETTING_KEY, {
    name: "JINXED_TWEAKS.LoadTrace.Name",
    hint: "JINXED_TWEAKS.LoadTrace.Hint",
    scope: "world",
    config: true,
    type: String,
    default: DEFAULT_USERS
  });
}

/**
 * @param {string} stage
 * @param {object} [detail]
 */
function mark(stage, detail={}) {
  lastStage = stage;
  const entry = {t: elapsed(), stage, detail};
  stages.push(entry);
  const detailText = Object.keys(detail).length ? ` ${JSON.stringify(detail)}` : "";
  log(`[+${entry.t}ms] ${stage}${detailText}`);
  emit({type: "stage", stage, detail, t: entry.t});
}

function snapshot() {
  const pending = [...inFlight.values()]
    .sort((a, b) => a.started - b.started)
    .slice(0, 25)
    .map(item => ({
      kind: item.kind,
      url: truncateUrl(item.url),
      ageMs: Math.round(now() - item.started)
    }));
  return {
    sessionId,
    user: game.user?.name ?? null,
    userId: game.user?.id ?? null,
    scene: canvas?.scene?.name ?? game.scenes?.current?.name ?? null,
    sceneId: canvas?.scene?.id ?? game.scenes?.current?.id ?? null,
    lastStage,
    canvasLoading: Boolean(canvas?.loading),
    canvasReady: Boolean(canvas?.ready),
    throttle: (() => {
      try {
        return game.settings.get(MODULE_ID, "loadThrottleMode");
      }
      catch {
        return null;
      }
    })(),
    tz: (() => {
      try { return Intl.DateTimeFormat().resolvedOptions().timeZone; }
      catch { return null; }
    })(),
    pendingCount: inFlight.size,
    pending,
    stages: stages.slice(-40)
  };
}

/**
 * @param {string} url
 * @returns {string}
 */
function truncateUrl(url) {
  const s = String(url || "");
  return s.length > 180 ? `${s.slice(0, 177)}...` : s;
}

/**
 * @param {object} payload
 */
function emit(payload) {
  const body = {
    channel: "load-trace",
    sessionId,
    user: game.user?.name ?? null,
    userId: game.user?.id ?? null,
    ...payload
  };
  try {
    game.socket?.emit?.(SOCKET_EVENT, body);
  }
  catch (error) {
    log(`socket emit failed: ${error?.message || error}`, "warn");
  }
}

function startWatchdogs() {
  stopWatchdogs();
  canvasDrawStarted = now();
  heartbeatTimer = window.setInterval(() => {
    if ( !armed ) return;
    if ( canvas?.ready && !canvas?.loading ) {
      stopWatchdogs();
      return;
    }
    const snap = snapshot();
    log(`heartbeat last=${snap.lastStage} pending=${snap.pendingCount}`, "warn");
    emit({type: "heartbeat", snapshot: snap});
  }, HEARTBEAT_MS);

  hangTimer = window.setTimeout(() => {
    if ( canvas?.ready && !canvas?.loading ) return;
    const snap = snapshot();
    log(`HANG suspected after ${HANG_MS}ms — last=${snap.lastStage} pending=${snap.pendingCount}`, "error");
    console.error(`${MODULE_ID} | load-trace | hang snapshot`, snap);
    emit({type: "hang", snapshot: snap});
  }, HANG_MS);
}

function stopWatchdogs() {
  if ( heartbeatTimer ) {
    window.clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
  if ( hangTimer ) {
    window.clearTimeout(hangTimer);
    hangTimer = null;
  }
}

/**
 * @param {string} url
 * @param {string} kind
 * @returns {string}
 */
function trackStart(url, kind) {
  const id = `${kind}:${url}:${Math.random().toString(36).slice(2, 8)}`;
  inFlight.set(id, {url, kind, started: now()});
  return id;
}

/**
 * @param {string} id
 * @param {object} [extra]
 */
function trackEnd(id, extra={}) {
  const item = inFlight.get(id);
  inFlight.delete(id);
  if ( !item ) return;
  const ms = Math.round(now() - item.started);
  if ( ms >= 8_000 || extra.error ) {
    log(`${extra.error ? "FAIL" : "slow"} ${item.kind} ${ms}ms ${truncateUrl(item.url)}`, extra.error ? "error" : "warn");
    emit({
      type: extra.error ? "fetch-fail" : "fetch-slow",
      kind: item.kind,
      url: truncateUrl(item.url),
      ms,
      error: extra.error || null
    });
  }
}

function wrapFetch(owner, key="fetch") {
  if ( !owner || typeof owner[key] !== "function" || owner[key].__jinxLoadTrace ) {
    return Boolean(owner?.[key]?.__jinxLoadTrace);
  }
  const original = owner[key].bind(owner);
  const wrapped = async function(input, init) {
    if ( !armed ) return original(input, init);
    let url = "";
    try {
      url = typeof input === "string" ? input : (input?.url || String(input));
    }
    catch {
      url = "(unprintable)";
    }
    // Only track likely scene/media assets — avoid spamming every socket/API call.
    if ( !/\.(webp|png|jpe?g|gif|webm|mp4|svg|bmp|avif|ktx2|basis|json|mp3|ogg|wav)(?:$|\?)/i.test(url)
      && !/\/Assets\/|\/ddb-images\/|assets\.jinx\.gg|\/modules\//i.test(url) ) {
      return original(input, init);
    }
    const id = trackStart(url, "fetch");
    try {
      const response = await original(input, init);
      if ( !response?.ok ) trackEnd(id, {error: `HTTP ${response.status}`});
      else trackEnd(id);
      return response;
    }
    catch (error) {
      trackEnd(id, {error: error?.message || String(error)});
      throw error;
    }
  };
  wrapped.__jinxLoadTrace = true;
  if ( owner[key].__jinxCdn ) wrapped.__jinxCdn = true;
  if ( owner[key].__jinxLoadThrottle ) wrapped.__jinxLoadThrottle = true;
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
}

function wrapTextureLoader() {
  const TextureLoader = globalThis.foundry?.canvas?.TextureLoader;
  if ( !TextureLoader?.loadSceneTextures || TextureLoader.loadSceneTextures.__jinxLoadTrace ) return;
  const original = TextureLoader.loadSceneTextures.bind(TextureLoader);
  const wrapped = async function(sceneOrLevel, options={}) {
    if ( !armed ) return original(sceneOrLevel, options);
    mark("textures:start", {
      scene: sceneOrLevel?.name || sceneOrLevel?.parent?.name || null,
      maxConcurrent: options?.maxConcurrent ?? null
    });
    try {
      const result = await original(sceneOrLevel, options);
      mark("textures:done");
      return result;
    }
    catch (error) {
      mark("textures:fail", {error: error?.message || String(error)});
      throw error;
    }
  };
  wrapped.__jinxLoadTrace = true;
  TextureLoader.loadSceneTextures = wrapped;

  const loader = TextureLoader.loader;
  if ( loader && typeof loader.load === "function" && !loader.load.__jinxLoadTrace ) {
    const loadOriginal = loader.load.bind(loader);
    loader.load = async function(sources, opts={}) {
      if ( !armed ) return loadOriginal(sources, opts);
      const list = Array.from(sources || []).filter(Boolean);
      mark("textureLoader.load:start", {
        count: list.length,
        sample: list.slice(0, 8).map(truncateUrl),
        maxConcurrent: opts?.maxConcurrent ?? null
      });
      try {
        const result = await loadOriginal(sources, opts);
        mark("textureLoader.load:done", {count: list.length});
        return result;
      }
      catch (error) {
        mark("textureLoader.load:fail", {error: error?.message || String(error)});
        throw error;
      }
    };
    loader.load.__jinxLoadTrace = true;
  }
}

function wrapCanvasDraw() {
  const proto = globalThis.foundry?.canvas?.Canvas?.prototype
    ?? globalThis.CONFIG?.Canvas?.objectClass?.prototype;
  if ( !proto || typeof proto.draw !== "function" || proto.draw.__jinxLoadTrace ) return;
  const original = proto.draw;
  proto.draw = async function(...args) {
    if ( !armed ) return original.apply(this, args);
    mark("canvas.draw:start", {
      next: args[0]?.name || args[0]?.id || game.scenes?.current?.name || null
    });
    startWatchdogs();
    try {
      const result = await original.apply(this, args);
      mark("canvas.draw:done", {ready: Boolean(this.ready), loading: Boolean(this.loading)});
      if ( this.ready ) stopWatchdogs();
      return result;
    }
    catch (error) {
      mark("canvas.draw:fail", {error: error?.message || String(error)});
      emit({type: "hang", snapshot: snapshot()});
      throw error;
    }
  };
  proto.draw.__jinxLoadTrace = true;
}

function installErrorTraps() {
  window.addEventListener("error", event => {
    if ( !armed ) return;
    mark("window.error", {
      message: event?.message || String(event?.error || ""),
      file: event?.filename || null,
      line: event?.lineno || null
    });
  });
  window.addEventListener("unhandledrejection", event => {
    if ( !armed ) return;
    const reason = event?.reason;
    mark("unhandledrejection", {
      message: reason?.message || String(reason)
    });
  });
}

function bindGmRelay() {
  if ( !game.socket || game.socket.__jinxLoadTraceRelay ) return;
  game.socket.__jinxLoadTraceRelay = true;
  game.socket.on(SOCKET_EVENT, payload => {
    if ( !payload || payload.channel !== "load-trace" ) return;
    if ( !game.user?.isGM ) return;
    const who = payload.user || payload.userId || "?";
    if ( payload.type === "hang" ) {
      console.error(`${MODULE_ID} | load-trace | GM relay HANG from ${who}`, payload.snapshot);
      ui.notifications?.error?.(`Load-trace hang: ${who} stuck at ${payload.snapshot?.lastStage}`);
      return;
    }
    if ( payload.type === "heartbeat" ) {
      console.warn(`${MODULE_ID} | load-trace | GM relay heartbeat ${who}`, payload.snapshot);
      return;
    }
    console.log(`${MODULE_ID} | load-trace | GM relay`, payload);
  });
}

/**
 * Arm tracing for this client session.
 */
function arm() {
  if ( armed ) return;
  armed = true;
  sessionId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  stages.length = 0;
  inFlight.clear();
  mark("armed", {
    targets: getTargetNames(),
    user: game.user?.name ?? null,
    href: window.location.href
  });
  wrapFetch(globalThis);
  const adapter = globalThis.PIXI?.settings?.ADAPTER ?? globalThis.PIXI?.utils?.settings?.ADAPTER;
  if ( adapter ) wrapFetch(adapter);
  wrapTextureLoader();
  wrapCanvasDraw();
  installErrorTraps();
  emit({type: "armed", href: window.location.href});
}

function maybeArm(reason) {
  if ( !shouldTraceLoad() ) return false;
  if ( !armed ) {
    log(`Activating for user=${game.user?.name || "(unknown)"} (${reason})`);
    arm();
  }
  mark(reason);
  return true;
}

/**
 * Install hooks. Safe to call for all clients; only arms for targets / query flag.
 * GMs always get the socket relay so they can observe Martin2's beacons.
 */
export function applyCoreLoadTraceTweaks() {
  if ( installed ) return;
  installed = true;

  Hooks.once("setup", () => {
    bindGmRelay();
    maybeArm("hook:setup");
  });
  Hooks.once("ready", () => {
    bindGmRelay();
    maybeArm("hook:ready");
  });
  Hooks.on("canvasInit", canvas => {
    if ( !maybeArm("hook:canvasInit") ) return;
    mark("hook:canvasInit", {scene: canvas?.scene?.name || null});
    startWatchdogs();
  });
  Hooks.on("canvasDraw", canvas => {
    if ( !armed ) return;
    mark("hook:canvasDraw", {scene: canvas?.scene?.name || null, groups: Object.keys(CONFIG.Canvas?.groups || {})});
  });
  Hooks.on("canvasReady", canvas => {
    if ( !armed ) return;
    mark("hook:canvasReady", {
      scene: canvas?.scene?.name || null,
      drawMs: canvasDrawStarted ? Math.round(now() - canvasDrawStarted) : null
    });
    stopWatchdogs();
    emit({type: "complete", snapshot: snapshot()});
    log("Scene load completed", "log");
  });
  Hooks.on("canvasTearDown", () => {
    if ( !armed ) return;
    mark("hook:canvasTearDown");
  });

  // If this client is already the target during init apply, arm immediately.
  if ( shouldTraceLoad() ) {
    bindGmRelay();
    arm();
    mark("hook:init-apply");
  }
  else {
    log(`Idle (targets=${getTargetNames().join(",") || "(none)"}). GM relay will still listen.`);
    Hooks.once("ready", () => bindGmRelay());
  }
}
