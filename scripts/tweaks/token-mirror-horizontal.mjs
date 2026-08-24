/**
 * Token HUD — Mirror Horizontally control under Hide Name.
 *
 * Toggles Token texture.scaleX sign (same as Token Config → Appearance →
 * Mirror → Horizontally).
 */

const MODULE_ID = "jinxed-tweaks";
const BUTTON_ATTR = "data-jinxed-mirror-x";
const HIDE_NAME_ATTR = "data-jinxed-hide-name";

function log(message, level="log") {
  console[level](`jinxed-tweaks | token-mirror-horizontal | ${message}`);
}

/**
 * @param {TokenDocument|{texture?: {scaleX?: number}}|null|undefined} doc
 * @returns {boolean}
 */
function isMirroredX(doc) {
  return Number(doc?.texture?.scaleX) < 0;
}

/**
 * @param {TokenDocument} doc
 * @param {boolean} mirrored
 * @returns {number}
 */
function nextScaleX(doc, mirrored) {
  const magnitude = Math.abs(Number(doc.texture?.scaleX) || 1);
  return magnitude * (mirrored ? -1 : 1);
}

/**
 * @param {foundry.applications.hud.TokenHUD} app
 * @param {HTMLElement} html
 */
function injectMirrorButton(app, html) {
  if ( !game.user.isGM ) return;
  const root = html instanceof HTMLElement ? html : html?.[0];
  if ( !root ) return;
  if ( root.querySelector(`[${BUTTON_ATTR}]`) ) return;

  const hideName = root.querySelector(`[${HIDE_NAME_ATTR}]`);
  const visibility = root.querySelector('button[data-action="visibility"]');
  const effects = root.querySelector('button[data-action="togglePalette"][data-palette="effects"]');
  const anchor = hideName || visibility;
  if ( !anchor || !effects ) return;

  const mirrored = isMirroredX(app.document);
  const label = game.i18n.localize("JINXED_TWEAKS.TokenMirrorHorizontal.Label");

  const button = document.createElement("button");
  button.type = "button";
  button.className = `control-icon${mirrored ? " active" : ""}`;
  button.setAttribute(BUTTON_ATTR, "true");
  button.dataset.tooltip = "";
  button.setAttribute("aria-label", label);
  button.innerHTML = `<i class="fa-solid fa-left-right" inert></i>`;

  button.addEventListener("click", async event => {
    event.preventDefault();
    event.stopPropagation();
    await toggleMirrorX(app, button);
  });

  anchor.after(button);
}

/**
 * @param {foundry.applications.hud.TokenHUD} app
 * @param {HTMLButtonElement} button
 */
async function toggleMirrorX(app, button) {
  const layer = canvas.tokens;
  const docs = layer?.controlled?.length
    ? layer.controlled.map(t => t.document)
    : (app.document ? [app.document] : []);
  if ( !docs.length ) return;

  const nextMirrored = !isMirroredX(docs[0]);
  const updates = docs.map(doc => ({
    _id: doc.id,
    "texture.scaleX": nextScaleX(doc, nextMirrored)
  }));
  await canvas.scene.updateEmbeddedDocuments("Token", updates);

  button.classList.toggle("active", nextMirrored);
}

/**
 * Register Mirror Horizontally Token HUD control under Hide Name.
 */
export function applyTokenMirrorHorizontalTweaks() {
  Hooks.on("renderTokenHUD", (app, html) => {
    // After Hide Name inject (same hook; microtask keeps order stable).
    queueMicrotask(() => injectMirrorButton(app, html));
  });
  log("Mirror Horizontally Token HUD control registered");
}
