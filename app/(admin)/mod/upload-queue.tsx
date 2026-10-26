import { REJECTION_REASONS } from "@shared/scan/upload-rules.ts";

import { getUploadQueue, uploadQueueAction } from "@/lib/uploads/actions";
import type { QueuedUpload } from "@/lib/uploads/types";

import { QueuePreview } from "./upload-preview";

const SCAN_LABEL: Record<QueuedUpload["scanStatus"], string> = {
  queued: "Waiting for scan",
  scanning: "Scanning",
  complete: "Scanned",
  timeout: "Unscanned (timed out)",
  error: "Unscanned (scanner off or failed)",
};

const btn: React.CSSProperties = {
  minHeight: "var(--cl-tap)",
  minWidth: "var(--cl-tap)",
  padding: "0 14px",
  borderRadius: "var(--cl-radius-pill)",
  border: "1px solid var(--cl-border-strong)",
  background: "transparent",
  color: "var(--cl-text)",
  fontSize: 14,
  fontWeight: 500,
};
const btnPrimary: React.CSSProperties = { ...btn, border: 0, background: "var(--cl-accent)", color: "var(--cl-on-accent)", fontWeight: 700 };
const btnDanger: React.CSSProperties = { ...btn, borderColor: "#e06c6c", color: "#ffb4b4" };

function formatDuration(seconds: number | null, ms: number | null): string {
  const s = seconds ?? (ms !== null ? Math.round(ms / 1000) : null);
  if (s === null) return "length unknown";
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/**
 * The admin approval queue for fan edits (plan U11). Shows what the scanner
 * said, plays the original from a 60-second signed URL on tap, and offers
 * Approve or Reject with a reason from the fixed list. Quarantined uploads
 * never reach this list.
 */
export async function UploadQueue() {
  const { rows, error } = await getUploadQueue();

  return (
    <section style={{ display: "grid", gap: 16 }} aria-label="Upload queue">
      {error ? <p role="alert">{error}</p> : null}
      <h2 style={{ fontSize: 20 }}>Fan edits waiting for approval</h2>
      <p style={{ color: "var(--cl-text-muted)", fontSize: 14 }}>
        Watch the whole clip. Reject anything with a face, a school, a location, a username, copyrighted music or anything that is not baseball.
        &quot;Unscanned&quot; means the automated scan never finished; look twice.
      </p>
      {rows.length === 0 && !error ? <p style={{ color: "var(--cl-text-muted)" }}>Nothing waiting.</p> : null}
      {rows.map((row) => (
        <article
          key={row.id}
          data-testid="upload-queue-row"
          style={{
            padding: 16,
            background: "var(--cl-bg-card)",
            border: `1px solid ${row.scanStatus === "complete" ? "var(--cl-border)" : "#e0a95f"}`,
            borderRadius: "var(--cl-radius)",
            display: "grid",
            gap: 10,
          }}
        >
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <strong style={{ fontSize: 17, overflowWrap: "anywhere" }}>{row.title}</strong>
            <span style={{ color: "var(--cl-text-muted)", fontSize: 13 }}>
              by {row.authorUsername ? `@${row.authorUsername}` : "[deleted]"}
              {row.teamAbbreviation ? ` · ${row.teamAbbreviation}` : ""} · {formatDuration(row.durationSeconds, row.durationMs)}
            </span>
          </div>

          <QueuePreview postId={row.id} thumbnailUrl={row.thumbnailUrl} title={row.title} />

          <dl style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "4px 12px", fontSize: 13 }}>
            <dt style={{ color: "var(--cl-text-muted)" }}>Scan</dt>
            <dd>{SCAN_LABEL[row.scanStatus]}</dd>
            <dt style={{ color: "var(--cl-text-muted)" }}>Hash check</dt>
            <dd>{row.csamChecked ? "done" : "not run"}</dd>
            <dt style={{ color: "var(--cl-text-muted)" }}>Labels</dt>
            <dd>
              {row.labels.length === 0 ? (
                "none"
              ) : (
                <ul style={{ listStyle: "none", display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {row.labels.slice(0, 8).map((l, i) => (
                    <li key={`${l.Name}-${i}`} style={{ padding: "2px 8px", borderRadius: "var(--cl-radius-pill)", background: "var(--cl-bg-raised)", border: "1px solid var(--cl-border-strong)" }}>
                      {l.Name ?? "?"}
                      {typeof l.Confidence === "number" ? ` ${Math.round(l.Confidence)}%` : ""}
                    </li>
                  ))}
                </ul>
              )}
            </dd>
            <dt style={{ color: "var(--cl-text-muted)" }}>Uploaded</dt>
            <dd>{new Date(row.createdAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</dd>
          </dl>

          <form action={uploadQueueAction} style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <input type="hidden" name="post_id" value={row.id} />
            <button type="submit" name="action" value="approve" style={btnPrimary}>
              Approve
            </button>
            <label style={{ display: "inline-flex", gap: 6, alignItems: "center", fontSize: 14 }}>
              <span>Reason</span>
              <select
                name="reason"
                defaultValue="quality"
                style={{
                  font: "inherit",
                  color: "var(--cl-text)",
                  background: "var(--cl-bg)",
                  border: "1px solid var(--cl-border-strong)",
                  borderRadius: "var(--cl-radius-sm)",
                  minHeight: "var(--cl-tap)",
                  padding: "0 8px",
                }}
              >
                {REJECTION_REASONS.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </select>
            </label>
            <button type="submit" name="action" value="reject" style={btnDanger}>
              Reject
            </button>
          </form>
        </article>
      ))}
    </section>
  );
}
