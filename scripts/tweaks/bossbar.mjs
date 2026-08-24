/**
 * Bossbar — during active combat, automatically show Classic-Red bars for
 * hostile enemies with max HP > 300 that are alive and visible.
 */

const TARGET_MODULE_ID = "bossbar";
const STYLE_ID = "default"; // Classic - Red
const MAX_HP_THRESHOLD = 300;
const FLAG_SCOPE = "bossbar";
const FLAG_KEY = "actors";

function log(message, level="log") {
  console[level](`jinxed-tweaks | bossbar | ${message}`);
}

function getHpPaths() {
  try {
    return {
      current: game.settings.get(TARGET_MODULE_ID, "currentHpPath") || "attributes.hp.value",
      max: game.settings.get(TARGET_MODULE_ID, "maxHpPath") || "attributes.hp.max"
    };
  }
  catch {
    return {current: "attributes.hp.value", max: "attributes.hp.max"};
  }
}

function isInvisible(actor, tokenDoc) {
  if ( actor?.statuses?.has?.("invisible") ) return true;
  if ( tokenDoc?.hasStatusEffect?.("invisible") ) return true;
  return false;
}

function isHostileEnemy(actor, tokenDoc) {
  const disposition = tokenDoc?.disposition
    ?? actor?.token?.disposition
    ?? actor?.prototypeToken?.disposition;
  return disposition === CONST.TOKEN_DISPOSITIONS.HOSTILE;
}

function isEligibleCombatant(combatant) {
  const actor = combatant.actor;
  if ( !actor ) return false;
  if ( combatant.defeated ) return false;

  const tokenDoc = combatant.token ?? actor.getActiveTokens?.(false, true)?.[0]?.document;
  if ( !tokenDoc ) return false;
  if ( tokenDoc.hidden ) return false;
  if ( isInvisible(actor, tokenDoc) ) return false;
  if ( !isHostileEnemy(actor, tokenDoc) ) return false;

  const paths = getHpPaths();
  const currentHp = Number(foundry.utils.getProperty(actor.system, paths.current));
  const maxHp = Number(foundry.utils.getProperty(actor.system, paths.max));
  if ( !(maxHp > MAX_HP_THRESHOLD) ) return false;
  if ( !(currentHp > 0) ) return false;

  return true;
}

function collectAutoEntries(combat) {
  const entries = [];
  const seen = new Set();
  for ( const combatant of combat.combatants ) {
    if ( !isEligibleCombatant(combatant) ) continue;
    const uuid = combatant.actor.uuid;
    if ( seen.has(uuid) ) continue;
    seen.add(uuid);
    entries.push({
      uuid,
      style: STYLE_ID,
      hideName: false,
      jinxedAuto: true
    });
  }
  return entries;
}

function sameActorList(left=[], right=[]) {
  const normalize = list => list
    .map(entry => `${entry.uuid}|${entry.style || ""}|${Boolean(entry.hideName)}|${Boolean(entry.jinxedAuto)}`)
    .sort()
    .join(";");
  return normalize(left) === normalize(right);
}

async function syncAutoBossBars() {
  if ( !game.user?.isGM ) return;
  if ( game.modules.get(TARGET_MODULE_ID)?.active !== true ) return;

  const scene = game.scenes?.viewed;
  if ( !scene ) return;

  const current = foundry.utils.duplicate(scene.getFlag(FLAG_SCOPE, FLAG_KEY) || []);
  const manual = current.filter(entry => !entry?.jinxedAuto);

  const combat = game.combat;
  const combatActive = Boolean(combat?.started);
  const auto = combatActive ? collectAutoEntries(combat) : [];

  const merged = new Map();
  for ( const entry of manual ) {
    if ( entry?.uuid ) merged.set(entry.uuid, entry);
  }
  for ( const entry of auto ) merged.set(entry.uuid, entry);
  const next = [...merged.values()];

  if ( sameActorList(current, next) ) return;

  await scene.setFlag(FLAG_SCOPE, FLAG_KEY, next);
  log(combatActive
    ? `Synced ${auto.length} auto boss bar(s); ${manual.length} manual retained`
    : `Cleared auto boss bars; ${manual.length} manual retained`);
}

/**
 * Register Bossbar combat auto-display overwrite.
 */
export function applyBossbarTweaks() {
  const sync = foundry.utils.debounce(() => {
    syncAutoBossBars().catch(error => {
      log(`Sync failed: ${error?.message || error}`, "error");
      console.error(error);
    });
  }, 100);

  for ( const hook of [
    "combatStart",
    "deleteCombat",
    "updateCombat",
    "createCombatant",
    "updateCombatant",
    "deleteCombatant",
    "updateActor",
    "createActiveEffect",
    "deleteActiveEffect",
    "updateActiveEffect",
    "canvasReady"
  ] ) {
    Hooks.on(hook, sync);
  }

  Hooks.on("updateToken", (_token, changes) => {
    if ( ["hidden", "disposition", "actorId"].some(key => key in changes) ) sync();
  });

  sync();
  log("Registered auto Classic-Red boss bars for hostile enemies with max HP > 300");
}
