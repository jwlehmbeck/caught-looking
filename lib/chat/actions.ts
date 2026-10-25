"use server";

import { openAiModerator } from "@shared/filters/moderation.ts";
import { filterText } from "@shared/filters/pipeline.ts";

import { SLOW_MODE_CHOICES } from "@/lib/chat/rules";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export interface ChatMessage {
  id: number;
  gameId: number;
  authorId: string | null;
  username: string | null;
  body: string;
  createdAt: string;
}

export interface ChatWindow {
  open: boolean;
  readOnly: boolean;
  canSend: boolean;
  reason:
    | "ok"
    | "pre_lock"
    | "closed"
    | "account_age"
    | "muted"
    | "suspended"
    | "banned"
    | "no_profile"
    | "no_game";
  slowModeSeconds: number;
  /** ISO timestamp when a young account may start chatting. */
  unlocksAt: string | null;
  /** ISO timestamp when the mute or suspension ends (null = open-ended). */
  sanctionEndsAt: string | null;
}

export type SendChatError =
  | "not_signed_in"
  | "pre_lock"
  | "closed"
  | "account_age"
  | "muted"
  | "suspended"
  | "banned"
  | "slow_mode"
  | "too_long"
  | "filtered"
  | "held"
  | "other";

export type SendChatResult = { ok: true; message: ChatMessage } | { ok: false; error: SendChatError; message: string };

const FILTER_REJECT_COPY = "That message can't be posted right now.";

async function viewerId(): Promise<string | null> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const sub = data?.claims?.sub;
  return typeof sub === "string" ? sub : null;
}

interface WindowRow {
  open: boolean;
  read_only: boolean;
  can_send: boolean;
  reason: ChatWindow["reason"];
  slow_mode_seconds: number;
  unlocks_at: string | null;
  sanction_ends_at: string | null;
}

/** What the signed-in viewer may do in this game's room right now. */
export async function getChatWindow(gameId: number): Promise<ChatWindow | null> {
  if (!Number.isInteger(gameId)) return null;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("chat_window", { p_game_id: gameId });
  if (error) return null;
  const row = ((data ?? []) as WindowRow[])[0];
  if (!row) return null;
  return {
    open: row.open,
    readOnly: row.read_only,
    canSend: row.can_send,
    reason: row.reason,
    slowModeSeconds: row.slow_mode_seconds,
    unlocksAt: row.unlocks_at,
    sanctionEndsAt: row.sanction_ends_at,
  };
}

interface HistoryRow {
  id: number;
  game_id: number;
  author_id: string | null;
  username: string | null;
  body: string;
  created_at: string;
}

/** The last 50 live messages, oldest first, minus authors the viewer blocked. */
export async function getChatHistory(gameId: number): Promise<ChatMessage[]> {
  if (!Number.isInteger(gameId)) return [];
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("chat_history", { p_game_id: gameId, p_limit: 50 });
  if (error) return [];
  return ((data ?? []) as HistoryRow[]).map((r) => ({
    id: r.id,
    gameId: r.game_id,
    authorId: r.author_id,
    username: r.username,
    body: r.body,
    createdAt: r.created_at,
  }));
}

/** Ids of the people the viewer has blocked; the room hides their live messages. */
export async function getMyBlocks(): Promise<string[]> {
  const uid = await viewerId();
  if (!uid) return [];
  const supabase = await createClient();
  const { data } = await supabase.from("blocks").select("blocked_id").eq("blocker_id", uid);
  return ((data ?? []) as { blocked_id: string }[]).map((r) => r.blocked_id);
}

function mapDbError(code: string | undefined, message: string): { error: SendChatError; message: string } {
  const m = message.toLowerCase();
  if (code === "P0429") return { error: "slow_mode", message: "Slow mode: wait a moment before sending again." };
  if (code === "P0001" && m.includes("not opened")) return { error: "pre_lock", message: "Chat opens at first pitch." };
  if (code === "P0001") return { error: "closed", message: "Chat is closed for this game." };
  if (code === "42501" && m.includes("too new")) {
    return { error: "account_age", message: "New accounts can chat 24 hours after signing up." };
  }
  if (code === "42501" && m.includes("muted")) return { error: "muted", message: "You're muted in chat right now." };
  if (code === "42501" && m.includes("suspended")) return { error: "suspended", message: "Your account is suspended." };
  if (code === "42501" && m.includes("banned")) return { error: "banned", message: "Your account is banned." };
  if (code === "22023") return { error: "too_long", message: "Keep it to 200 characters." };
  return { error: "other", message: "That didn't send. Try again." };
}

/**
 * Sends a chat message for the signed-in user. The filter pipeline runs
 * first (local checks, then the OpenAI moderation call when a key is set,
 * failing closed); a rejected message never reaches the database, a held
 * one is stored as hidden so staff can review it. Then the service-only
 * `post_chat_message` RPC enforces the window, sanctions, account age,
 * slow mode and length on every send.
 */
export async function sendChatMessage(gameId: number, body: string): Promise<SendChatResult> {
  if (!Number.isInteger(gameId) || typeof body !== "string") {
    return { ok: false, error: "other", message: "That didn't send. Try again." };
  }
  const uid = await viewerId();
  if (!uid) return { ok: false, error: "not_signed_in", message: "Sign in to chat." };

  const trimmed = body.trim();
  if (trimmed.length === 0) return { ok: false, error: "too_long", message: "Say something first." };

  const apiKey = process.env.OPENAI_API_KEY;
  const verdict = await filterText(trimmed, {
    context: "chat",
    moderate: apiKey ? openAiModerator(apiKey) : undefined,
  });
  if (verdict.verdict === "reject") {
    const tooLong = verdict.reason === "too_long";
    return {
      ok: false,
      error: tooLong ? "too_long" : "filtered",
      message: tooLong ? "Keep it to 200 characters." : FILTER_REJECT_COPY,
    };
  }
  const status = verdict.verdict === "flag" ? "hidden" : "live";

  const admin = createAdminClient();
  const { data, error } = await admin.rpc("post_chat_message", {
    p_user_id: uid,
    p_game_id: gameId,
    p_body: trimmed,
    p_status: status,
  });
  if (error) {
    const mapped = mapDbError(error.code, error.message ?? "");
    return { ok: false, ...mapped };
  }
  if (status === "hidden") {
    // Stored for review, never shown to the room.
    return { ok: false, error: "held", message: FILTER_REJECT_COPY };
  }

  const row = data as { id: number; game_id: number; author_id: string | null; body: string; created_at: string };
  const supabase = await createClient();
  const { data: profile } = await supabase.from("profiles").select("username").eq("id", uid).maybeSingle();
  return {
    ok: true,
    message: {
      id: row.id,
      gameId: row.game_id,
      authorId: row.author_id,
      username: (profile as { username: string } | null)?.username ?? null,
      body: row.body,
      createdAt: row.created_at,
    },
  };
}

/** Staff only: 10, 30 or 60 seconds between messages per member in this game. */
export async function setChatSlowMode(gameId: number, seconds: number): Promise<{ ok: boolean; message: string }> {
  if (!Number.isInteger(gameId) || !(SLOW_MODE_CHOICES as readonly number[]).includes(seconds)) {
    return { ok: false, message: "Pick 10, 30 or 60 seconds." };
  }
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_chat_slow_mode", { p_game_id: gameId, p_seconds: seconds });
  if (error) return { ok: false, message: "Couldn't change slow mode." };
  return { ok: true, message: `Slow mode set to ${seconds} seconds.` };
}
