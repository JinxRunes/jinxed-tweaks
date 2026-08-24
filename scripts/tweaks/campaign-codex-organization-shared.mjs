/**
 * Shared constants/helpers for Campaign Codex Organizations.
 */

export const MODULE_ID = "jinxed-tweaks";
export const TARGET_MODULE_ID = "campaign-codex";
export const ORGANIZATION_TYPE = "organization";
export const ORGANIZATION_SHEET_CLASS = "jinxed-tweaks.OrganizationSheet";
export const ORGANIZATION_FOLDER_NAME = "Campaign Codex - Organizations";

/**
 * @param {string} relativePath
 */
export function campaignCodexUrl(relativePath) {
  return `/modules/${TARGET_MODULE_ID}/${String(relativePath || "").replace(/^\/+/, "")}`;
}

/**
 * @param {import("foundry.documents.JournalEntry")|null|undefined} journal
 */
export function getJournalCodexType(journal) {
  if ( !journal ) return null;
  const explicit = String(journal.getFlag?.(TARGET_MODULE_ID, "type") || "").trim().toLowerCase();
  if ( explicit ) return explicit;
  const sheetClass = journal.flags?.core?.sheetClass;
  if ( sheetClass === ORGANIZATION_SHEET_CLASS ) return ORGANIZATION_TYPE;
  if ( sheetClass === "campaign-codex.TagSheet" ) return "tag";
  return null;
}

/**
 * @param {{ uuid?: string, codexType?: string, type?: string }|null|undefined} associate
 */
export function getAssociateCodexType(associate) {
  if ( !associate ) return null;
  if ( associate.codexType ) return associate.codexType;
  if ( associate.type === ORGANIZATION_TYPE || associate.type === "organization" ) return ORGANIZATION_TYPE;
  if ( associate.type === "faction" || associate.type === "tag" ) return "tag";
  const journal = fromUuidSync(associate.uuid);
  return getJournalCodexType(journal);
}

/**
 * @param {Array<object>} associates
 */
export function filterOrganizationTaggedAssociates(associates) {
  return associates.filter((entry) => entry.tag === true && getAssociateCodexType(entry) === ORGANIZATION_TYPE);
}

/**
 * @param {Array<object>} associates
 */
export function filterFactionTaggedAssociates(associates) {
  return associates.filter((entry) => entry.tag === true && getAssociateCodexType(entry) === "tag");
}

export function patchI18nOrganizationLabels() {
  const languages = game.i18n?.languages?.length ? game.i18n.languages : [game.i18n.lang || "en"];
  for ( const lang of languages ) {
    const translations = game.i18n.translations?.[lang];
    if ( !translations ) continue;
    foundry.utils.setProperty(translations, "CAMPAIGN_CODEX.names.organization", "Organization");
    foundry.utils.setProperty(translations, "CAMPAIGN_CODEX.names.organizations", "Organizations");
  }
}

/**
 * @param {import("modules/campaign-codex/scripts/sheets/tag-sheet.js").TagSheet|import("./campaign-codex-organizations.mjs").OrganizationSheet} sheet
 */
export function isOrganizationSheet(sheet) {
  return sheet?.getSheetType?.() === ORGANIZATION_TYPE;
}

/**
 * @param {import("modules/campaign-codex/scripts/sheets/tag-sheet.js").TagSheet|import("./campaign-codex-organizations.mjs").OrganizationSheet} sheet
 */
export function isFactionTagSheet(sheet) {
  return sheet?.getSheetType?.() === "tag";
}

/**
 * @param {import("modules/campaign-codex/scripts/sheets/tag-sheet.js").TagSheet|import("./campaign-codex-organizations.mjs").OrganizationSheet} sheet
 */
export function isTagLikeCodexSheet(sheet) {
  return isFactionTagSheet(sheet) || isOrganizationSheet(sheet);
}
