/**
 * Token resource bars — Never Displayed by default.
 *
 * Forces NONE on every new Actor / Token via document.updateSource in
 * preCreate, plus a createToken safety net for drops that still inherit a
 * non-NONE prototype value.
 */

function log(message, level="log") {
  console[level](`jinxed-tweaks | token-display-bars | ${message}`);
}

/**
 * @returns {number}
 */
function noneMode() {
  return CONST.TOKEN_DISPLAY_MODES?.NONE ?? 0;
}

/**
 * @returns {boolean}
 */
function isActiveGm() {
  return !!(game.user?.isGM && game.users.activeGM?.isSelf);
}

/**
 * @param {Actor} document
 * @param {object} data
 */
function onPreCreateActor(document, data) {
  const none = noneMode();
  const current = Number(
    document.prototypeToken?.displayBars
    ?? foundry.utils.getProperty(data, "prototypeToken.displayBars")
  );
  if ( current === none ) return;
  try {
    document.updateSource({ "prototypeToken.displayBars": none });
  }
  catch {
    foundry.utils.setProperty(data, "prototypeToken.displayBars", none);
  }
}

/**
 * @param {TokenDocument} document
 * @param {object} data
 */
function onPreCreateToken(document, data) {
  const none = noneMode();
  const current = Number(document.displayBars ?? data.displayBars);
  if ( current === none ) return;
  try {
    document.updateSource({ displayBars: none });
  }
  catch {
    data.displayBars = none;
  }
}

/**
 * Catch drops that somehow still inherit a non-NONE prototype value.
 * @param {TokenDocument} token
 */
function onCreateToken(token) {
  if ( !isActiveGm() ) return;
  const none = noneMode();
  if ( Number(token.displayBars) === none ) return;
  void token.update({ displayBars: none }, { animate: false }).catch(err => {
    log(`createToken displayBars fix failed: ${err?.message ?? err}`, "warn");
  });
}

/**
 * Never Display by default for new actors/tokens.
 */
export function applyTokenDisplayBarsTweaks() {
  Hooks.on("preCreateActor", onPreCreateActor);
  Hooks.on("preCreateToken", onPreCreateToken);
  Hooks.on("createToken", onCreateToken);
  log("Token displayBars default Never Displayed enabled");
}
