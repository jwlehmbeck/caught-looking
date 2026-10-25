/**
 * OpenAI moderation call (plan U12). Sends only the text: no user id, no
 * context, nothing else. The caller decides what to do on error, and the
 * pipeline fails closed.
 */

export const MODERATION_MODEL = "omni-moderation-latest";
export const MODERATION_TIMEOUT_MS = 2500;

export type ModerationResult =
  | { flagged: boolean; categories: string[] }
  | { error: string };

export type ModerateFn = (text: string) => Promise<ModerationResult>;

export interface ModerationOptions {
  fetch: typeof fetch;
  apiKey: string;
  timeoutMs?: number;
  endpoint?: string;
}

export async function moderateWithOpenAI(
  text: string,
  { fetch: doFetch, apiKey, timeoutMs = MODERATION_TIMEOUT_MS, endpoint }: ModerationOptions,
): Promise<ModerationResult> {
  if (!apiKey) return { error: "missing_api_key" };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await doFetch(endpoint ?? "https://api.openai.com/v1/moderations", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ model: MODERATION_MODEL, input: text }),
      signal: controller.signal,
    });
    if (!res.ok) return { error: `http_${res.status}` };

    const data = (await res.json()) as {
      results?: Array<{ flagged?: boolean; categories?: Record<string, boolean> }>;
    };
    const first = data.results?.[0];
    if (!first) return { error: "malformed_response" };

    const categories = Object.entries(first.categories ?? {})
      .filter(([, on]) => on === true)
      .map(([name]) => name);
    return { flagged: Boolean(first.flagged) || categories.length > 0, categories };
  } catch (err) {
    const name = err instanceof Error ? err.name : "";
    return { error: name === "AbortError" ? "timeout" : "network" };
  } finally {
    clearTimeout(timer);
  }
}

/** Builds a `moderate` function for the pipeline from an API key. */
export function openAiModerator(apiKey: string, fetchImpl: typeof fetch = fetch): ModerateFn {
  return (text) => moderateWithOpenAI(text, { fetch: fetchImpl, apiKey });
}
