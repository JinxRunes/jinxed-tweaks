/**
 * Campaign Codex — fix repeat "Change image" FilePicker opens.
 *
 * Upstream changeImage() uses the fixed Application id `file-picker`. A picker that
 * is still closing (or left a stale instance) can block the next open so the context
 * menu appears to do nothing. Stored CDN URLs also break directory inference.
 */

import { toFilePickerCurrent } from "./core-cdn.mjs";

const TARGET_MODULE_ID = "campaign-codex";
const PATCH_MARKER = "__jinxCodexImagePicker";
const LEGACY_FILE_PICKER_ID = "file-picker";

/**
 * @param {string} message
 * @param {"log"|"warn"|"error"} [level]
 */
function log(message, level="log") {
  console[level](`jinxed-tweaks | campaign-codex-image | ${message}`);
}

/**
 * @param {string} relativePath
 */
function campaignCodexUrl(relativePath) {
  return `/modules/${TARGET_MODULE_ID}/${String(relativePath || "").replace(/^\/+/, "")}`;
}

/**
 * @param {string} path
 */
function normalizeStoredImagePath(path) {
  const normalized = toFilePickerCurrent(String(path || "").trim());
  return normalized || String(path || "").trim();
}

/**
 * Close any lingering Campaign Codex / core FilePicker using the shared id.
 */
async function closeLingeringFilePicker() {
  const existing = foundry.applications.instances.get(LEGACY_FILE_PICKER_ID);
  if ( !existing ) return;
  try {
    await existing.close({ animate: false });
  }
  catch { /* ignore */ }
}

/**
 * @param {import("modules/campaign-codex/scripts/sheets/base-sheet.js").CampaignCodexBaseSheet} sheet
 */
async function openCodexImagePicker(sheet) {
  const FilePicker = foundry.applications.apps.FilePicker.implementation;
  if ( !FilePicker ) {
    ui.notifications.error("File picker is unavailable.");
    return;
  }

  if ( game.user?.can("FILES_BROWSE") === false ) {
    ui.notifications.warn(game.i18n.localize("FILES.BrowsePermission"));
    return;
  }

  await closeLingeringFilePicker();

  const rawCurrent = sheet.document.getFlag("campaign-codex", "image") || sheet.document.img || "";
  const current = normalizeStoredImagePath(rawCurrent);

  const { top, left } = sheet.position ?? {};
  const position = { width: 560 };
  if ( Number.isFinite(top) ) position.top = top + 40;
  if ( Number.isFinite(left) ) position.left = left + 10;

  const fp = new FilePicker({
    id: "jinx-codex-image-{id}",
    type: "image",
    current,
    position,
    callback: async (path) => {
      try {
        const stored = normalizeStoredImagePath(path);
        await sheet.document.setFlag("campaign-codex", "image", stored);
        await sheet.render(false);
      }
      catch ( error ) {
        console.error("Campaign Codex | Failed to update image:", error);
        ui.notifications.error("Failed to update Campaign Codex image.");
      }
    },
  });

  try {
    await fp.browse();
  }
  catch ( error ) {
    log(`FilePicker browse failed: ${error?.message || error}`, "error");
    ui.notifications.error(error?.message || String(error));
  }
}

/**
 * @returns {Promise<boolean>}
 */
export async function patchCodexImagePicker() {
  const { CampaignCodexBaseSheet } = await import(campaignCodexUrl("scripts/sheets/base-sheet.js"));
  const proto = CampaignCodexBaseSheet.prototype;

  if ( proto.changeImage?.[PATCH_MARKER] ) return false;

  proto.changeImage = async function jinxCodexChangeImage() {
    return openCodexImagePicker(this);
  };
  proto.changeImage[PATCH_MARKER] = true;

  log("Campaign Codex change-image picker patched");
  return true;
}
