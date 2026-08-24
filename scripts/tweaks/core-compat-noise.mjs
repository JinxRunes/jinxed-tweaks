/**
 * Core compatibility / console noise — silence known non-breaking spam.
 *
 * 1) Midi-QOL still touches V13 globals (DocumentSheetConfig, CanvasOcclusionMask).
 *    Prefer Foundry's CONFIG.compatibility.excludePatterns (official filter).
 * 2) Monks Wall Enhancement still reads Scene#background (V14 → Level#background).
 * 3) Chromium WebGL performance warnings during Foundry fog/visibility
 *    TextureExtractor readPixels — filter via console.warn when writable.
 * 4) Foundry non-strict DataModel.validate logs DataModelValidationFailure objects
 *    via logger.warn(failure) — stringify via toString()/message before matching.
 *
 * Do not assign to foundry.utils.logCompatibilityWarning — it is read-only.
 */

const COMPAT_EXCLUDE = [
  /You are accessing the global "DocumentSheetConfig"/i,
  /You are accessing the global "CanvasOcclusionMask"/i,
  /deprecated dae special duration/i,
  /Unresolved StringTerm NaN/i,
  /Scene#background is deprecated/i,
  /Level#background and Level#textures/i
];

const CONSOLE_WARN_SILENCE = [
  /READ-usage buffer was written, then fenced/i,
  /discarded the shadow copy that was created to accelerate readback/i,
  /performance warning:\s*READ-usage buffer/i,
  /deprecated dae special duration/i,
  /Unresolved StringTerm NaN/i,
  /failed to validate: Unresolved StringTerm NaN/i,
  /Scene#background is deprecated/i,
  /Level#background and Level#textures/i,
  // Stale/missing package subtypes (or transient load); Foundry already drops the page.
  /simple-quest\.\w+ is not a valid type/i,
  /is not a valid type for the JournalEntryPage Document class/i
];

let compatInstalled = false;
let consoleInstalled = false;

function matchesAny(message, patterns) {
  const text = String(message ?? "");
  return patterns.some(re => re.test(text));
}

/**
 * Foundry logs DataModelValidationFailure objects directly; useful text is often
 * in toString() / nested fields, not always in .message.
 * @param {unknown} arg
 * @returns {string}
 */
function argToText(arg) {
  if ( typeof arg === "string" ) return arg;
  if ( arg instanceof Error ) return `${arg.message}\n${arg.stack ?? ""}`;
  if ( !arg || typeof arg !== "object" ) return String(arg ?? "");

  const name = arg.constructor?.name ?? "";
  if ( name === "DataModelValidationFailure" || typeof arg.asError === "function" ) {
    try {
      const formatted = typeof arg.toString === "function" ? arg.toString() : "";
      if ( formatted && formatted !== "[object Object]" ) return formatted;
    }
    catch { /* ignore */ }
    return [arg.message, arg.fieldPath, name].filter(Boolean).join(" ");
  }

  if ( typeof arg.message === "string" && arg.message ) return arg.message;
  try {
    return JSON.stringify(arg);
  }
  catch {
    return String(arg);
  }
}

/**
 * Register Foundry compatibility exclude patterns for known Midi-QOL noise.
 */
export function installCompatNoiseFilter() {
  if ( compatInstalled ) return;
  const compatibility = globalThis.CONFIG?.compatibility;
  if ( !compatibility ) return;

  const list = compatibility.excludePatterns ??= [];
  for ( const pattern of COMPAT_EXCLUDE ) {
    if ( !list.some(existing => String(existing) === String(pattern)) ) list.push(pattern);
  }
  compatInstalled = true;
}

/**
 * Patch console.warn for Chromium WebGL fog-extract performance spam and known
 * DataModelValidationFailure noise.
 */
export function installConsoleWarnFilter() {
  if ( consoleInstalled ) return;

  const original = console.warn.bind(console);
  const filtered = function jinxedConsoleWarn(...args) {
    const joined = args.map(argToText).join(" ");
    if ( matchesAny(joined, CONSOLE_WARN_SILENCE) ) return;
    // Drop bare DataModelValidationFailure dumps with no usable detail.
    if ( args.length === 1 && args[0]?.constructor?.name === "DataModelValidationFailure" ) {
      const text = argToText(args[0]);
      if ( !text || text === "DataModelValidationFailure" ) return;
      if ( matchesAny(text, CONSOLE_WARN_SILENCE) ) return;
    }
    return original(...args);
  };

  try {
    console.warn = filtered;
  }
  catch {
    try {
      Object.defineProperty(console, "warn", {
        configurable: true,
        writable: true,
        value: filtered
      });
    }
    catch (error) {
      console.log(`jinxed-tweaks | core-compat-noise | Could not wrap console.warn: ${error?.message || error}`);
      return;
    }
  }
  consoleInstalled = true;
}

/**
 * Install filters as early as possible. Compat patterns retry on init if CONFIG
 * was not ready at module evaluation.
 */
export function installAllNoiseFilters() {
  installCompatNoiseFilter();
  installConsoleWarnFilter();
}

/**
 * Registry entry (init) — CONFIG is guaranteed; ensure exclude patterns exist.
 */
export function applyCoreCompatNoiseTweaks() {
  installAllNoiseFilters();
  console.log("jinxed-tweaks | core-compat-noise | Filtered Midi-QOL / Monks wall / WebGL fog readback noise");
}
