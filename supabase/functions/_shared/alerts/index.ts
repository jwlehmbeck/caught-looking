/**
 * Admin alerts (plan U4; reused by the scorer, uploads and moderation).
 *
 * `sendAdminAlert` POSTs a JSON payload to the webhook in
 * ADMIN_ALERT_WEBHOOK_URL (any email/Slack/webhook relay). When that is
 * unset it logs to console.error, so alerts are never silently dropped.
 *
 * Alerts are also recorded in `public.alert_log` by the caller (service
 * role) so admins can review them in the app; see the U4 migration.
 */

export type AlertKind =
  | "poller_failure"
  | "scorer_failure"
  | "upload_auto_rejected"
  | "scan_timeout"
  | "urgent_report"
  | "other";

export interface AdminAlert {
  kind: AlertKind;
  message: string;
  details?: Record<string, unknown>;
  at: string;
}

type FetchLike = (input: string, init?: Record<string, unknown>) => Promise<{ ok: boolean; status: number }>;

export interface AlertDeps {
  webhookUrl?: string | null;
  fetch?: FetchLike;
  log?: (message: string, ...rest: unknown[]) => void;
  now?: () => Date;
}

/** Reads an env var in Deno or Node without importing either runtime. */
export function readEnv(name: string): string | undefined {
  const g = globalThis as unknown as {
    Deno?: { env?: { get(name: string): string | undefined } };
    process?: { env?: Record<string, string | undefined> };
  };
  try {
    const fromDeno = g.Deno?.env?.get(name);
    if (fromDeno) return fromDeno;
  } catch {
    // Deno without --allow-env throws; fall through.
  }
  return g.process?.env?.[name];
}

/**
 * Sends one alert. Returns true when a webhook accepted it, false when it
 * was only logged. Never throws: an alert failure must not take down the
 * caller that is already handling a failure.
 */
export async function sendAdminAlert(
  kind: AlertKind,
  message: string,
  details: Record<string, unknown> = {},
  deps: AlertDeps = {},
): Promise<boolean> {
  const log = deps.log ?? ((m: string, ...rest: unknown[]) => console.error(m, ...rest));
  const webhookUrl = deps.webhookUrl === undefined ? readEnv("ADMIN_ALERT_WEBHOOK_URL") : deps.webhookUrl;
  const payload: AdminAlert = { kind, message, details, at: (deps.now?.() ?? new Date()).toISOString() };

  if (!webhookUrl) {
    log(`[admin-alert] ${kind}: ${message}`, details);
    return false;
  }

  const doFetch = deps.fetch ?? (globalThis.fetch as unknown as FetchLike | undefined);
  if (!doFetch) {
    log(`[admin-alert] ${kind}: ${message} (no fetch available)`, details);
    return false;
  }

  try {
    const res = await doFetch(webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      log(`[admin-alert] webhook responded ${res.status}`, payload);
      return false;
    }
    return true;
  } catch (err) {
    log(`[admin-alert] webhook failed`, err, payload);
    return false;
  }
}

// --- Consecutive-failure counter (pure) --------------------------------------

/** Stored in app_settings under FAILURE_COUNTER_KEY. */
export interface FailureCounter {
  count: number;
  lastError: string | null;
  lastFailureAt: string | null;
  lastAlertAt: string | null;
}

export const POLLER_FAILURE_KEY = "poller_failures";

/** Alert on the 3rd consecutive failure, then once an hour of failures after that. */
export const ALERT_AFTER_FAILURES = 3;
export const REALERT_EVERY_FAILURES = 30;

export const EMPTY_FAILURE_COUNTER: FailureCounter = {
  count: 0,
  lastError: null,
  lastFailureAt: null,
  lastAlertAt: null,
};

export function parseFailureCounter(value: unknown): FailureCounter {
  if (typeof value !== "object" || value === null) return { ...EMPTY_FAILURE_COUNTER };
  const v = value as Partial<FailureCounter>;
  return {
    count: typeof v.count === "number" && v.count >= 0 ? Math.floor(v.count) : 0,
    lastError: typeof v.lastError === "string" ? v.lastError : null,
    lastFailureAt: typeof v.lastFailureAt === "string" ? v.lastFailureAt : null,
    lastAlertAt: typeof v.lastAlertAt === "string" ? v.lastAlertAt : null,
  };
}

export function shouldAlert(count: number): boolean {
  if (count < ALERT_AFTER_FAILURES) return false;
  if (count === ALERT_AFTER_FAILURES) return true;
  return (count - ALERT_AFTER_FAILURES) % REALERT_EVERY_FAILURES === 0;
}

/** Next counter after a failed run, and whether this failure should alert. */
export function recordFailure(
  prev: FailureCounter,
  error: string,
  now: Date,
): { counter: FailureCounter; alert: boolean } {
  const count = prev.count + 1;
  const alert = shouldAlert(count);
  return {
    counter: {
      count,
      lastError: error,
      lastFailureAt: now.toISOString(),
      lastAlertAt: alert ? now.toISOString() : prev.lastAlertAt,
    },
    alert,
  };
}

/** Next counter after a successful run: the streak resets. */
export function recordSuccess(prev: FailureCounter): FailureCounter {
  return { ...EMPTY_FAILURE_COUNTER, lastAlertAt: prev.lastAlertAt };
}
