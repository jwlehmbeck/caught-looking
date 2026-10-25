"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";

export interface ModActionResult {
  ok: boolean;
  message: string;
}

/** Hide (or unhide) a post, comment or chat message. Staff only. */
export async function hideContent(
  targetType: string,
  targetId: string,
  hidden: boolean,
): Promise<ModActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("hide_content", {
    p_target_type: targetType,
    p_target_id: targetId,
    p_hidden: hidden,
  });
  revalidatePath("/mod");
  if (error) return { ok: false, message: friendly(error.message) };
  return { ok: true, message: hidden ? "Hidden." : "Visible again." };
}

/** Resolve or dismiss every open report on the same target. Staff only. */
export async function resolveReport(
  reportId: number,
  outcome: "resolved" | "dismissed",
): Promise<ModActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("resolve_report", {
    p_report_id: reportId,
    p_outcome: outcome,
  });
  revalidatePath("/mod");
  if (error) return { ok: false, message: friendly(error.message) };
  return { ok: true, message: outcome === "resolved" ? "Resolved." : "Dismissed." };
}

/**
 * Mute, suspend or ban. The database limits mods to chat mutes of up to 24
 * hours; admins can do the rest.
 */
export async function sanctionUser(
  userId: string,
  kind: "chat_mute" | "suspension" | "ban",
  reason: string,
  hours: number | null,
): Promise<ModActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("issue_sanction", {
    p_user_id: userId,
    p_kind: kind,
    p_reason: reason.trim().slice(0, 500) || "Reported content",
    p_hours: hours,
  });
  revalidatePath("/mod");
  if (error) return { ok: false, message: friendly(error.message) };
  return { ok: true, message: "Done." };
}

/** Form action used by the queue buttons. */
export async function queueAction(formData: FormData): Promise<void> {
  const action = String(formData.get("action") ?? "");
  const targetType = String(formData.get("target_type") ?? "");
  const targetId = String(formData.get("target_id") ?? "");
  const reportId = Number(formData.get("report_id") ?? 0);
  const authorId = String(formData.get("author_id") ?? "");

  switch (action) {
    case "hide":
      await hideContent(targetType, targetId, true);
      return;
    case "unhide":
      await hideContent(targetType, targetId, false);
      return;
    case "resolve":
      await resolveReport(reportId, "resolved");
      return;
    case "dismiss":
      await resolveReport(reportId, "dismissed");
      return;
    case "mute":
      if (authorId) await sanctionUser(authorId, "chat_mute", "Reported chat", 24);
      return;
    case "suspend":
      if (authorId) await sanctionUser(authorId, "suspension", "Reported content", 24 * 7);
      return;
    case "ban":
      if (authorId) await sanctionUser(authorId, "ban", "Reported content", null);
      return;
    default:
      return;
  }
}

export interface InviteState {
  codes: string[];
  error: string | null;
}

/** Generates invite codes. Admin only; the codes are shown once. */
export async function generateInvites(
  _prev: InviteState,
  formData: FormData,
): Promise<InviteState> {
  const count = Math.min(100, Math.max(1, Number(formData.get("count") ?? 1) || 1));
  const maxUses = Math.min(1000, Math.max(1, Number(formData.get("max_uses") ?? 1) || 1));
  const days = Number(formData.get("days") ?? 0) || 0;
  const expiresAt = days > 0 ? new Date(Date.now() + days * 86_400_000).toISOString() : null;

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_invite_codes", {
    p_count: count,
    p_max_uses: maxUses,
    p_expires_at: expiresAt,
  });
  if (error) return { codes: [], error: friendly(error.message) };
  return { codes: (data as string[] | null) ?? [], error: null };
}

function friendly(message: string): string {
  if (/not allowed|only admins|cannot act|mods can only|at most 24/i.test(message)) {
    return "You can't do that with your role.";
  }
  if (/nothing to change|not found|no active/i.test(message)) {
    return "Already handled.";
  }
  return "That didn't work. Try again.";
}
