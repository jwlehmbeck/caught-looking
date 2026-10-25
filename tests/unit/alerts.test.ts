import { describe, expect, it, vi } from "vitest";

import {
  ALERT_AFTER_FAILURES,
  EMPTY_FAILURE_COUNTER,
  parseFailureCounter,
  POLLER_FAILURE_KEY,
  REALERT_EVERY_FAILURES,
  recordFailure,
  recordSuccess,
  sendAdminAlert,
  shouldAlert,
  type FailureCounter,
} from "@shared/alerts/index.ts";

const NOW = new Date("2026-04-15T20:00:00Z");

describe("failure counter", () => {
  it("is stored under the poller_failures setting", () => {
    expect(POLLER_FAILURE_KEY).toBe("poller_failures");
  });

  it("alerts on the third consecutive failure and not before", () => {
    let counter: FailureCounter = { ...EMPTY_FAILURE_COUNTER };
    const alerts: number[] = [];
    for (let i = 1; i <= 3; i++) {
      const r = recordFailure(counter, `boom ${i}`, NOW);
      counter = r.counter;
      if (r.alert) alerts.push(i);
    }
    expect(alerts).toEqual([3]);
    expect(counter.count).toBe(3);
    expect(counter.lastError).toBe("boom 3");
    expect(counter.lastAlertAt).toBe(NOW.toISOString());
  });

  it("re-alerts once per REALERT_EVERY_FAILURES after the first alert", () => {
    expect(shouldAlert(1)).toBe(false);
    expect(shouldAlert(2)).toBe(false);
    expect(shouldAlert(ALERT_AFTER_FAILURES)).toBe(true);
    expect(shouldAlert(ALERT_AFTER_FAILURES + 1)).toBe(false);
    expect(shouldAlert(ALERT_AFTER_FAILURES + REALERT_EVERY_FAILURES)).toBe(true);
  });

  it("resets on success so two failures, a success and two more never alert", () => {
    let counter: FailureCounter = { ...EMPTY_FAILURE_COUNTER };
    counter = recordFailure(counter, "a", NOW).counter;
    counter = recordFailure(counter, "b", NOW).counter;
    counter = recordSuccess(counter);
    expect(counter.count).toBe(0);
    expect(counter.lastError).toBeNull();
    let alerted = false;
    counter = recordFailure(counter, "c", NOW).counter;
    const r = recordFailure(counter, "d", NOW);
    alerted = r.alert;
    expect(alerted).toBe(false);
    expect(r.counter.count).toBe(2);
  });

  it("parses whatever is in app_settings defensively", () => {
    expect(parseFailureCounter(null)).toEqual(EMPTY_FAILURE_COUNTER);
    expect(parseFailureCounter({ count: "x" })).toEqual(EMPTY_FAILURE_COUNTER);
    expect(parseFailureCounter({ count: 2.7, lastError: "e" })).toMatchObject({ count: 2, lastError: "e" });
  });
});

describe("sendAdminAlert", () => {
  it("POSTs the alert to the webhook", async () => {
    const fetch = vi.fn(async () => ({ ok: true, status: 200 }));
    const ok = await sendAdminAlert(
      "poller_failure",
      "poll-games has failed 3 times in a row",
      { consecutiveFailures: 3 },
      { webhookUrl: "https://hooks.example.test/alerts", fetch, now: () => NOW },
    );
    expect(ok).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0] as unknown as [string, { method: string; body: string }];
    expect(url).toBe("https://hooks.example.test/alerts");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({
      kind: "poller_failure",
      message: "poll-games has failed 3 times in a row",
      details: { consecutiveFailures: 3 },
      at: NOW.toISOString(),
    });
  });

  it("logs instead when no webhook is configured", async () => {
    const fetch = vi.fn(async () => ({ ok: true, status: 200 }));
    const log = vi.fn();
    const ok = await sendAdminAlert("other", "hello", {}, { webhookUrl: null, fetch, log });
    expect(ok).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledTimes(1);
  });

  it("never throws when the webhook fails", async () => {
    const log = vi.fn();
    const failing = vi.fn(async () => {
      throw new Error("down");
    });
    await expect(
      sendAdminAlert("other", "hello", {}, { webhookUrl: "https://x.test", fetch: failing, log }),
    ).resolves.toBe(false);
    const rejected = vi.fn(async () => ({ ok: false, status: 500 }));
    await expect(
      sendAdminAlert("other", "hello", {}, { webhookUrl: "https://x.test", fetch: rejected, log }),
    ).resolves.toBe(false);
  });

  it("the poller flow: webhook is called exactly once across three failing polls", async () => {
    const fetch = vi.fn(async () => ({ ok: true, status: 200 }));
    let counter: FailureCounter = { ...EMPTY_FAILURE_COUNTER };
    for (let i = 0; i < 3; i++) {
      const r = recordFailure(counter, "MLB timeout", NOW);
      counter = r.counter;
      if (r.alert) {
        await sendAdminAlert("poller_failure", "poller down", { count: counter.count }, { webhookUrl: "https://x.test", fetch });
      }
    }
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
