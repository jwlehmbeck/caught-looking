"use server";

import { redirect } from "next/navigation";

import { closesAtFor, validatePollInput, type PollView } from "@/lib/polls/rules";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { openAiModerator } from "@shared/filters/moderation.ts";
import { filterText } from "@shared/filters/pipeline.ts";

export interface ActionResult {
  ok: boolean;
  message: string;
}

export type CreatePollState = { ok: false; message: string } | null;

export type VotePollResult = { ok: true; poll: PollView } | { ok: false; message: string };

const FILTER_REJECT_COPY = "That text can't be used in a poll. Try different words.";

async function viewer(): Promise<{ id: string; role: string | null } | null> {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const id = claims?.claims?.sub;
  if (typeof id !== "string") return null;
  const { data: role } = await supabase.rpc("my_role");
  return { id, role: typeof role === "string" ? role : null };
}

/**
 * Poll text through the one filter pipeline, fail-closed: a `flag` (the
 * moderation call errored or timed out) is treated as a reject, because a
 * poll is staff-authored, visible to everyone and has no "held" state.
 */
async function pollTextAllowed(text: string): Promise<boolean> {
  const apiKey = process.env.OPENAI_API_KEY;
  const verdict = await filterText(text, {
    context: "poll",
    moderate: apiKey ? openAiModerator(apiKey) : undefined,
  });
  return verdict.verdict === "allow";
}

function smallIntOrNull(raw: FormDataEntryValue | null): number | null {
  if (typeof raw !== "string" || raw.trim() === "") return null;
  const n = Number.parseInt(raw, 10);
  return Number.isInteger(n) && n > 0 && n < 1000 ? n : null;
}

/**
 * Staff create a poll. Validates lengths and counts, filters the question
 * and every option, then calls the service-only `create_poll` RPC with the
 * staff user's id (the database re-checks the role). Redirects to the new
 * poll on success; returns a message for the form otherwise.
 */
export async function createPoll(_prev: CreatePollState, formData: FormData): Promise<CreatePollState> {
  const me = await viewer();
  if (!me) return { ok: false, message: "Sign in first." };
  if (me.role !== "mod" && me.role !== "admin") {
    return { ok: false, message: "Only mods and admins can create polls." };
  }

  const question = String(formData.get("question") ?? "");
  const options = [0, 1, 2, 3].map((i) => String(formData.get(`option_${i}`) ?? ""));
  const valid = validatePollInput(question, options);
  if (!valid.ok) return valid;

  const closesAt = closesAtFor(String(formData.get("closes_in") ?? ""));
  if (!closesAt) return { ok: false, message: "Pick when the poll closes." };

  const teamA = smallIntOrNull(formData.get("team_a"));
  const teamB = smallIntOrNull(formData.get("team_b"));
  if (teamA !== null && teamB !== null && teamA === teamB) {
    return { ok: false, message: "Pick two different teams, or leave one blank." };
  }
  const gameRaw = formData.get("game_id");
  let gameId: number | null = null;
  if (typeof gameRaw === "string" && gameRaw.trim() !== "") {
    gameId = Number.parseInt(gameRaw, 10);
    if (!Number.isInteger(gameId) || gameId <= 0) return { ok: false, message: "That game id doesn't look right." };
  }

  for (const text of [valid.question, ...valid.options]) {
    if (!(await pollTextAllowed(text))) return { ok: false, message: FILTER_REJECT_COPY };
  }

  const admin = createAdminClient();
  const { data, error } = await admin.rpc("create_poll", {
    p_user_id: me.id,
    p_question: valid.question,
    p_options: valid.options,
    p_closes_at: closesAt.toISOString(),
    p_team_a: teamA,
    p_team_b: teamB,
    p_game_id: gameId,
  });
  if (error) {
    if (error.code === "42501") return { ok: false, message: "Only mods and admins can create polls." };
    if (error.code === "22023") return { ok: false, message: error.message };
    return { ok: false, message: "Couldn't create that poll. Try again." };
  }
  redirect(`/polls/${data as number}`);
}

/** One vote per user, as the signed-in user, through `vote_poll`. */
export async function votePoll(pollId: number, optionId: number): Promise<VotePollResult> {
  if (!Number.isInteger(pollId) || !Number.isInteger(optionId)) {
    return { ok: false, message: "That vote didn't go through." };
  }
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("vote_poll", { p_poll_id: pollId, p_option_id: optionId });
  if (error) {
    switch (error.code) {
      case "23505":
        return { ok: false, message: "You already voted in this poll." };
      case "P0001":
        return { ok: false, message: "This poll is closed." };
      case "42501":
        return {
          ok: false,
          message: /suspended/i.test(error.message) ? "Your account is suspended, so you can't vote right now." : "Sign in to vote.",
        };
      default:
        return { ok: false, message: "That vote didn't go through. Try again." };
    }
  }
  return { ok: true, poll: data as PollView };
}

export async function closePoll(pollId: number): Promise<ActionResult> {
  if (!Number.isInteger(pollId)) return { ok: false, message: "Poll not found." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("close_poll", { p_poll_id: pollId });
  if (error) {
    if (error.code === "42501") return { ok: false, message: "Only mods and admins can close polls." };
    return { ok: false, message: "Couldn't close that poll. It may already be closed." };
  }
  return { ok: true, message: "Poll closed." };
}

export async function hidePoll(pollId: number): Promise<ActionResult> {
  if (!Number.isInteger(pollId)) return { ok: false, message: "Poll not found." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("hide_poll", { p_poll_id: pollId });
  if (error) {
    if (error.code === "42501") return { ok: false, message: "Only mods and admins can hide polls." };
    return { ok: false, message: "Couldn't hide that poll." };
  }
  return { ok: true, message: "Poll hidden." };
}
