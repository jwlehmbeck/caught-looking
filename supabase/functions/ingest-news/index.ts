// ingest-news: pulls allow-listed RSS/Atom feeds into `news` posts (plan U10).
//
// Called hourly by pg_cron (see migration 20261025131000) with the shared
// secret in `x-internal-secret`. The feed list comes from `news_sources`
// (enabled rows only), never from the request body. Each headline runs
// through the shared filter pipeline as a 'title'; anything that is not
// allowed is skipped. Posts are stored through the service-only
// `scorer_ingest_news` RPC, which is idempotent by url.
//
// Deno runtime. Shared code is imported with relative paths.

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

import { openAiModerator } from "../_shared/filters/moderation.ts";
import { filterText } from "../_shared/filters/pipeline.ts";

const MAX_ITEMS_PER_SOURCE = 20;
const FETCH_TIMEOUT_MS = 10_000;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function admin(): SupabaseClient {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set");
  return createClient(url, key, { auth: { persistSession: false } });
}

interface NewsSource {
  id: number;
  name: string;
  feed_url: string;
}

export interface FeedItem {
  title: string;
  url: string;
  publishedAt: string | null;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", "#39": "'" };

function decodeEntities(text: string): string {
  return text.replace(/&(#\d+|#x[0-9a-f]+|[a-z]+|#39);/gi, (m, code: string) => {
    if (code[0] === "#") {
      const n = code[1].toLowerCase() === "x" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : m;
    }
    return ENTITIES[code.toLowerCase()] ?? m;
  });
}

function cleanText(raw: string | undefined): string {
  if (!raw) return "";
  const noCdata = raw.replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/, "$1");
  return decodeEntities(noCdata.replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();
}

function tag(block: string, name: string): string | undefined {
  const m = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "i"));
  return m?.[1];
}

/** The link of an Atom entry: `<link href="…">`, preferring rel="alternate". */
function atomLink(block: string): string | undefined {
  const links = Array.from(block.matchAll(/<link\b([^>]*)\/?>/gi)).map((m) => m[1]);
  const pick = (attrs: string) => attrs.match(/\bhref\s*=\s*["']([^"']+)["']/i)?.[1];
  const alternate = links.find((a) => /\brel\s*=\s*["']alternate["']/i.test(a)) ?? links.find((a) => !/\brel=/i.test(a));
  return alternate ? pick(alternate) : links.length ? pick(links[0]) : undefined;
}

function toIso(raw: string | undefined): string | null {
  if (!raw) return null;
  const d = new Date(cleanText(raw));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** Minimal RSS 2.0 / Atom parsing: enough for headline, link and date. */
export function parseFeed(xml: string): FeedItem[] {
  const out: FeedItem[] = [];
  const blocks = [
    ...Array.from(xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)).map((m) => ({ kind: "rss", body: m[1] })),
    ...Array.from(xml.matchAll(/<entry\b[^>]*>([\s\S]*?)<\/entry>/gi)).map((m) => ({ kind: "atom", body: m[1] })),
  ];
  for (const { kind, body } of blocks) {
    const title = cleanText(tag(body, "title"));
    const link = kind === "rss" ? cleanText(tag(body, "link")) || atomLink(body) : atomLink(body) || cleanText(tag(body, "link"));
    const url = (link ?? "").trim();
    if (!title || !/^https:\/\/[^\s<>"']+$/.test(url)) continue;
    out.push({
      title,
      url,
      publishedAt: toIso(tag(body, "pubDate") ?? tag(body, "published") ?? tag(body, "updated") ?? tag(body, "dc:date")),
    });
    if (out.length >= MAX_ITEMS_PER_SOURCE) break;
  }
  return out;
}

interface SourceSummary {
  source: string;
  fetched: number;
  created: number;
  skipped: number;
  error?: string;
}

async function ingestSource(db: SupabaseClient, source: NewsSource, apiKey: string): Promise<SourceSummary> {
  const summary: SourceSummary = { source: source.name, fetched: 0, created: 0, skipped: 0 };
  let xml: string;
  try {
    const res = await fetch(source.feed_url, {
      headers: { accept: "application/rss+xml, application/atom+xml, application/xml, text/xml" },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`http_${res.status}`);
    xml = await res.text();
  } catch (err) {
    summary.error = err instanceof Error ? err.message : String(err);
    return summary;
  }

  const items = parseFeed(xml);
  summary.fetched = items.length;
  for (const item of items) {
    // Only the headline goes to the moderation API; never a user id.
    const verdict = await filterText(item.title, {
      context: "title",
      allowUrls: ["mlb.com"],
      moderate: apiKey ? openAiModerator(apiKey) : undefined,
    });
    if (verdict.verdict !== "allow") {
      summary.skipped += 1;
      continue;
    }
    const { data, error } = await db.rpc("scorer_ingest_news", {
      p_title: item.title.slice(0, 140),
      p_url: item.url,
      p_published_at: item.publishedAt,
    });
    if (error) {
      console.error(`ingest-news: ${source.name}: ${item.url}: ${error.message}`);
      summary.skipped += 1;
      continue;
    }
    if (data === true) summary.created += 1;
  }
  return summary;
}

Deno.serve(async (req) => {
  const secret = Deno.env.get("INTERNAL_FUNCTION_SECRET");
  if (!secret || req.headers.get("x-internal-secret") !== secret) {
    return json(401, { error: "unauthorized" });
  }

  let db: SupabaseClient;
  try {
    db = admin();
  } catch (err) {
    console.error("ingest-news: misconfigured", err);
    return json(500, { error: "misconfigured" });
  }

  const { data, error } = await db.from("news_sources").select("id, name, feed_url").eq("enabled", true).order("id");
  if (error) return json(502, { ok: false, error: error.message });
  const sources = (data ?? []) as NewsSource[];

  // With OPENAI_API_KEY set, a moderation error holds the headline (it is
  // skipped and picked up on a later run); without a key only the local
  // wordlist, contact and link checks run.
  const apiKey = Deno.env.get("OPENAI_API_KEY") ?? "";
  const results: SourceSummary[] = [];
  for (const source of sources) {
    results.push(await ingestSource(db, source, apiKey));
  }
  return json(200, { ok: results.every((r) => !r.error), sources: results });
});
