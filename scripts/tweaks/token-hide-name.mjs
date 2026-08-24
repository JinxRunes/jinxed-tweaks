/**
 * Token HUD — "Hide name" control between Hide and Assign Status Effects.
 *
 * Toggles Token displayName between Always Displayed and None. The toggle is
 * global per actor: every placed copy on every scene (plus the actor
 * prototype) shares the same Always ↔ None state.
 */

const MODULE_ID = "jinxed-tweaks";
const BUTTON_ATTR = "data-jinxed-hide-name";
const OLD_FLAG_KEY = "hideName";
const SCENE_BATCH = 40;
const ACTOR_BATCH = 50;

function log(message, level="log") {
  console[level](`jinxed-tweaks | token-hide-name | ${message}`);
}

/**
 * @returns {{NONE: number, ALWAYS: number}}
 */
function displayModes() {
  return CONST.TOKEN_DISPLAY_MODES ?? {NONE: 0, ALWAYS: 50};
}

/**
 * @param {TokenDocument|{displayName?: number}|null|undefined} doc
 * @returns {boolean}
 */
function isNameHidden(doc) {
  const {ALWAYS} = displayModes();
  return Number(doc?.displayName) !== ALWAYS;
}

/**
 * @template T
 * @param {T[]} items
 * @param {number} size
 * @returns {T[][]}
 */
function chunk(items, size) {
  const out = [];
  for ( let i = 0; i < items.length; i += size ) out.push(items.slice(i, i + size));
  return out;
}

/**
 * @param {number} mode
 * @returns {object}
 */
function displayNamePatch(mode) {
  return {
    displayName: mode,
    [`flags.${MODULE_ID}.-=${OLD_FLAG_KEY}`]: null
  };
}

/**
 * Apply displayName to every scene token for the given actor ids, plus
 * actor prototypes. Tokens with no actorId are updated only on the active scene.
 *
 * @param {object} opts
 * @param {Set<string>} opts.actorIds
 * @param {TokenDocument[]} opts.orphanDocs
 * @param {number} opts.mode
 */
async function applyDisplayNameGlobally({actorIds, orphanDocs, mode}) {
  const patch = displayNamePatch(mode);
  let tokenCount = 0;

  if ( orphanDocs.length && canvas.scene ) {
    const updates = orphanDocs.map(doc => ({_id: doc.id, ...patch}));
    await canvas.scene.updateEmbeddedDocuments("Token", updates);
    tokenCount += updates.length;
  }

  if ( actorIds.size ) {
    for ( const scene of game.scenes ) {
      const updates = [];
      for ( const token of scene.tokens ) {
        if ( !token.actorId || !actorIds.has(token.actorId) ) continue;
        if ( Number(token.displayName) === mode
          && token.getFlag?.(MODULE_ID, OLD_FLAG_KEY) == null ) continue;
        updates.push({_id: token.id, ...patch});
      }
      for ( const batch of chunk(updates, SCENE_BATCH) ) {
        await scene.updateEmbeddedDocuments("Token", batch);
        tokenCount += batch.length;
      }
    }

    const actorUpdates = [];
    for ( const actorId of actorIds ) {
      const actor = game.actors.get(actorId);
      if ( !actor?.prototypeToken ) continue;
      if ( Number(actor.prototypeToken.displayName) === mode ) continue;
      actorUpdates.push({
        _id: actorId,
        "prototypeToken.displayName": mode
      });
    }
    for ( const batch of chunk(actorUpdates, ACTOR_BATCH) ) {
      await Actor.updateDocuments(batch);
    }
  }

  return tokenCount;
}

/**
 * @param {TokenHUD} app
 * @param {HTMLElement} html
 */
function injectHideNameButton(app, html) {
  if ( !game.user.isGM ) return;
  const root = html instanceof HTMLElement ? html : html?.[0];
  if ( !root ) return;
  if ( root.querySelector(`[${BUTTON_ATTR}]`) ) return;

  const visibility = root.querySelector('button[data-action="visibility"]');
  const effects = root.querySelector('button[data-action="togglePalette"][data-palette="effects"]');
  if ( !visibility || !effects ) return;

  const hidden = isNameHidden(app.document);
  const label = game.i18n.localize(hidden
    ? "JINXED_TWEAKS.TokenHideName.Show"
    : "JINXED_TWEAKS.TokenHideName.Hide");

  const button = document.createElement("button");
  button.type = "button";
  button.className = `control-icon${hidden ? " active" : ""}`;
  button.setAttribute(BUTTON_ATTR, "true");
  button.dataset.tooltip = "";
  button.setAttribute("aria-label", label);
  button.innerHTML = `<i class="fa-solid fa-signature" inert></i>`;

  button.addEventListener("click", async event => {
    event.preventDefault();
    event.stopPropagation();
    await toggleHideName(app, button);
  });

  visibility.after(button);
}

/**
 * @param {TokenHUD} app
 * @param {HTMLButtonElement} button
 */
async function toggleHideName(app, button) {
  const layer = canvas.tokens;
  const docs = layer?.controlled?.length
    ? layer.controlled.map(t => t.document)
    : (app.document ? [app.document] : []);
  if ( !docs.length ) return;

  const {NONE, ALWAYS} = displayModes();
  const nextHidden = !isNameHidden(docs[0]);
  const nextMode = nextHidden ? NONE : ALWAYS;

  const actorIds = new Set();
  const orphanDocs = [];
  for ( const doc of docs ) {
    if ( doc.actorId ) actorIds.add(doc.actorId);
    else orphanDocs.push(doc);
  }

  const tokenCount = await applyDisplayNameGlobally({
    actorIds,
    orphanDocs,
    mode: nextMode
  });
  log(`Set displayName → ${nextHidden ? "None" : "Always"} on ${tokenCount} token(s)`
    + (actorIds.size ? ` (+ ${actorIds.size} actor prototype(s))` : ""));

  const label = game.i18n.localize(nextHidden
    ? "JINXED_TWEAKS.TokenHideName.Show"
    : "JINXED_TWEAKS.TokenHideName.Hide");
  button.classList.toggle("active", nextHidden);
  button.setAttribute("aria-label", label);
}

/**
 * Register Hide name Token HUD control.
 */
export function applyTokenHideNameTweaks() {
  Hooks.on("renderTokenHUD", (app, html) => injectHideNameButton(app, html));
  log("Hide name Token HUD control registered");
}
