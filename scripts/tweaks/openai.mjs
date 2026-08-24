/**
 * OpenAI integration for Jinxed Tweaks (client-side API key).
 *
 * Used to polish imported Fandom wiki HTML for Campaign Codex.
 */

import {
  fetchWikiImprovementContext,
  SETTING_WIKI_CONTEXT,
} from "./campaign-codex-fandom-wiki-context.mjs";

const MODULE_ID = "jinxed-tweaks";
const SETTING_API_KEY = "openaiApiKey";
const SETTING_MODEL = "openaiModel";
const SETTING_IMPROVE_ON_IMPORT = "openaiWikiImproveOnImport";
const SETTING_PROXY_URL = "openaiProxyUrl";

export const DEFAULT_OPENAI_MODEL = "gpt-5.6-luna";
const OPENAI_CHAT_URL = "https://api.openai.com/v1/chat/completions";

const WIKI_EDITOR_SYSTEM_PROMPT = `You are an editor preparing Fandom wiki HTML for a tabletop RPG campaign codex in Foundry VTT.

Improve readability and HTML structure while preserving all factual information about the MAIN article only.

Rules:
- Return ONLY a valid HTML fragment (no markdown fences, no commentary).
- Keep major sections as <h2> headings when present.
- Use <h3> for subsections that were sub-headings on the wiki.
- Preserve all links (<a href>) with their URLs unchanged.
- Do not include images (<img>), inline location/settlement icons, figures, galleries, or artist/source attribution lines (e.g. "by Artist from Book, p. 38").
- Weave infobox and sidebar facts into flowing prose — never leave them as labeled factoid lists.
- Remove citation markers, edit links, navboxes, and other wiki cruft if any remain.
- Use clear paragraphs; fix awkward line breaks and stray <br> tags.
- Do not invent new lore, statistics, or names.
- Keep the source spelling.
- Apply editorial judgment from the full text — do not filter by heading keywords or pattern matching alone.

Reference context:
- You may receive excerpts from related wiki articles.
- Use them ONLY to clarify names, relationships, geography, and terminology that appear in the main article.
- Do NOT add tangents, plot summaries, or sections about related topics.
- Do NOT let the page drift away from the main subject. Every paragraph must serve the main article.`;

const WIKI_REORGANIZE_SYSTEM_PROMPT = `${WIKI_EDITOR_SYSTEM_PROMPT}

Reorganization (wiki import mode):
- You receive the full imported article in one pass. Read every section and exercise editorial judgment — never rely on heading keywords, regex-style rules, or title patterns alone.
- Produce a campaign codex article about the MAIN subject only — an in-world reference entry, not a campaign recap.

Target structure (roughly 2–4 substantial <h2> sections, separated by <hr>):
- **Description** — the primary section. Open with what the subject is and why it matters. Integrate infobox details (type, base, goals, founding era, allies, enemies, notable members) as natural sentences and paragraphs, not as metadata lists.
- **History** — organizational/world history (founding, expansion, conflicts, rise and fall) in narrative prose.
- Optional **Society** or **Notable People** only when membership or roster content is long enough to warrant its own section; otherwise fold into Description.

Prose integration (required):
- Do NOT output bullet lists, definition lists, or "Type: … / Base: … / Goals: …" factoid blocks.
- Convert every infobox field into readable sentences inside Description (or History when chronological). Example style: "A decentralized crime syndicate formed around 755 PD, the Myriad pursues profit through racketeering, smuggling, and black market trade, and counts the Clasp among its chief enemies."
- Notable members, allies, and former allies should appear as named references within paragraphs, not as standalone labeled lists.
- Omit all images, inline location icons, figure captions, and artist or sourcebook credit lines.

Merge thin / noisy content (required):
- Fold one-line infobox fields into Description — never give them their own <h2> or bullet list.
- Combine duplicate headings into one.
- Convert stub sections into sentences within Description or History; do not leave almost-empty <h2> blocks.

Remove irrelevant content (required — judge by substance, not title):
- Omit sections whose main purpose is recounting player-party adventures, episode plots, or one-shot sessions involving the subject.
- Omit tangential timeline notes that only matter as behind-the-scenes or episode references unless they materially change the subject's status (e.g. a raid that destroyed its headquarters — keep that fact in History, omit the episode framing).
- When a paragraph mixes useful facts about the subject with party encounter details, keep the facts about the subject and discard the encounter play-by-play.
- A section with a campaign or adventure name in the title may still be kept if its body substantively describes the subject as a world element; conversely, a neutrally titled section may be dropped if it is only party recap.

Keep all substantive world-building facts and links when merging. Do not invent lore.`;

/**
 * @param {string} message
 * @param {"log"|"warn"|"error"} [level]
 */
function log(message, level="log") {
  console[level](`${MODULE_ID} | openai | ${message}`);
}

/**
 * Register client-scoped OpenAI settings (GM module settings UI).
 */
export function registerOpenAiSettings() {
  game.settings.register(MODULE_ID, SETTING_API_KEY, {
    name: "JINXED_TWEAKS.OpenAI.ApiKeyName",
    hint: "JINXED_TWEAKS.OpenAI.ApiKeyHint",
    scope: "client",
    config: true,
    restricted: true,
    type: String,
    default: "",
  });

  game.settings.register(MODULE_ID, SETTING_MODEL, {
    name: "JINXED_TWEAKS.OpenAI.ModelName",
    hint: "JINXED_TWEAKS.OpenAI.ModelHint",
    scope: "client",
    config: true,
    restricted: true,
    type: String,
    default: DEFAULT_OPENAI_MODEL,
  });

  game.settings.register(MODULE_ID, SETTING_IMPROVE_ON_IMPORT, {
    name: "JINXED_TWEAKS.OpenAI.ImproveOnImportName",
    hint: "JINXED_TWEAKS.OpenAI.ImproveOnImportHint",
    scope: "client",
    config: true,
    restricted: true,
    type: Boolean,
    default: true,
  });

  game.settings.register(MODULE_ID, SETTING_PROXY_URL, {
    name: "JINXED_TWEAKS.OpenAI.ProxyUrlName",
    hint: "JINXED_TWEAKS.OpenAI.ProxyUrlHint",
    scope: "client",
    config: true,
    restricted: true,
    type: String,
    default: "",
  });

  game.settings.register(MODULE_ID, SETTING_WIKI_CONTEXT, {
    name: "JINXED_TWEAKS.OpenAI.WikiContextName",
    hint: "JINXED_TWEAKS.OpenAI.WikiContextHint",
    scope: "client",
    config: true,
    restricted: true,
    type: Boolean,
    default: true,
  });
}

/**
 * @returns {string}
 */
export function getOpenAiApiKey() {
  return String(game.settings.get(MODULE_ID, SETTING_API_KEY) || "").trim();
}

/**
 * @returns {string}
 */
export function getOpenAiModel() {
  const model = String(game.settings.get(MODULE_ID, SETTING_MODEL) || "").trim();
  return model || DEFAULT_OPENAI_MODEL;
}

/**
 * @returns {boolean}
 */
export function isOpenAiConfigured() {
  return Boolean(getOpenAiApiKey());
}

/**
 * @returns {boolean}
 */
export function isOpenAiWikiImproveOnImportEnabled() {
  return isOpenAiConfigured() && game.settings.get(MODULE_ID, SETTING_IMPROVE_ON_IMPORT) === true;
}

/**
 * @param {string} content
 */
function extractAssistantHtml(content) {
  let text = String(content || "").trim();
  const fenced = text.match(/^```(?:html)?\s*([\s\S]*?)```$/i);
  if ( fenced ) text = fenced[1].trim();
  return text;
}

/**
 * @param {string} model
 */
function modelSupportsCustomTemperature(model) {
  const id = String(model || "").trim().toLowerCase();
  if ( !id ) return false;
  // Reasoning / fixed-temperature families reject non-default values.
  if ( /^(o\d|gpt-5)/.test(id) ) return false;
  return true;
}

/**
 * @param {Array<{role: string, content: string}>} messages
 */
async function openAiChatCompletion(messages) {
  const apiKey = getOpenAiApiKey();
  if ( !apiKey ) {
    throw new Error(game.i18n.localize("JINXED_TWEAKS.OpenAI.MissingKey"));
  }

  const proxyUrl = String(game.settings.get(MODULE_ID, SETTING_PROXY_URL) || "").trim().replace(/\/+$/, "");
  const endpoint = proxyUrl ? `${proxyUrl}/v1/chat/completions` : OPENAI_CHAT_URL;
  const headers = { "Content-Type": "application/json" };

  const model = getOpenAiModel();
  const payload = {
    model,
    messages,
  };

  if ( modelSupportsCustomTemperature(model) ) {
    payload.temperature = 0.2;
  }

  if ( proxyUrl ) {
    payload.apiKey = apiKey;
  }
  else {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  let response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });
  }
  catch ( error ) {
    const message = error?.message || String(error);
    if ( /failed to fetch|cors|network/i.test(message) ) {
      throw new Error(game.i18n.localize("JINXED_TWEAKS.OpenAI.CorsHint"));
    }
    throw error;
  }

  const data = await response.json().catch(() => ({}));
  if ( !response.ok ) {
    const apiMessage = data?.error?.message || data?.error?.code || `HTTP ${response.status}`;
    throw new Error(apiMessage);
  }

  const content = data?.choices?.[0]?.message?.content;
  if ( !content?.trim() ) {
    throw new Error(game.i18n.localize("JINXED_TWEAKS.OpenAI.EmptyResponse"));
  }

  return content;
}

/**
 * @param {Array<{ title: string, excerpt: string }>} [articles]
 * @param {string} mainTitle
 */
function formatWikiContextBlock(articles, mainTitle) {
  if ( !articles?.length ) return "";

  const lines = [
    "REFERENCE CONTEXT (related Fandom wiki articles — terminology and relationships only):",
    `The MAIN article is "${mainTitle}". Do not shift focus away from it.`,
    "",
  ];

  for ( const article of articles ) {
    lines.push(`### ${article.title}`, article.excerpt, "");
  }

  return lines.join("\n");
}

/**
 * @param {string} html
 * @param {{ pageTitle?: string, entityName?: string, codexSheetType?: string, wikiArticles?: Array<{ title: string, excerpt: string }> }} [context]
 * @param {string} systemPrompt
 * @param {string} taskLine
 */
async function improveWikiWithPrompt(html, context, systemPrompt, taskLine) {
  const trimmed = String(html || "").trim();
  if ( !trimmed ) return "";

  const mainTitle = context.pageTitle || context.entityName || "Wiki article";
  const entity = context.entityName ? `Campaign codex entry: ${context.entityName}` : "";
  const sheetType = context.codexSheetType
    ? `Codex sheet type: ${context.codexSheetType} (write as an in-world ${context.codexSheetType} entry, not a campaign episode guide).`
    : "";
  const wikiContext = formatWikiContextBlock(context.wikiArticles, mainTitle);

  const userPrompt = [
    `MAIN ARTICLE: ${mainTitle}`,
    entity,
    sheetType,
    wikiContext,
    taskLine,
    trimmed,
  ].filter(Boolean).join("\n\n");

  const content = await openAiChatCompletion([
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt },
  ]);

  return extractAssistantHtml(content);
}

/**
 * @param {string} html
 * @param {{ pageTitle?: string, entityName?: string, codexSheetType?: string, wikiArticles?: Array<{ title: string, excerpt: string }> }} [context]
 */
async function improveWikiPolish(html, context={}) {
  return improveWikiWithPrompt(
    html,
    context,
    WIKI_EDITOR_SYSTEM_PROMPT,
    "Improve this HTML for the MAIN ARTICLE. Preserve structure unless merging clearly improves readability:",
  );
}

/**
 * @param {string} html
 * @param {{ pageTitle?: string, entityName?: string, codexSheetType?: string, wikiArticles?: Array<{ title: string, excerpt: string }> }} [context]
 */
async function improveWikiDocument(html, context={}) {
  return improveWikiWithPrompt(
    html,
    context,
    WIKI_REORGANIZE_SYSTEM_PROMPT,
    "Reorganize this imported Fandom wiki HTML into a focused campaign codex article about the MAIN ARTICLE. Use editorial judgment on the full document — weave infobox details into Description as prose (no factoid lists), merge thin sections, omit party-recap content, and keep substantive world reference material:",
  );
}

/**
 * @param {string} html
 * @param {{ pageTitle?: string, entityName?: string, codexSheetType?: string, wikiSource?: { apiUrl: string, origin: string, pageTitle: string }, wikiArticles?: Array<{ title: string, excerpt: string }>, reorganize?: boolean }} [context]
 */
export async function improveWikiHtml(html, context={}) {
  const source = String(html || "").trim();
  if ( !source ) return "";

  let wikiArticles = context.wikiArticles;
  if ( !wikiArticles && context.wikiSource ) {
    wikiArticles = await fetchWikiImprovementContext({
      ...context.wikiSource,
      mainHtml: source,
    });
  }

  const sectionContext = { ...context, wikiArticles };

  if ( context.reorganize ) {
    return improveWikiDocument(source, sectionContext);
  }

  return improveWikiPolish(source, sectionContext);
}

