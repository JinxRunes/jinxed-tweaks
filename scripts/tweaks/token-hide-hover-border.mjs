/**
 * Hide the Token border square on hover and selection.
 *
 * Foundry shows Token#border when hovered, Alt-highlighted, or controlled.
 * Suppress it in all of those cases.
 */

import {
  afterTokenRefreshState,
  ensureTokenRefreshStateHub
} from "./token-refresh-state-hub.mjs";

function log(message, level="log") {
  console[level](`jinxed-tweaks | token-hide-hover-border | ${message}`);
}

/**
 * @this {Token}
 */
function hideTokenBorder() {
  if ( !this.border ) return;
  this.border.visible = false;
}

/**
 * Suppress Token border squares (hover, Alt-highlight, and selection).
 */
export function applyTokenHideHoverBorderTweaks() {
  ensureTokenRefreshStateHub();
  afterTokenRefreshState(hideTokenBorder);
  log("Token border squares suppressed");
}
