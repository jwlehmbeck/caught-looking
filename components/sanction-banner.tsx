import Link from "next/link";

import { createClient } from "@/lib/supabase/server";

interface Sanction {
  kind: "chat_mute" | "suspension" | "ban";
  reason: string;
  ends_at: string | null;
}

const LABEL: Record<Sanction["kind"], string> = {
  chat_mute: "You're muted in chat",
  suspension: "Your account is suspended",
  ban: "Your account is banned",
};

function until(endsAt: string | null): string {
  if (!endsAt) return "";
  return ` until ${new Date(endsAt).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}`;
}

/**
 * Tells a muted or suspended user what is going on and how to appeal.
 * Renders nothing for everyone else. Mount it near the top of signed-in
 * pages (home and settings).
 */
export async function SanctionBanner() {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims?.sub;
  if (typeof userId !== "string") return null;

  const { data } = await supabase.rpc("active_sanctions", { p_user_id: userId });
  const sanctions = (data ?? []) as Sanction[];
  if (sanctions.length === 0) return null;

  return (
    <aside
      role="status"
      style={{
        background: "#3a2a12",
        border: "1px solid var(--cl-accent)",
        borderRadius: "var(--cl-radius-sm)",
        padding: "12px 14px",
        display: "grid",
        gap: 6,
        fontSize: 15,
      }}
    >
      {sanctions.map((s, i) => (
        <p key={i}>
          <strong>{LABEL[s.kind]}</strong>
          {until(s.ends_at)}. Reason: {s.reason}
        </p>
      ))}
      <p style={{ color: "var(--cl-text-muted)", fontSize: 14 }}>
        Think this is a mistake? <Link href="/contact">Appeal here</Link>.
      </p>
    </aside>
  );
}
