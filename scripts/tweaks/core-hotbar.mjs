/**
 * Core hotbar — reveal the fade-hidden hotbar while dragging so macros/items/
 * actors/spells from the sidebar can be dropped onto slots.
 *
 * Plain :hover does not update under an active HTML5 drag in most browsers, so
 * we treat "pointer near the bottom" / "dragenter on #hotbar" as the reveal signal.
 */

const HOTBAR_ID = "hotbar";
const REVEAL_CLASS = "jinxed-drag-reveal";
const BODY_DRAG_CLASS = "jinxed-dragging";
/** Pixels from the bottom edge that count as hotbar hover during a drag. */
const BOTTOM_REVEAL_PX = 160;

function log(message, level="log") {
  console[level](`jinxed-tweaks | core-hotbar | ${message}`);
}

function getHotbar() {
  return document.getElementById(HOTBAR_ID);
}

function setRevealed(revealed) {
  const hotbar = getHotbar();
  if ( !hotbar ) return;
  hotbar.classList.toggle(REVEAL_CLASS, revealed);
}

function onDragStart() {
  document.body.classList.add(BODY_DRAG_CLASS);
}

function onDragOver(event) {
  if ( !document.body.classList.contains(BODY_DRAG_CLASS) ) return;
  const hotbar = getHotbar();
  if ( !hotbar ) return;

  const overHotbar = event.target instanceof Element && !!event.target.closest(`#${HOTBAR_ID}`);
  const nearBottom = event.clientY >= (window.innerHeight - BOTTOM_REVEAL_PX);
  setRevealed(overHotbar || nearBottom);
}

function onDragEnd() {
  document.body.classList.remove(BODY_DRAG_CLASS);
  setRevealed(false);
}

/**
 * Reveal faded hotbar during document drag-and-drop toward the bottom chrome.
 */
export function applyCoreHotbarTweaks() {
  document.addEventListener("dragstart", onDragStart, true);
  document.addEventListener("dragover", onDragOver, true);
  document.addEventListener("dragend", onDragEnd, true);
  document.addEventListener("drop", onDragEnd, true);

  log("Drag-reveal enabled for faded hotbar");
}
