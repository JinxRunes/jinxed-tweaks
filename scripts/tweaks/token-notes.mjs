/**
 * Token Notes — shared per character across every map copy.
 *
 * Canonical store is the world Actor (`flags.token-notes.notes`), resolved by
 * actorId first, then by unique Actor name (names are unique in this world).
 * actorLink and the upstream Token/Actor toggle are ignored for matched
 * characters so unlinked sidebar drops stay in sync.
 *
 * On save: write the Actor, then mirror notes onto every Scene token that
 * shares that actorId or name. Live updateActor refreshes an open notes panel.
 */

const MODULE_ID = "jinxed-tweaks";
const NOTES_MODULE = "token-notes";
const MIGRATE_SETTING = "tokenNotesGlobalSyncPass2";
const SCENE_BATCH = 40;

function log(message, level="log") {
  console[level](`jinxed-tweaks | token-notes | ${message}`);
}

/**
 * Register world migration flag (call from Hooks.once("init")).
 */
export function registerTokenNotesSettings() {
  game.settings.register(MODULE_ID, MIGRATE_SETTING, {
    scope: "world",
    config: false,
    type: Boolean,
    default: false
  });
}

/**
 * @returns {boolean}
 */
function isActiveGm() {
  return !!(game.user?.isGM && game.users.activeGM?.isSelf);
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
 * World Actor for a token: actorId first, then unique exact name match.
 * Never returns the synthetic unlinked token actor.
 * @param {Token|TokenDocument|null|undefined} tokenOrDoc
 * @returns {Actor|null}
 */
function resolveWorldActor(tokenOrDoc) {
  const doc = tokenOrDoc?.document ?? tokenOrDoc;
  if ( !doc ) return null;

  if ( doc.actorId ) {
    const byId = game.actors.get(doc.actorId);
    if ( byId ) return byId;
  }

  const name = String(doc.name ?? "").trim();
  if ( !name ) return null;
  const matches = game.actors.filter(a => a.name === name);
  if ( matches.length === 1 ) return matches[0];
  if ( matches.length > 1 ) {
    log(`Multiple world actors named "${name}"; using ${matches[0].id}`, "warn");
    return matches[0];
  }
  return null;
}

/**
 * Shared notes apply whenever a world Actor can be resolved.
 * @param {TokenDocument|null|undefined} doc
 * @returns {boolean}
 */
function shouldUseSharedNotes(doc) {
  return Boolean(resolveWorldActor(doc));
}

/**
 * @param {TokenDocument} token
 * @param {Actor} actor
 * @returns {boolean}
 */
function tokenMatchesActor(token, actor) {
  if ( !token || !actor ) return false;
  if ( token.actorId && token.actorId === actor.id ) return true;
  return String(token.name ?? "").trim() === actor.name;
}

/**
 * @param {foundry.abstract.Document|null|undefined} doc
 * @returns {boolean}
 */
function canUpdateDocument(doc) {
  if ( !doc?.id ) return false;
  const collection = doc.collection ?? doc.parent?.getEmbeddedCollection?.(doc.documentName);
  if ( collection && typeof collection.has === "function" ) return collection.has(doc.id);
  if ( doc.documentName === "Actor" ) return Boolean(game.actors?.get(doc.id));
  return true;
}

/**
 * @param {Actor} actor
 * @returns {string}
 */
function readActorNotes(actor) {
  const notes = actor?.getFlag?.(NOTES_MODULE, "notes");
  return typeof notes === "string" ? notes : "";
}

/**
 * Mirror notes + useActor:true onto every matching scene token.
 * @param {Actor} actor
 * @param {string} text
 */
async function propagateNotesToTokens(actor, text) {
  if ( !actor || !isActiveGm() ) return;
  let tokenCount = 0;

  for ( const scene of game.scenes ?? [] ) {
    const updates = [];
    for ( const token of scene.tokens ) {
      if ( !tokenMatchesActor(token, actor) ) continue;
      const cur = token.getFlag(NOTES_MODULE, "notes");
      const use = token.getFlag(NOTES_MODULE, "useActor");
      const patch = {_id: token.id};
      let dirty = false;
      if ( cur !== text ) {
        patch[`flags.${NOTES_MODULE}.notes`] = text;
        dirty = true;
      }
      if ( use !== true ) {
        patch[`flags.${NOTES_MODULE}.useActor`] = true;
        dirty = true;
      }
      if ( dirty ) updates.push(patch);
    }
    for ( const batch of chunk(updates, SCENE_BATCH) ) {
      await scene.updateEmbeddedDocuments("Token", batch);
      tokenCount += batch.length;
    }
  }

  if ( tokenCount ) log(`Mirrored notes for ${actor.name} onto ${tokenCount} token(s)`);
}

/**
 * Write shared notes to the world Actor and every matching token.
 * @param {Actor} actor
 * @param {string} text
 */
async function writeSharedNotes(actor, text) {
  if ( !actor || !canUpdateDocument(actor) ) return;
  const next = typeof text === "string" ? text : "";
  if ( readActorNotes(actor) !== next ) {
    await actor.setFlag(NOTES_MODULE, "notes", next);
  }
  await propagateNotesToTokens(actor, next);
}

/**
 * @param {object} app
 * @returns {Promise<void>|void}
 */
function saveNotesSafe(app) {
  const text = app?.textarea?.value;
  if ( typeof text !== "string" ) return;

  const token = app.object;
  const doc = token?.document;
  if ( !doc ) return;

  const actor = resolveWorldActor(token);
  if ( actor ) return writeSharedNotes(actor, text);

  if ( !canUpdateDocument(doc) ) return;
  return doc.setFlag(NOTES_MODULE, "notes", text);
}

/**
 * Pick the newest non-empty notes among actor + matching tokens.
 * @param {Actor} actor
 * @returns {{text: string, time: number}|null}
 */
function bestNotesCandidate(actor) {
  /** @type {{text: string, time: number}[]} */
  const candidates = [];
  const actorNotes = readActorNotes(actor);
  if ( actorNotes.length ) {
    candidates.push({
      text: actorNotes,
      time: Number(actor._stats?.modifiedTime ?? 0)
    });
  }

  for ( const scene of game.scenes ?? [] ) {
    for ( const token of scene.tokens ) {
      if ( !tokenMatchesActor(token, actor) ) continue;
      const notes = token.getFlag(NOTES_MODULE, "notes");
      if ( typeof notes !== "string" || !notes.length ) continue;
      candidates.push({
        text: notes,
        time: Number(token._stats?.modifiedTime ?? 0)
      });
    }
  }

  if ( !candidates.length ) return null;
  candidates.sort((a, b) => {
    if ( b.time !== a.time ) return b.time - a.time;
    return b.text.length - a.text.length;
  });
  return candidates[0];
}

/**
 * One-shot: unify notes for every world actor that has matching tokens.
 */
async function migrateGlobalSharedNotes() {
  if ( !isActiveGm() ) return;
  if ( game.settings.get(MODULE_ID, MIGRATE_SETTING) ) return;

  let actorsUpdated = 0;
  for ( const actor of game.actors ?? [] ) {
    const best = bestNotesCandidate(actor);
    if ( !best ) {
      // Still force useActor true on empty matching tokens so future saves share.
      await propagateNotesToTokens(actor, "");
      continue;
    }
    const current = readActorNotes(actor);
    if ( current !== best.text ) {
      await actor.setFlag(NOTES_MODULE, "notes", best.text);
      actorsUpdated += 1;
    }
    await propagateNotesToTokens(actor, best.text);
  }

  await game.settings.set(MODULE_ID, MIGRATE_SETTING, true);
  log(actorsUpdated
    ? `Global notes sync pass: updated ${actorsUpdated} actor(s)`
    : "Global notes sync pass: actors already unified");
}

/**
 * Force upstream #useActor to shared mode without the click-handler pre-save.
 * @param {object} app
 * @param {Token} token
 */
async function ensureSharedNotesMode(app, token) {
  if ( !app || !token?.document ) return;
  if ( !shouldUseSharedNotes(token.document) ) return;
  if ( typeof app._toggleTokenActor !== "function" ) return;

  let flips = 0;
  while ( !app.useActor && flips < 2 ) {
    await app._toggleTokenActor();
    flips += 1;
  }

  if ( token.document.getFlag(NOTES_MODULE, "useActor") !== true ) {
    try {
      await token.document.setFlag(NOTES_MODULE, "useActor", true);
    }
    catch (error) {
      log(`Could not persist useActor flag: ${error?.message || error}`, "warn");
    }
  }
}

/**
 * @param {Function} wrapped
 * @param {Token|null} object
 */
function bindGuard(wrapped, object) {
  if ( !object && this.object?.document ) {
    try {
      const pending = saveNotesSafe(this);
      if ( pending && typeof pending.catch === "function" ) {
        pending.catch(error => log(`Pre-release save failed: ${error?.message || error}`, "warn"));
      }
    }
    catch (error) {
      log(`Pre-release save failed: ${error?.message || error}`, "warn");
    }
  }

  const result = wrapped.call(this, object);
  if ( object ) {
    Promise.resolve()
      .then(async () => {
        await ensureSharedNotesMode(this, object);
        // Ensure textarea shows shared notes after mode flip.
        const actor = resolveWorldActor(object);
        if ( actor && this.textarea ) {
          const notes = readActorNotes(actor);
          if ( this.textarea.value !== notes ) {
            this.textarea.value = notes;
            try { this._generateReadArea?.(); } catch { /* ignore */ }
          }
        }
      })
      .catch(error => log(`Shared notes mode failed: ${error?.message || error}`, "error"));
  }
  return result;
}

/**
 * @param {Function} wrapped
 */
function saveGuard(wrapped) {
  const token = this.object;
  const doc = token?.document;
  if ( !doc ) return;

  const actor = resolveWorldActor(token);
  if ( actor && this.textarea ) {
    return writeSharedNotes(actor, this.textarea.value);
  }
  if ( !canUpdateDocument(doc) ) return;
  return wrapped.call(this);
}

/**
 * @param {Function} wrapped
 * @param {...any} args
 */
function onRenderGuard(wrapped, ...args) {
  const result = wrapped.apply(this, args);
  const token = this.object;
  const doc = token?.document;
  if ( !doc || !this.textarea ) return result;

  const actor = resolveWorldActor(token);
  if ( !actor ) return result;

  const notes = readActorNotes(actor);
  if ( this.textarea.value !== notes ) {
    this.textarea.value = notes;
    try { this._generateReadArea?.(); } catch { /* ignore */ }
  }
  return result;
}

/**
 * Live-refresh open notes when the shared Actor flag changes.
 * @param {Actor} actor
 * @param {object} changes
 */
function onUpdateActor(actor, changes) {
  const notesPath = `flags.${NOTES_MODULE}.notes`;
  if ( !foundry.utils.hasProperty(changes, notesPath)
    && !foundry.utils.hasProperty(changes, `flags.${NOTES_MODULE}`) ) return;

  const app = ui.TokenNotes;
  const bound = app?.object ? resolveWorldActor(app.object) : null;
  if ( !bound || bound.id !== actor.id || !app.textarea ) return;

  const notes = readActorNotes(actor);
  if ( app.textarea.value === notes ) return;
  app.textarea.value = notes;
  try { app._generateReadArea?.(); } catch { /* ignore */ }
}

/**
 * @param {object} proto
 * @param {string} method
 * @param {Function} guard
 */
function patchPrototype(proto, method, guard) {
  if ( !proto || typeof proto[method] !== "function" ) return false;
  if ( proto[method].__jinxTokenNotes ) return true;
  const original = proto[method];
  const patched = function(...args) {
    return guard.call(this, original.bind(this), ...args);
  };
  patched.__jinxTokenNotes = true;
  proto[method] = patched;
  return true;
}

/**
 * Shared Token Notes across maps for the same character.
 */
export function applyTokenNotesTweaks() {
  const app = ui.TokenNotes;
  if ( !app ) {
    log("ui.TokenNotes missing — skipped", "warn");
    return;
  }

  const proto = Object.getPrototypeOf(app);
  let patched = 0;
  if ( patchPrototype(proto, "bind", bindGuard) ) patched += 1;
  if ( patchPrototype(proto, "_save", saveGuard) ) patched += 1;
  if ( patchPrototype(proto, "_onRender", onRenderGuard) ) patched += 1;

  Hooks.on("updateActor", onUpdateActor);

  if ( app.object ) {
    Promise.resolve()
      .then(() => ensureSharedNotesMode(app, app.object))
      .catch(error => log(`Initial shared notes mode failed: ${error?.message || error}`, "error"));
  }

  void migrateGlobalSharedNotes().catch(error => {
    log(`Global notes sync failed: ${error?.message || error}`, "error");
  });

  log(`Shared character notes active (${patched} patch(es); resolve by actorId or unique name)`);
}
