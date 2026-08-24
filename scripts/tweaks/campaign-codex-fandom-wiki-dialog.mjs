/**
 * Campaign Codex — Fandom wiki import dialog (DialogV2 + CC styling).
 */

import { isOpenAiConfigured, isOpenAiWikiImproveOnImportEnabled } from "./openai.mjs";
import { parseFandomWikiUrl } from "./campaign-codex-fandom-wiki-api.mjs";
import { previewWikiArticleSections } from "./campaign-codex-fandom-wiki-sections.mjs";

const SESSION_WIKI_BASE_KEY = "jinxFandomWikiBase";
const DEFAULT_WIKI_BASE = "https://criticalrole.fandom.com";

/**
 * @param {string} raw
 * @param {string} [wikiBase]
 */
export function normalizeFandomWikiUrlInput(raw, wikiBase=DEFAULT_WIKI_BASE) {
  const trimmed = String(raw || "").trim();
  if ( !trimmed ) return "";

  if ( /^https?:\/\//i.test(trimmed) ) return trimmed;

  const base = String(wikiBase || DEFAULT_WIKI_BASE).trim().replace(/\/+$/, "");
  if ( trimmed.startsWith("/wiki/") ) return `${base}${trimmed}`;
  if ( trimmed.startsWith("wiki/") ) return `${base}/${trimmed}`;

  const slug = trimmed.replace(/\s+/g, "_");
  return `${base}/wiki/${encodeURIComponent(slug).replace(/%20/g, "_")}`;
}

/**
 * @param {string} raw
 * @param {string} [wikiBase]
 */
export function previewFandomWikiUrl(raw, wikiBase) {
  try {
    const url = normalizeFandomWikiUrlInput(raw, wikiBase);
    if ( !url ) return { ok: false, error: game.i18n.localize("JINXED_TWEAKS.FandomWiki.UrlRequired") };
    const parsed = parseFandomWikiUrl(url);
    const title = parsed.pageTitle.replace(/_/g, " ");
    return { ok: true, url, title, origin: parsed.origin };
  }
  catch ( error ) {
    return { ok: false, error: error?.message || String(error) };
  }
}

/**
 * @param {string} wikiBase
 */
function rememberWikiBase(wikiBase) {
  try {
    sessionStorage.setItem(SESSION_WIKI_BASE_KEY, wikiBase);
  }
  catch { /* ignore */ }
}

/**
 * @returns {string}
 */
function recalledWikiBase() {
  try {
    return sessionStorage.getItem(SESSION_WIKI_BASE_KEY) || DEFAULT_WIKI_BASE;
  }
  catch {
    return DEFAULT_WIKI_BASE;
  }
}

/**
 * @param {import("modules/campaign-codex/scripts/sheets/base-sheet.js").CampaignCodexBaseSheet} sheet
 */
function buildDialogContent(sheet) {
  const openAiReady = isOpenAiConfigured();
  const improveDefault = openAiReady && isOpenAiWikiImproveOnImportEnabled();
  const wikiBase = recalledWikiBase();
  const entryName = foundry.utils.escapeHTML(sheet.document?.name || "");

  const improveBlock = openAiReady ? `
    <label class="cc-awards-pill jinx-wiki-option-pill" data-tooltip="${foundry.utils.escapeHTML(game.i18n.localize("JINXED_TWEAKS.FandomWiki.ImproveWithAiHint"))}">
      <input type="checkbox" class="cc-awards-hidden-input" name="improveWithAi" ${improveDefault ? "checked" : ""}>
      <i class="fas fa-wand-magic-sparkles"></i>
      <span>${game.i18n.localize("JINXED_TWEAKS.FandomWiki.ImproveWithAi")}</span>
    </label>
  ` : `
    <p class="jinx-wiki-dialog-note">
      <i class="fas fa-circle-info"></i>
      ${game.i18n.localize("JINXED_TWEAKS.FandomWiki.OpenAiUnavailable")}
    </p>
  `;

  return `
    <div class="campaign-codex jinx-fandom-wiki-dialog standard-form">
      <header class="jinx-wiki-dialog-header">
        <div class="jinx-wiki-dialog-header-icon"><i class="fas fa-book-open"></i></div>
        <div class="jinx-wiki-dialog-header-copy">
          <h3>${game.i18n.localize("JINXED_TWEAKS.FandomWiki.DialogTitle")}</h3>
          <p>${game.i18n.format("JINXED_TWEAKS.FandomWiki.DialogIntro", { name: entryName })}</p>
        </div>
      </header>

      <div class="form-group">
        <label for="jinx-wiki-base">${game.i18n.localize("JINXED_TWEAKS.FandomWiki.WikiBaseLabel")}</label>
        <input
          id="jinx-wiki-base"
          type="url"
          name="wikiBase"
          value="${foundry.utils.escapeHTML(wikiBase)}"
          placeholder="https://criticalrole.fandom.com"
        />
        <p class="hint">${game.i18n.localize("JINXED_TWEAKS.FandomWiki.WikiBaseHint")}</p>
      </div>

      <div class="form-group">
        <label for="jinx-wiki-article">${game.i18n.localize("JINXED_TWEAKS.FandomWiki.ArticleLabel")}</label>
        <input
          id="jinx-wiki-article"
          type="text"
          name="wikiArticle"
          placeholder="${foundry.utils.escapeHTML(game.i18n.localize("JINXED_TWEAKS.FandomWiki.ArticlePlaceholder"))}"
          autofocus
        />
        <p class="hint">${game.i18n.localize("JINXED_TWEAKS.FandomWiki.ArticleHint")}</p>
      </div>

      <div class="jinx-wiki-preview" data-state="idle">
        <i class="fas fa-link jinx-wiki-preview-icon"></i>
        <span class="jinx-wiki-preview-text">${game.i18n.localize("JINXED_TWEAKS.FandomWiki.PreviewIdle")}</span>
      </div>

      <fieldset class="jinx-wiki-fieldset">
        <legend>${game.i18n.localize("JINXED_TWEAKS.FandomWiki.OptionsLegend")}</legend>
        <div class="cc-awards-pill-row jinx-wiki-options-row">
          <label class="cc-awards-pill jinx-wiki-option-pill">
            <input type="radio" class="cc-awards-hidden-input" name="importMode" value="replace" checked>
            <i class="fas fa-file-import"></i>
            <span>${game.i18n.localize("JINXED_TWEAKS.FandomWiki.ModeReplace")}</span>
          </label>
          <label class="cc-awards-pill jinx-wiki-option-pill">
            <input type="radio" class="cc-awards-hidden-input" name="importMode" value="append">
            <i class="fas fa-plus"></i>
            <span>${game.i18n.localize("JINXED_TWEAKS.FandomWiki.ModeAppend")}</span>
          </label>
          ${improveBlock}
        </div>
      </fieldset>
    </div>
  `;
}

/**
 * @param {HTMLFormElement} form
 */
function bindDialogInteractions(form) {
  const articleInput = form.querySelector('[name="wikiArticle"]');
  const baseInput = form.querySelector('[name="wikiBase"]');
  const preview = form.querySelector(".jinx-wiki-preview");
  const previewText = preview?.querySelector(".jinx-wiki-preview-text");
  const previewIcon = preview?.querySelector(".jinx-wiki-preview-icon");
  const importButton = form.closest("dialog, .application")?.querySelector('button[data-action="ok"]');

  let previewTimer = null;
  let previewRequestId = 0;

  const setImportEnabled = (enabled) => {
    if ( importButton ) importButton.disabled = !enabled;
  };

  const updatePreview = async () => {
    const requestId = ++previewRequestId;
    const result = previewFandomWikiUrl(articleInput?.value, baseInput?.value);

    if ( !preview || !previewText || !previewIcon ) {
      setImportEnabled(result.ok);
      return;
    }

    if ( !String(articleInput?.value || "").trim() ) {
      preview.dataset.state = "idle";
      previewIcon.className = "fas fa-link jinx-wiki-preview-icon";
      previewText.textContent = game.i18n.localize("JINXED_TWEAKS.FandomWiki.PreviewIdle");
      setImportEnabled(false);
      return;
    }

    if ( !result.ok ) {
      preview.dataset.state = "error";
      previewIcon.className = "fas fa-triangle-exclamation jinx-wiki-preview-icon";
      previewText.textContent = result.error;
      setImportEnabled(false);
      return;
    }

    preview.dataset.state = "loading";
    previewIcon.className = "fas fa-spinner fa-spin jinx-wiki-preview-icon";
    previewText.textContent = game.i18n.localize("JINXED_TWEAKS.FandomWiki.PreviewLoading");
    setImportEnabled(false);

    try {
      const sections = await previewWikiArticleSections(result.url);
      if ( requestId !== previewRequestId ) return;

      if ( !sections.sectionCount ) {
        preview.dataset.state = "error";
        previewIcon.className = "fas fa-triangle-exclamation jinx-wiki-preview-icon";
        previewText.textContent = game.i18n.format("JINXED_TWEAKS.FandomWiki.NoImportableSections", {
          title: sections.pageTitle,
        });
        setImportEnabled(false);
        return;
      }

      preview.dataset.state = "ready";
      previewIcon.className = "fas fa-check jinx-wiki-preview-icon";
      previewText.innerHTML = game.i18n.format("JINXED_TWEAKS.FandomWiki.PreviewReady", {
        title: sections.pageTitle,
        host: new URL(sections.origin).hostname,
        count: sections.sectionCount,
        sections: sections.sectionTitles.join(", "),
      });
      setImportEnabled(true);
    }
    catch ( error ) {
      if ( requestId !== previewRequestId ) return;
      preview.dataset.state = "error";
      previewIcon.className = "fas fa-triangle-exclamation jinx-wiki-preview-icon";
      previewText.textContent = error?.message || String(error);
      setImportEnabled(false);
    }
  };

  const schedulePreview = () => {
    clearTimeout(previewTimer);
    previewTimer = setTimeout(() => {
      void updatePreview();
    }, 400);
  };

  articleInput?.addEventListener("input", schedulePreview);
  baseInput?.addEventListener("input", schedulePreview);
  updatePreview();
}

/**
 * @param {import("modules/campaign-codex/scripts/sheets/base-sheet.js").CampaignCodexBaseSheet} sheet
 * @returns {Promise<{
 *   url: string,
 *   importMode: "replace"|"append",
 *   improveWithAi: boolean
 * }|null>}
 */
export async function promptFandomWikiImport(sheet) {
  const { DialogV2 } = foundry.applications.api;

  return DialogV2.prompt({
    classes: ["dialog", "campaign-codex", "jinx-fandom-wiki-import-app"],
    position: { width: 560 },
    window: {
      title: game.i18n.localize("JINXED_TWEAKS.FandomWiki.WindowTitle"),
      icon: "fa-solid fa-book-open",
    },
    content: buildDialogContent(sheet),
    ok: {
      icon: '<i class="fas fa-download"></i>',
      label: game.i18n.localize("JINXED_TWEAKS.FandomWiki.ImportButton"),
      callback: (_event, button) => {
        const form = button.form;
        const wikiBase = String(form.elements.wikiBase?.value || "").trim();
        const article = String(form.elements.wikiArticle?.value || "").trim();
        const url = normalizeFandomWikiUrlInput(article, wikiBase);
        const preview = previewFandomWikiUrl(article, wikiBase);
        if ( !preview.ok ) {
          ui.notifications.warn(preview.error);
          return null;
        }

        const importMode = String(form.elements.importMode?.value || "replace");
        const improveWithAi = Boolean(form.elements.improveWithAi?.checked);
        rememberWikiBase(wikiBase || preview.origin);

        return { url, importMode, improveWithAi };
      },
    },
    cancel: {
      icon: '<i class="fas fa-times"></i>',
      label: game.i18n.localize("JINXED_TWEAKS.FandomWiki.CancelButton"),
    },
    render: (_event, dialog) => {
      const root = dialog?.element || _event?.target?.element;
      const form = root?.querySelector("form");
      if ( form ) bindDialogInteractions(form);
    },
    rejectClose: false,
  }).catch(() => null);
}
