import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { PENDING_COPY, REJECTION_COPY } from "@shared/scan/upload-rules.ts";

import { SanctionBanner } from "@/components/sanction-banner";
import { createClient } from "@/lib/supabase/server";
import { getMyUploads } from "@/lib/uploads/actions";
import type { MyUpload } from "@/lib/uploads/types";

export const metadata: Metadata = { title: "My uploads" };
export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<MyUpload["status"], string> = {
  pending: "Pending review",
  scanning: "Scanning",
  live: "Live in the feed",
  hidden: "Hidden by a mod",
  removed: "Removed",
  rejected: "Not approved",
};

const linkButton: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  minHeight: "var(--cl-tap)",
  padding: "0 14px",
  borderRadius: "var(--cl-radius-pill)",
  border: "1px solid var(--cl-border-strong)",
  color: "var(--cl-text)",
  fontSize: 14,
  fontWeight: 500,
};

function formatDuration(seconds: number | null): string | null {
  if (!seconds || seconds <= 0) return null;
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/** The signed-in fan's fan edits and where each one is in review (plan U11). */
export default async function MyUploadsPage() {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (typeof claims?.claims?.sub !== "string") redirect("/login");

  const uploads = await getMyUploads();

  return (
    <main className="cl-shell" style={{ paddingTop: 32, paddingBottom: 48, display: "grid", gap: 20 }}>
      <nav aria-label="Breadcrumb" style={{ fontSize: 14, color: "var(--cl-text-muted)" }}>
        <Link href="/profile" style={{ display: "inline-flex", alignItems: "center", minHeight: "var(--cl-tap)" }}>
          ← Profile
        </Link>
      </nav>

      <SanctionBanner />

      <header style={{ display: "grid", gap: 4 }}>
        <h1 style={{ fontSize: 30 }}>My uploads</h1>
        <p style={{ color: "var(--cl-text-muted)", fontSize: 15 }}>{PENDING_COPY} You&apos;ll see a reason here if one doesn&apos;t make it.</p>
      </header>

      {uploads.length === 0 ? (
        <section style={{ padding: 20, background: "var(--cl-bg-card)", border: "1px solid var(--cl-border)", borderRadius: "var(--cl-radius)", display: "grid", gap: 10 }}>
          <p>No fan edits yet.</p>
          <Link href="/post/new?tab=upload" style={{ ...linkButton, justifySelf: "start", background: "var(--cl-accent)", color: "var(--cl-on-accent)", border: 0, fontWeight: 700 }}>
            Upload one
          </Link>
        </section>
      ) : (
        <ul style={{ listStyle: "none", display: "grid", gap: 12 }}>
          {uploads.map((u) => (
            <li
              key={u.id}
              data-testid="my-upload"
              data-status={u.status}
              style={{ padding: 14, background: "var(--cl-bg-card)", border: "1px solid var(--cl-border)", borderRadius: "var(--cl-radius)", display: "grid", gap: 8 }}
            >
              <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                {u.thumbnailUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={u.thumbnailUrl} alt="" width={96} height={54} style={{ borderRadius: 8, objectFit: "cover", flexShrink: 0, background: "var(--cl-bg-raised)" }} />
                ) : (
                  <span aria-hidden="true" style={{ width: 96, height: 54, borderRadius: 8, background: "var(--cl-bg-raised)", flexShrink: 0, display: "block" }} />
                )}
                <div style={{ display: "grid", gap: 2, minWidth: 0 }}>
                  <strong style={{ fontSize: 16, overflowWrap: "anywhere" }}>{u.title}</strong>
                  <span style={{ fontSize: 13, color: "var(--cl-text-muted)" }}>
                    {[u.teamAbbreviation, formatDuration(u.durationSeconds), new Date(u.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </div>
              </div>

              <p style={{ fontSize: 14 }}>
                <span
                  style={{
                    display: "inline-block",
                    padding: "3px 10px",
                    borderRadius: "var(--cl-radius-pill)",
                    background: "var(--cl-bg-raised)",
                    border: `1px solid ${u.status === "live" ? "var(--cl-accent)" : u.status === "rejected" ? "#e06c6c" : "var(--cl-border-strong)"}`,
                    fontWeight: 700,
                  }}
                >
                  {STATUS_LABEL[u.status] ?? u.status}
                </span>
                {u.status === "pending" || u.status === "scanning" ? <span style={{ color: "var(--cl-text-muted)" }}> · usually within a day</span> : null}
              </p>

              {u.status === "rejected" ? (
                <div style={{ display: "grid", gap: 8 }}>
                  <p style={{ fontSize: 14 }} data-testid="rejection-reason">
                    {u.rejectionReason ? REJECTION_COPY[u.rejectionReason] : "It didn't meet the upload rules."}{" "}
                    <Link href="/rules#uploads">See the rules.</Link>
                  </p>
                  <Link href="/post/new?tab=upload" style={{ ...linkButton, justifySelf: "start" }}>
                    Try again
                  </Link>
                </div>
              ) : null}

              {u.status === "live" ? (
                <Link href={`/post/${u.id}`} style={{ ...linkButton, justifySelf: "start" }}>
                  See it in the feed
                </Link>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
