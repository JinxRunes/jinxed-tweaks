/**
 * Tidbits — smooth loading transitions + join-page backdrop.
 *
 * Keep the early HTML splash (`#jinxed-early-loader`) until Tidbits is opaque,
 * then hand off. Patch show/hide for timing; CSS keeps the screen opaque while
 * visible so Tidbits animation changes do not flash the map.
 */

const TARGET_MODULE_ID = "tidbits";
const FADE_MS = 650;
const EARLY_LOADER_ID = "jinxed-early-loader";
const TIDBITS_SCREEN_ID = "tidbits-loading-screen";

function log(message, level="log") {
  console[level](`jinxed-tweaks | tidbits | ${message}`);
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function nextPaint() {
  return new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
}

function loadingScreenIsVisible(tidbits) {
  const screen = tidbits?.loadingScreen ?? document.getElementById(TIDBITS_SCREEN_ID);
  return Boolean(screen && !screen.classList.contains("hidden"));
}

function shouldShowLoadingScreen() {
  try {
    const choice = game.settings.get(TARGET_MODULE_ID, "showLoadingScreen");
    if ( choice === "everyone" ) return true;
    if ( choice === "players" && !game.user.isGM ) return true;
    if ( choice === "gamemaster" && game.user.isGM ) return true;
  }
  catch {
    return false;
  }
  return false;
}

function getJoinBackgroundUrl() {
  try {
    const bg = game.world?.background;
    if ( !bg ) return "";
    if ( /^https?:\/\//i.test(bg) || bg.startsWith("//") ) return bg;
    return foundry.utils.getRoute(bg);
  }
  catch {
    return "";
  }
}

function tidbitsCoverVisible() {
  const screen = document.getElementById(TIDBITS_SCREEN_ID);
  return Boolean(screen && !screen.classList.contains("hidden")
    && getComputedStyle(screen).opacity !== "0");
}

function sidebarReady() {
  const sidebar = document.getElementById("sidebar");
  return Boolean(sidebar && sidebar.tagName !== "TEMPLATE" && sidebar.childElementCount > 0);
}

/**
 * @param {{force?: boolean}} [opts]
 */
function dismissEarlyLoader(opts={}) {
  const el = document.getElementById(EARLY_LOADER_ID);
  if ( !el || el.dataset.dismissing === "1" ) return;
  if ( !opts.force && !tidbitsCoverVisible() && !sidebarReady() ) return;
  if ( !opts.force && el.dataset.expectTidbits === "true" && !tidbitsCoverVisible() ) return;
  el.dataset.dismissing = "1";
  el.dataset.waitingForTidbits = "0";
  el.classList.add("is-done");
  el.setAttribute("aria-busy", "false");
  const remove = () => el.remove();
  el.addEventListener("transitionend", remove, {once: true});
  setTimeout(remove, 700);
}

async function populateTidbitContent(tidbits) {
  if ( !tidbits?.loadingScreenText ) return;
  try {
    const text = await foundry.applications.ux.TextEditor.implementation.enrichHTML(tidbits.get(true));
    tidbits.loadingScreenText.innerHTML = text;
  }
  catch (error) {
    log(`Could not populate startup tidbit: ${error?.message || error}`, "warn");
  }
}

function applyJoinBackgroundToTidbits(tidbits) {
  const url = getJoinBackgroundUrl();
  const screen = tidbits?.loadingScreen ?? document.getElementById(TIDBITS_SCREEN_ID);
  const bg = tidbits?.loadingScreenBackground ?? screen?.querySelector(".loading-screen-background");
  if ( !screen || !bg ) return;

  screen.classList.add("jinxed-join-bg-screen", "jinxed-tidbits-smooth");
  bg.classList.add("jinxed-join-bg", "clean");
  bg.classList.remove("radial");
  if ( url ) bg.style.backgroundImage = `url("${url}")`;
  else bg.style.backgroundImage = "";

  if ( tidbits?.loadingScreenContent ) tidbits.loadingScreenContent.style.marginLeft = "0";
  else {
    const content = screen.querySelector(".loading-screen-content");
    if ( content ) content.style.marginLeft = "0";
  }
}

function whenCanvasVisuallyReady() {
  if ( canvas?.ready && canvas.root?.visible ) return Promise.resolve();

  return new Promise(resolve => {
    const started = performance.now();
    // Keep this short — a long wait left users stuck on a cover.
    const maxMs = 8000;
    const tick = () => {
      if ( (canvas?.ready && canvas.root?.visible) || (performance.now() - started > maxMs) ) {
        resolve();
        return;
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

/**
 * Patch Tidbits show/hide for opaque handoff + deferred reveal.
 */
export function applyTidbitsTweaks() {
  const tidbits = ui.tidbits;
  if ( !tidbits ) {
    log("ui.tidbits missing; dismiss early loader", "warn");
    dismissEarlyLoader({force: true});
    return;
  }
  if ( tidbits._jinxedPatched ) return;
  tidbits._jinxedPatched = true;

  const originalShow = tidbits.showLoadingScreen.bind(tidbits);
  let shownAt = 0;
  let hideGeneration = 0;
  let displayGeneration = 0;

  const forceHideLoadingScreen = async reason => {
    const screen = tidbits.loadingScreen;
    if ( !screen ) return;

    const generation = ++hideGeneration;
    tidbits._jinxedHideGeneration = generation;
    tidbits._jinxedHiding = true;
    screen.classList.add("jinxed-tidbits-hiding");
    screen.style.opacity = "0";
    await delay(FADE_MS);
    if ( tidbits._jinxedHideGeneration !== generation ) return;

    screen.classList.add("hidden");
    screen.classList.remove("jinxed-tidbits-hiding");
    screen.style.opacity = "";
    if ( tidbits.loadingScreenText ) tidbits.loadingScreenText.innerHTML = "";
    tidbits._showingLoadingScreen = false;
    tidbits._fadingOut = false;
    tidbits._jinxedHideGeneration = 0;
    tidbits._jinxedHiding = false;
    log(`Forced stale loading overlay closed (${reason})`, "warn");
  };

  tidbits.showLoadingScreen = async function jinxedShowLoadingScreen(force=false) {
    if ( !shouldShowLoadingScreen() && !force ) return;

    const wasShowing = this._showingLoadingScreen;
    let display = displayGeneration;
    if ( !wasShowing || force ) {
      shownAt = performance.now();
      display = ++displayGeneration;
    }

    hideGeneration += 1;
    this._jinxedHideGeneration = 0;
    this._jinxedHiding = false;

    const earlyLoader = document.getElementById(EARLY_LOADER_ID);
    const handingOff = Boolean(earlyLoader && !earlyLoader.classList.contains("is-done"));
    const screen = this.loadingScreen;
    if ( screen && (!wasShowing || force) ) {
      screen.classList.add("jinxed-tidbits-smooth");
      screen.classList.remove("jinxed-tidbits-hiding");
      // Opaque immediately — never fade in over the map.
      screen.style.opacity = "1";
    }

    await originalShow(force);
    applyJoinBackgroundToTidbits(this);

    if ( !wasShowing || force ) {
      setTimeout(() => {
        if ( display !== displayGeneration || !loadingScreenIsVisible(this) ) return;
        forceHideLoadingScreen("30s watchdog");
      }, 30000);
    }

    if ( wasShowing && !force ) return;
    if ( !screen ) return;

    screen.classList.remove("hidden");
    screen.style.opacity = "1";
    await nextPaint();
    if ( handingOff ) dismissEarlyLoader({force: true});
  };

  tidbits.hideLoadingScreen = function jinxedHideLoadingScreen() {
    if ( !this._showingLoadingScreen ) return;
    if ( this._jinxedHiding ) return;

    const generation = ++hideGeneration;
    this._jinxedHideGeneration = generation;
    this._jinxedHiding = true;

    (async () => {
      try {
        await whenCanvasVisuallyReady();
        if ( generation !== hideGeneration ) return;

        const minMs = Math.max(0, (game.settings.get(TARGET_MODULE_ID, "loadingScreenMinimumDuration") || 4) * 1000);
        const elapsed = performance.now() - (shownAt || performance.now());
        if ( elapsed < minMs ) await delay(minMs - elapsed);
        if ( generation !== hideGeneration ) return;

        const screen = this.loadingScreen;
        if ( screen && !screen.classList.contains("hidden") ) {
          screen.classList.add("jinxed-tidbits-hiding");
          screen.style.opacity = "0";
          await delay(FADE_MS);
          if ( generation !== hideGeneration ) return;
          screen.classList.add("hidden");
          screen.classList.remove("jinxed-tidbits-hiding");
          screen.style.opacity = "";
          if ( this.loadingScreenText ) this.loadingScreenText.innerHTML = "";
        }

        this._showingLoadingScreen = false;
        this._fadingOut = false;
      }
      catch (error) {
        log(`Hide failed: ${error?.message || error}`, "error");
        this._showingLoadingScreen = false;
        this._fadingOut = false;
      }
      finally {
        if ( this._jinxedHideGeneration === generation ) {
          this._jinxedHideGeneration = 0;
          this._jinxedHiding = false;
        }
      }
    })();
  };

  Hooks.on("canvasTearDown", () => {
    if ( !shouldShowLoadingScreen() ) return;
    tidbits.showLoadingScreen();
  });

  Hooks.on("canvasReady", () => {
    const display = displayGeneration;
    if ( loadingScreenIsVisible(tidbits) && !tidbits._showingLoadingScreen ) {
      tidbits._showingLoadingScreen = true;
    }
    if ( tidbits._showingLoadingScreen ) tidbits.hideLoadingScreen();
    let minMs = 4000;
    try {
      minMs = Math.max(0, (game.settings.get(TARGET_MODULE_ID, "loadingScreenMinimumDuration") || 4) * 1000);
    }
    catch { /* default */ }
    setTimeout(() => {
      if ( display !== displayGeneration || !loadingScreenIsVisible(tidbits) ) return;
      forceHideLoadingScreen("canvasReady fallback");
    }, Math.max(8000, minMs + FADE_MS + 2000));
    queueMicrotask(() => {
      if ( tidbits._showingLoadingScreen || tidbits._jinxedHiding ) return;
      const early = document.getElementById(EARLY_LOADER_ID);
      if ( early?.dataset.expectTidbits === "true" && !tidbitsCoverVisible() ) return;
      dismissEarlyLoader();
    });
  });

  // Initial join: show Tidbits under early splash, then hand off.
  const earlyLoader = document.getElementById(EARLY_LOADER_ID);
  if ( earlyLoader && shouldShowLoadingScreen() ) {
    earlyLoader.dataset.waitingForTidbits = "1";
    tidbits.showLoadingScreen(true)
      .then(() => tidbits._loadingStatus)
      .then(() => populateTidbitContent(tidbits))
      .catch(error => {
        log(`Initial handoff failed: ${error?.message || error}`, "error");
        earlyLoader.dataset.waitingForTidbits = "0";
        dismissEarlyLoader({force: true});
      });
  }
  else if ( earlyLoader ) {
    dismissEarlyLoader({force: true});
  }

  // Remove any leftover experimental scene cover from prior deploys.
  document.getElementById("jinxed-scene-cover")?.remove();

  log("Smooth loading transitions enabled");
}
