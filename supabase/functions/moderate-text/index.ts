// moderate-text: runs the shared filter pipeline, including the OpenAI
// moderation call, for server actions and other Edge Functions.
//
// Internal only: callers must send `x-internal-secret`. The body is
// { text, context, allowUrls? } and the response is the FilterResult.
// Only the text reaches OpenAI; no user identifiers are ever sent.
import { filterText, type FilterContext } from "../_shared/filters/pipeline.ts";
import { openAiModerator } from "../_shared/filters/moderation.ts";

const CONTEXTS: FilterContext[] = ["username", "chat", "comment", "title", "poll"];

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const secret = Deno.env.get("INTERNAL_FUNCTION_SECRET") ?? "";
  const given = req.headers.get("x-internal-secret") ?? "";
  if (!secret || !timingSafeEqual(given, secret)) return json({ error: "unauthorized" }, 401);

  let body: { text?: unknown; context?: unknown; allowUrls?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ error: "bad_json" }, 400);
  }

  const text = typeof body.text === "string" ? body.text : "";
  const context = CONTEXTS.includes(body.context as FilterContext)
    ? (body.context as FilterContext)
    : null;
  if (!context) return json({ error: "bad_context" }, 400);

  const allowUrls = Array.isArray(body.allowUrls)
    ? body.allowUrls.filter((h): h is string => typeof h === "string")
    : undefined;

  const apiKey = Deno.env.get("OPENAI_API_KEY") ?? "";
  // With no key the moderator returns an error and the pipeline fails closed.
  const result = await filterText(text, { context, allowUrls, moderate: openAiModerator(apiKey) });
  return json(result);
});
