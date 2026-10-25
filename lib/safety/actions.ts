"use server";

import {
  REPORT_CATEGORIES,
  REPORT_TARGET_TYPES,
  type ReportTargetType,
} from "@/lib/safety/categories";
import { createClient } from "@/lib/supabase/server";

const CATEGORY_VALUES: readonly string[] = REPORT_CATEGORIES.map((c) => c.value);

export interface ActionResult {
  ok: boolean;
  message: string;
}

/**
 * Files a report through the `file_report` RPC as the signed-in user. The
 * database enforces the 20-a-day limit and dedupes repeat reports.
 */
export async function fileReport(input: {
  targetType: string;
  targetId: string;
  category: string;
  details?: string;
}): Promise<ActionResult> {
  if (!REPORT_TARGET_TYPES.includes(input.targetType as ReportTargetType)) {
    return { ok: false, message: "That can't be reported." };
  }
  if (!CATEGORY_VALUES.includes(input.category)) {
    return { ok: false, message: "Pick a reason." };
  }
  const details = (input.details ?? "").trim().slice(0, 500);

  const supabase = await createClient();
  const { error } = await supabase.rpc("file_report", {
    p_target_type: input.targetType,
    p_target_id: String(input.targetId),
    p_category: input.category,
    p_details: details.length ? details : null,
  });

  if (error) {
    if (error.code === "P0001") {
      return { ok: false, message: "You've hit today's report limit. Try again tomorrow." };
    }
    return { ok: false, message: "That report didn't go through. Try again." };
  }
  return { ok: true, message: "Thanks. A moderator will take a look." };
}

export async function blockUser(userId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("block_user", { p_user_id: userId });
  if (error) return { ok: false, message: "Couldn't block that user. Try again." };
  return { ok: true, message: "Blocked. You won't see their posts, comments or chat." };
}

export async function unblockUser(userId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("unblock_user", { p_user_id: userId });
  if (error) return { ok: false, message: "Couldn't unblock that user. Try again." };
  return { ok: true, message: "Unblocked." };
}
