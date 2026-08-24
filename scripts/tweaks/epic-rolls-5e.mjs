/**
 * Epic Rolls 5e — auto-start the epic initiative presentation when combat begins,
 * and quiet the intro presentation sound to 20%.
 *
 * Mirrors the module's built-in "Initiative Roll" chat-control action:
 * player-owned combatants roll as `actors`, everyone else as `contestants`.
 *
 * After the presentation finishes, combat is reset to round 1 / turn 0. Foundry
 * pins the current turn to whoever was active when initiative was still null;
 * as scores arrive that combatant sinks to the bottom of the order, so combat
 * would otherwise resume on the last person in the queue.
 */

const TARGET_MODULE_ID = "epic-rolls-5e";
const INTRO_VOLUME = 0.2;

const INITIATIVE_OPTIONS = Object.freeze({
  formula: "",
  DC: 0,
  showDC: false,
  useAverage: false,
  allowReroll: false,
  showRollResults: false,
  blindRoll: false,
  hideNames: false,
  autoColor: true,
  color: "0",
  customLabel: "",
  noMessage: true
});

function log(message, level="log") {
  console[level](`jinxed-tweaks | epic-rolls-5e | ${message}`);
}

function collectCombatActors(combat) {
  const actors = [];
  for ( const combatant of combat?.combatants ?? [] ) {
    const actor = combatant.actor;
    if ( actor ) actors.push(actor);
  }
  return actors;
}

function needsInitiative(combat) {
  return [...(combat?.combatants ?? [])].some(combatant => combatant.initiative == null);
}

function isEpicIntroSound(src) {
  if ( !src ) return false;
  try {
    const intro = game.settings.get(TARGET_MODULE_ID, "introSound");
    if ( intro && src === intro ) return true;
  }
  catch {
    // Settings may be unavailable briefly; fall through to path heuristics.
  }
  return String(src).includes("epic-rolls-5e")
    || String(src).includes("epic_battle_music");
}

/**
 * Epic Rolls hardcodes intro playback at volume 0.8. Force that intro clip to 20%.
 */
function quietEpicIntroSound() {
  const helper = foundry?.audio?.AudioHelper;
  if ( !helper?.play || helper.__jinxedTweaksEpicIntroVolume ) return;

  const originalPlay = helper.play.bind(helper);
  helper.play = function(data, push=true) {
    if ( data && isEpicIntroSound(data.src) ) {
      data = foundry.utils.duplicate(data);
      data.volume = INTRO_VOLUME;
    }
    return originalPlay(data, push);
  };
  helper.__jinxedTweaksEpicIntroVolume = true;
  log(`Intro sound volume forced to ${Math.round(INTRO_VOLUME * 100)}%`);
}

/**
 * Put combat on the first combatant in initiative order (round 1, turn 0).
 * @param {Combat} combat
 */
async function resetCombatToFirstTurn(combat) {
  const live = game.combats?.get(combat?.id) ?? game.combat;
  if ( !live?.started || !game.user?.isGM ) return;

  // Let any trailing combatant initiative writes / debounceSetup settle.
  await new Promise(resolve => setTimeout(resolve, 75));

  const fresh = game.combats?.get(live.id) ?? game.combat;
  if ( !fresh?.started ) return;

  try {
    fresh.setupTurns?.();
  }
  catch {
    // ignore
  }

  const leader = fresh.turns?.[0];
  if ( fresh.round === 1 && fresh.turn === 0 && leader && fresh.combatant?.id === leader.id ) {
    log("Combat already at round 1 / first initiative");
    return;
  }

  await fresh.update({round: 1, turn: 0});
  const name = fresh.turns?.[0]?.name ?? fresh.combatant?.name ?? "?";
  log(`Reset combat to round 1, turn 0 (${name}) after epic initiative`);
}

async function startEpicInitiative(combat) {
  if ( !game.user?.isGM ) return;
  if ( game.modules.get(TARGET_MODULE_ID)?.active !== true ) return;
  if ( typeof ui.EpicRolls5e?.requestRoll !== "function" ) {
    log("ui.EpicRolls5e.requestRoll is unavailable", "warn");
    return;
  }
  if ( ui.EpicRolls5e._currentRoll ) {
    log("Skipped combat-start initiative (an epic roll is already active)");
    return;
  }
  if ( !needsInitiative(combat) ) {
    log("Skipped combat-start initiative (all combatants already have initiative)");
    return;
  }

  const actors = collectCombatActors(combat);
  if ( !actors.length ) {
    log("Skipped combat-start initiative (no combatant actors)", "warn");
    return;
  }

  const playerActors = actors.filter(actor => actor.hasPlayerOwner).map(actor => actor.uuid);
  const contestants = actors.filter(actor => !actor.hasPlayerOwner).map(actor => actor.uuid);
  if ( !playerActors.length && !contestants.length ) return;

  log(`Starting epic initiative for ${playerActors.length} player actor(s) and ${contestants.length} contestant(s)`);
  try {
    const result = await ui.EpicRolls5e.requestRoll({
      actors: playerActors,
      contestants,
      type: "initiative.initiative",
      contest: "initiative.initiative",
      options: {...INITIATIVE_OPTIONS}
    });
    if ( result?.canceled ) {
      log("Epic initiative canceled; leaving combat turn as-is");
      return;
    }
    await resetCombatToFirstTurn(combat);
  }
  catch (error) {
    log(`Failed to start epic initiative: ${error?.message || error}`, "error");
    console.error(error);
  }
}

/**
 * Register combat-start overwrite for Epic Rolls 5e.
 */
export function applyEpicRolls5eTweaks() {
  quietEpicIntroSound();
  Hooks.on("combatStart", combat => {
    // Let Foundry finish applying combat-start updates before requesting the roll UI.
    setTimeout(() => {
      startEpicInitiative(combat).catch(error => {
        log(`combatStart handler failed: ${error?.message || error}`, "error");
      });
    }, 0);
  });
  log("Registered combatStart → epic initiative presentation");
}
