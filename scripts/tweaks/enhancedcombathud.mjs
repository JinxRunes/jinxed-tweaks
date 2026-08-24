/**
 * Argon Combat HUD (enhancedcombathud) — spell browser / tooltip fixes.
 *
 * On Foundry V14, Argon injects large rich HTML into `#tooltip` (Popover).
 * Upstream `.ech-tooltip` uses `pointer-events: all`, and Foundry's UP clamp
 * parks tall panels on the trigger — fatal for dense grids (e.g. Staff of the
 * Magi) that reach the top of the viewport.
 *
 * Fix: never capture pointer; after activate, pick a corner/side anchor that
 * stays in-viewport and clears the spell; remeasure accordion width if needed.
 */

const MODULE_ID = "enhancedcombathud";
const CLEARANCE_PX = 16;
const VIEW_PAD = 12;

function log(message, level="log") {
  console[level](`jinxed-tweaks | enhancedcombathud | ${message}`);
}

/**
 * @param {{left:number,top:number,right:number,bottom:number}} a
 * @param {{left:number,top:number,right:number,bottom:number}} b
 */
function rectsOverlap(a, b) {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

/**
 * @param {{left:number,top:number,right:number,bottom:number}} a
 * @param {{left:number,top:number,right:number,bottom:number}} b
 */
function intersectionArea(a, b) {
  const left = Math.max(a.left, b.left);
  const top = Math.max(a.top, b.top);
  const right = Math.min(a.right, b.right);
  const bottom = Math.min(a.bottom, b.bottom);
  const w = right - left;
  const h = bottom - top;
  return (w > 0 && h > 0) ? w * h : 0;
}

/**
 * Build corner- and side-anchored placements relative to the spell rect.
 * Each candidate extends away from the icon from a specific anchor point.
 * Higher `prefer` = better for Argon (map is left of the spell grid).
 *
 * @param {DOMRect} t  trigger bounds
 * @param {number} w   tooltip width
 * @param {number} h   tooltip height
 * @param {number} gap clearance from the spell
 */
function buildAnchorCandidates(t, w, h, gap) {
  const midY = t.top + (t.height / 2) - (h / 2);
  const midX = t.left + (t.width / 2) - (w / 2);

  return [
    // Corners: tooltip grows away from the spell's corner
    { left: t.left - w - gap, top: t.top - h - gap, prefer: 6, id: "above-left" },
    { left: t.right + gap, top: t.top - h - gap, prefer: 3, id: "above-right" },
    { left: t.left - w - gap, top: t.bottom + gap, prefer: 5, id: "below-left" },
    { left: t.right + gap, top: t.bottom + gap, prefer: 2, id: "below-right" },

    // Sides: fully clear of the icon, flush / centered
    { left: t.left - w - gap, top: midY, prefer: 8, id: "left-mid" },
    { left: t.left - w - gap, top: t.top, prefer: 7, id: "left-top" },
    { left: t.left - w - gap, top: t.bottom - h, prefer: 7, id: "left-bottom" },
    { left: t.right + gap, top: midY, prefer: 2, id: "right-mid" },
    { left: t.right + gap, top: t.top, prefer: 1, id: "right-top" },
    { left: t.right + gap, top: t.bottom - h, prefer: 1, id: "right-bottom" },
    { left: midX, top: t.top - h - gap, prefer: 4, id: "above-mid" },
    { left: midX, top: t.bottom + gap, prefer: 4, id: "below-mid" }
  ];
}

/**
 * Pick the best in-viewport placement that does not cover the spell.
 * @param {HTMLElement} trigger
 */
function repositionArgonTooltip(trigger) {
  const tip = document.getElementById("tooltip");
  if ( !tip?.classList.contains("ech-tooltip-container") || !trigger ) return;

  tip.style.pointerEvents = "none";
  tip.style.margin = "0";
  tip.style.inset = "unset";

  const t = trigger.getBoundingClientRect();
  const w = tip.offsetWidth || tip.getBoundingClientRect().width;
  const h = tip.offsetHeight || tip.getBoundingClientRect().height;
  if ( !w || !h ) return;

  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const gap = CLEARANCE_PX;
  const pad = VIEW_PAD;

  // Inflated spell bounds — tooltip must not enter this box.
  const forbidden = {
    left: t.left - gap,
    top: t.top - gap,
    right: t.right + gap,
    bottom: t.bottom + gap
  };

  const candidates = buildAnchorCandidates(t, w, h, gap);
  let best = null;
  let bestScore = -Infinity;

  for ( const c of candidates ) {
    // Keep side-axis free: clamp only along the free axis so we do not slide
    // back onto the icon (e.g. above → clamp X only; left → clamp Y only).
    let left = c.left;
    let top = c.top;
    const isLeft = c.id.startsWith("left") || c.id.endsWith("-left");
    const isRight = c.id.startsWith("right") || c.id.endsWith("-right");
    const isAbove = c.id.startsWith("above");
    const isBelow = c.id.startsWith("below");

    if ( isLeft || isRight ) {
      top = Math.min(Math.max(pad, top), vh - h - pad);
    } else if ( isAbove || isBelow ) {
      left = Math.min(Math.max(pad, left), vw - w - pad);
    }

    // Must fully fit the viewport at this anchor.
    if ( left < pad || top < pad || left + w > vw - pad || top + h > vh - pad ) continue;

    const tipRect = { left, top, right: left + w, bottom: top + h };
    if ( rectsOverlap(tipRect, forbidden) ) continue;

    const drift = Math.hypot(left - c.left, top - c.top);
    const score = (c.prefer * 10_000) - drift;
    if ( score > bestScore ) {
      bestScore = score;
      best = { left, top, id: c.id };
    }
  }

  // Soft fallback: clamp into viewport and pick minimal overlap with the spell.
  if ( !best ) {
    for ( const c of candidates ) {
      const left = Math.min(Math.max(pad, c.left), Math.max(pad, vw - w - pad));
      const top = Math.min(Math.max(pad, c.top), Math.max(pad, vh - h - pad));
      const tipRect = { left, top, right: left + w, bottom: top + h };
      const overlap = intersectionArea(tipRect, forbidden);
      const offX = Math.max(0, pad - c.left) + Math.max(0, (c.left + w) - (vw - pad));
      const offY = Math.max(0, pad - c.top) + Math.max(0, (c.top + h) - (vh - pad));
      const score = (c.prefer * 100) - (overlap * 10) - offX - offY;
      if ( score > bestScore ) {
        bestScore = score;
        best = { left, top, id: `${c.id}-soft` };
      }
    }
  }

  if ( !best ) return;

  tip.style.top = `${Math.round(best.top)}px`;
  tip.style.left = `${Math.round(best.left)}px`;
  tip.style.right = "unset";
  tip.style.bottom = "unset";
  tip.style.transform = "none";
}

/**
 * Live scroll target for the open Argon tooltip (description first, then panel).
 * Upstream setScrollDelta exists but never assigns `_scrollableElement`.
 * @returns {HTMLElement|null}
 */
function getArgonTooltipScrollable() {
  const host = document.getElementById("tooltip");
  if ( !host?.classList.contains("ech-tooltip-container") ) return null;

  const description = host.querySelector(".ech-tooltip-description");
  if ( description && description.scrollHeight > description.clientHeight + 1 ) {
    return description;
  }

  const panel = host.querySelector(".ech-tooltip") || host;
  if ( panel.scrollHeight > panel.clientHeight + 1 ) return panel;

  // Still expose description so wheel can no-op cleanly when nothing overflows.
  return description || panel;
}

/**
 * Scroll the open Argon tooltip description/panel by deltaY.
 * @param {number} delta
 * @returns {boolean} true if scroll position changed
 */
function scrollArgonTooltip(delta) {
  const el = getArgonTooltipScrollable();
  if ( !el || !delta ) return false;
  const max = el.scrollHeight - el.clientHeight;
  if ( max <= 0 ) return false;
  const prev = el.scrollTop;
  el.scrollTop = Math.min(max, Math.max(0, prev + delta));
  return el.scrollTop !== prev;
}

/** Forward wheel to the open tooltip while hovering a spell; block canvas zoom when scrolling. */
function installArgonTooltipWheel() {
  if ( document.documentElement.dataset.jinxedArgonTooltipWheel ) return;
  document.documentElement.dataset.jinxedArgonTooltipWheel = "1";

  document.addEventListener("wheel", (event) => {
    if ( !ui.ARGON?._tooltip ) return;
    if ( scrollArgonTooltip(event.deltaY) ) {
      event.preventDefault();
      event.stopPropagation();
    }
  }, { passive: false, capture: true });
}

/**
 * Patch Argon tooltip + accordion prototypes exposed on CONFIG.ARGON.
 */
function patchArgonClasses() {
  const argon = CONFIG.ARGON;
  if ( !argon?.CORE?.Tooltip || !argon?.CORE?.ArgonComponent ) {
    log("CONFIG.ARGON not ready", "warn");
    return false;
  }

  const Tooltip = argon.CORE.Tooltip;
  const ArgonComponent = argon.CORE.ArgonComponent;
  const AccordionPanelCategory = argon.MAIN?.BUTTON_PANELS?.ACCORDION?.AccordionPanelCategory;

  if ( Tooltip.prototype.render?.isJinxedArgonTooltip ) return true;

  const originalActivateTooltipListeners = ArgonComponent.prototype.activateTooltipListeners;
  ArgonComponent.prototype.activateTooltipListeners = async function jinxedActivateTooltipListeners() {
    await originalActivateTooltipListeners.call(this);
    if ( !game.settings.get(MODULE_ID, "showTooltips") ) return;
    this.element.onmouseleave = this._onTooltipMouseLeave.bind(this);
  };

  // Upstream never sets this; CoreHud's wheel listener calls setScrollDelta.
  Tooltip.prototype.setScrollDelta = function jinxedSetScrollDelta(delta) {
    this._scrollableElement = getArgonTooltipScrollable();
    return scrollArgonTooltip(delta);
  };

  const originalTooltipRender = Tooltip.prototype.render;
  async function jinxedTooltipRender(...args) {
    const el = await originalTooltipRender.apply(this, args);

    if ( this.element ) this.element.style.pointerEvents = "none";
    this._scrollableElement = getArgonTooltipScrollable();

    const trigger = this._triggerElement;
    requestAnimationFrame(() => {
      repositionArgonTooltip(trigger);
      this._scrollableElement = getArgonTooltipScrollable();
      requestAnimationFrame(() => {
        repositionArgonTooltip(trigger);
        this._scrollableElement = getArgonTooltipScrollable();
      });
    });

    return el;
  }
  jinxedTooltipRender.isJinxedArgonTooltip = true;
  Tooltip.prototype.render = jinxedTooltipRender;

  if ( AccordionPanelCategory && !AccordionPanelCategory.prototype.toggle?.isJinxedArgonAccordion ) {
    const originalToggle = AccordionPanelCategory.prototype.toggle;
    function jinxedAccordionToggle(toggle, noTransition=false) {
      if ( toggle === undefined ) toggle = !this.visible;

      if ( toggle && (!this._realWidth || this._realWidth < 8) ) {
        const prevTransition = this.element.style.transition;
        this.element.style.transition = "none";
        this.element.style.width = "unset";
        void this.element.offsetWidth;
        this._realWidth = Math.max(
          this.element.offsetWidth,
          this.buttonContainer?.scrollWidth ?? 0,
          120
        );
        this.element.style.transition = prevTransition;
      }

      return originalToggle.call(this, toggle, noTransition);
    }
    jinxedAccordionToggle.isJinxedArgonAccordion = true;
    AccordionPanelCategory.prototype.toggle = jinxedAccordionToggle;
  }

  installArgonTooltipWheel();
  log("Argon corner-anchor tooltip + wheel-scroll + accordion patches applied");
  return true;
}

/**
 * Apply Argon Combat HUD tweaks.
 */
export function applyEnhancedCombatHudTweaks() {
  if ( !game.modules.get(MODULE_ID)?.active ) {
    log("Argon inactive; skip", "warn");
    return;
  }

  if ( !patchArgonClasses() ) {
    setTimeout(() => patchArgonClasses(), 0);
  }
}
