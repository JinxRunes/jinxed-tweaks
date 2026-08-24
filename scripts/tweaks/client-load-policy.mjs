/**
 * Shared client load policy for UK / ISP-sensitive joins.
 * Used by load-throttle (concurrency) and core-cdn (origin-only media).
 */

const MODULE_ID = "jinxed-tweaks";
const SETTING_KEY = "loadThrottleMode";

const UK_TIMEZONES = new Set([
  "Europe/London",
  "Europe/Belfast",
  "Europe/Guernsey",
  "Europe/Isle_of_Man",
  "Europe/Jersey"
]);

/** @type {null|"throttle"|"off"} */
let testOverride = null;

/**
 * Test-only override so Node unit tests stay deterministic across timezones.
 * @param {null|"throttle"|"off"} value
 */
export function __setLoadPolicyForTests(value) {
  testOverride = value;
}

/**
 * @returns {boolean}
 */
export function isUkTimezone() {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return UK_TIMEZONES.has(tz);
  }
  catch {
    return false;
  }
}

/**
 * @returns {"auto"|"always"|"off"}
 */
export function getLoadThrottleMode() {
  try {
    return game.settings.get(MODULE_ID, SETTING_KEY) || "auto";
  }
  catch {
    return "auto";
  }
}

/**
 * Whether this client should use conservative join behavior
 * (texture/fetch throttle + origin-only media).
 * @returns {boolean}
 */
export function shouldThrottle() {
  if ( testOverride === "throttle" ) return true;
  if ( testOverride === "off" ) return false;

  const mode = getLoadThrottleMode();
  if ( mode === "off" ) return false;
  if ( mode === "always" ) return true;
  return isUkTimezone();
}

/**
 * Alias for CDN: same clients that throttle should not dual-host to assets.jinx.gg.
 * @returns {boolean}
 */
export function shouldPreferOriginMedia() {
  return shouldThrottle();
}
