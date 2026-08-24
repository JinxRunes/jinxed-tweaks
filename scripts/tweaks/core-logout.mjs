/**
 * Core logout — navigate to /join?logout=1 so the session world binding is cleared.
 *
 * Our join view auto-redirects authenticated sessions back to /game. Stock
 * Game#logOut only opens /join, so "Log Out" after Login As User immediately
 * re-enters the same player instead of returning to the join form.
 */

function log(message, level="log") {
  console[level](`jinxed-tweaks | core-logout | ${message}`);
}

/**
 * @returns {boolean}
 */
export function applyCoreLogoutTweaks() {
  const Game = globalThis.foundry?.Game;
  if ( !Game?.prototype?.logOut ) {
    log("foundry.Game#logOut unavailable", "warn");
    return false;
  }
  if ( Game.prototype.logOut.isJinxedLogout ) return true;

  const original = Game.prototype.logOut;
  function jinxedLogOut() {
    const getRoute = globalThis.foundry?.utils?.getRoute;
    if ( typeof getRoute === "function" ) {
      window.location.href = `${getRoute("join")}?logout=1`;
      return;
    }
    return original.call(this);
  }
  jinxedLogOut.isJinxedLogout = true;
  Game.prototype.logOut = jinxedLogOut;
  log("foundry.Game#logOut → /join?logout=1");
  return true;
}
