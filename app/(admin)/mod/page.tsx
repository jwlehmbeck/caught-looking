import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { REPORT_CATEGORIES } from "@/lib/safety/categories";

import { queueAction } from "./actions";
import { InviteGenerator } from "./invite-generator";
import { UploadQueue } from "./upload-queue";

export const metadata: Metadata = { title: "Mod console" };
export const dynamic = "force-dynamic";

interface QueueRow {
  target_type: string;
  target_id: string;
  report_id: number;
  report_count: number;
  categories: string[];
  first_reported_at: string;
  last_reported_at: string;
  snippet: string | null;
  author_id: string | null;
  author_username: string | null;
  urgent: boolean;
  details: string[] | null;
}

const CATEGORY_LABEL = Object.fromEntries(REPORT_CATEGORIES.map((c) => [c.value, c.label]));
const TARGET_LABEL: Record<string, string> = {
  post: "Post",
  comment: "Comment",
  chat_message: "Chat message",
  profile: "Profile",
  poll: "Poll",
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
const btnPrimary: React.CSSProperties = {
  ...btn,
  border: 0,
  background: "var(--cl-accent)",
  color: "var(--cl-on-accent)",
  fontWeight: 700,
};
const btnDanger: React.CSSProperties = {
  ...btn,
  borderColor: "#e06c6c",
  color: "#ffb4b4",
};

export default async function ModPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims) redirect("/signup");

  const { data: role } = await supabase.rpc("my_role");
  const isAdmin = role === "admin";
  const isStaff = isAdmin || role === "mod";
  if (!isStaff) redirect("/");

  const { tab } = await searchParams;
  const activeTab = tab === "invites" && isAdmin ? "invites" : tab === "uploads" && isAdmin ? "uploads" : "reports";

  let rows: QueueRow[] = [];
  let queueError: string | null = null;
  if (activeTab === "reports") {
    const { data, error } = await supabase.rpc("mod_queue");
    if (error) queueError = "Couldn't load the queue. Refresh to try again.";
    rows = (data as QueueRow[] | null) ?? [];
  }
  const urgentRows = rows.filter((r) => r.urgent);
  const ordinaryRows = rows.filter((r) => !r.urgent);

  return (
    <main className="cl-shell" style={{ paddingTop: 32, paddingBottom: 48 }}>
      <header style={{ display: "grid", gap: 8, marginBottom: 20 }}>
        <h1 style={{ fontSize: 28 }}>
          MOD <span style={{ color: "var(--cl-accent)" }}>CONSOLE</span>
        </h1>
        <p style={{ color: "var(--cl-text-muted)", fontSize: 14 }}>
          Signed in as {isAdmin ? "an admin" : "a mod"}. Urgent reports within 12 hours, everything
          else within 48. The mod handbook lives in docs/policies.
        </p>
      </header>

      <nav aria-label="Console sections" style={{ display: "flex", gap: 8, marginBottom: 20 }}>
        <TabLink href="/mod" active={activeTab === "reports"}>
          Reports{rows.length ? ` (${rows.length})` : ""}
        </TabLink>
        {isAdmin ? (
          <TabLink href="/mod?tab=uploads" active={activeTab === "uploads"}>
            Uploads
          </TabLink>
        ) : null}
        {isAdmin ? (
          <TabLink href="/mod?tab=invites" active={activeTab === "invites"}>
            Invites
          </TabLink>
        ) : null}
      </nav>

      {activeTab === "invites" ? (
        <InviteGenerator />
      ) : activeTab === "uploads" ? (
        <UploadQueue />
      ) : (
        <section style={{ display: "grid", gap: 16 }}>
          {queueError ? <p role="alert">{queueError}</p> : null}

          {isAdmin && urgentRows.length > 0 ? (
            <div style={{ display: "grid", gap: 12 }}>
              <h2 style={{ fontSize: 20, color: "#ffb4b4" }}>Urgent · admins only</h2>
              {urgentRows.map((r) => (
                <QueueCard key={`${r.target_type}:${r.target_id}`} row={r} isAdmin={isAdmin} />
              ))}
            </div>
          ) : null}

          <div style={{ display: "grid", gap: 12 }}>
            <h2 style={{ fontSize: 20 }}>Open reports</h2>
            {ordinaryRows.length === 0 && !queueError ? (
              <p style={{ color: "var(--cl-text-muted)" }}>Nothing waiting. Nice.</p>
            ) : null}
            {ordinaryRows.map((r) => (
              <QueueCard key={`${r.target_type}:${r.target_id}`} row={r} isAdmin={isAdmin} />
            ))}
          </div>
        </section>
      )}
    </main>
  );
}

function TabLink({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      prefetch={false}
      style={{
        ...btn,
        display: "inline-flex",
        alignItems: "center",
        background: active ? "var(--cl-bg-raised)" : "transparent",
        color: active ? "var(--cl-accent)" : "var(--cl-text)",
        borderColor: active ? "var(--cl-accent)" : "var(--cl-border-strong)",
      }}
    >
      {children}
    </Link>
  );
}

function QueueCard({ row, isAdmin }: { row: QueueRow; isAdmin: boolean }) {
  const hideable = row.target_type !== "profile" && row.target_type !== "poll";
  const when = new Date(row.last_reported_at).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

  return (
    <article
      style={{
        padding: 16,
        background: "var(--cl-bg-card)",
        border: `1px solid ${row.urgent ? "#e06c6c" : "var(--cl-border)"}`,
        borderRadius: "var(--cl-radius)",
        display: "grid",
        gap: 10,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <span
          aria-label={`${row.report_count} reports`}
          style={{
            minWidth: 32,
            height: 32,
            padding: "0 10px",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            borderRadius: "var(--cl-radius-pill)",
            background: "var(--cl-accent)",
            color: "var(--cl-on-accent)",
            fontWeight: 700,
          }}
        >
          {row.report_count}
        </span>
        <span style={{ fontWeight: 700 }}>{TARGET_LABEL[row.target_type] ?? row.target_type}</span>
        <span style={{ color: "var(--cl-text-muted)", fontSize: 13 }}>last {when}</span>
      </div>

      <ul style={{ listStyle: "none", display: "flex", gap: 6, flexWrap: "wrap" }}>
        {row.categories.map((c) => (
          <li
            key={c}
            style={{
              fontSize: 13,
              padding: "4px 10px",
              borderRadius: "var(--cl-radius-pill)",
              background: "var(--cl-bg-raised)",
              border: "1px solid var(--cl-border-strong)",
            }}
          >
            {CATEGORY_LABEL[c] ?? c}
          </li>
        ))}
      </ul>

      <blockquote
        style={{
          padding: 12,
          background: "var(--cl-bg)",
          borderRadius: "var(--cl-radius-sm)",
          color: "var(--cl-text)",
          overflowWrap: "anywhere",
        }}
      >
        {row.snippet ?? <em style={{ color: "var(--cl-text-muted)" }}>(content no longer available)</em>}
      </blockquote>

      <p style={{ fontSize: 14, color: "var(--cl-text-muted)" }}>
        by {row.author_username ? `@${row.author_username}` : "[deleted]"}
        {row.details && row.details.length ? ` · reporter notes: ${row.details.join(" / ")}` : ""}
      </p>

      <form action={queueAction} style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <input type="hidden" name="target_type" value={row.target_type} />
        <input type="hidden" name="target_id" value={row.target_id} />
        <input type="hidden" name="report_id" value={row.report_id} />
        <input type="hidden" name="author_id" value={row.author_id ?? ""} />
        {hideable ? (
          <button type="submit" name="action" value="hide" style={btn}>
            Hide
          </button>
        ) : null}
        <button type="submit" name="action" value="dismiss" style={btn}>
          Dismiss
        </button>
        <button type="submit" name="action" value="resolve" style={btnPrimary}>
          Resolve
        </button>
        {isAdmin && row.author_id ? (
          <>
            <button type="submit" name="action" value="mute" style={btn}>
              Mute 24h
            </button>
            <button type="submit" name="action" value="suspend" style={btnDanger}>
              Suspend 7d
            </button>
            <button type="submit" name="action" value="ban" style={btnDanger}>
              Ban
            </button>
          </>
        ) : null}
      </form>
    </article>
  );
}
