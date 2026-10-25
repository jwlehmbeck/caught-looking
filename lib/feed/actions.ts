"use server";

import { redirect } from "next/navigation";

import { canonicalizeShareUrl, SHARE_ALLOW_URLS, SHARE_REJECTION_MESSAGE } from "@shared/domain/links.ts";
import { isFeedTab, type FeedTab } from "@shared/domain/hot-score.ts";
import { openAiModerator } from "@shared/filters/moderation.ts";
import { filterText } from "@shared/filters/pipeline.ts";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

import {
  COMMENT_MAX_LENGTH,
  FEED_PAGE_SIZE,
  type AddCommentResult,
  type CreatePostState,
  type FeedPage,
  type FeedPost,
  type PostComment,
  type PostKind,
  type VoteResult,
} from "@/lib/feed/types";

interface CardRow {
  id: number;
  kind: PostKind;
  status?: string;
  title: string;
  url: string | null;
  thumbnail_path: string | null;
  duration_seconds: number | null;
  team_id: number | null;
  team_abbreviation: string | null;
  team_name: string | null;
  game_id: number | null;
  author_id: string | null;
  author_username: string | null;
  vote_score: number;
  comment_count: number;
  published_at: string;
  viewer_voted: boolean;
}

function toPost(r: CardRow): FeedPost {
  return {
    id: r.id,
    kind: r.kind,
    title: r.title,
    url: r.url,
    thumbnailPath: r.thumbnail_path,
    durationSeconds: r.duration_seconds,
    teamId: r.team_id,
    teamAbbreviation: r.team_abbreviation,
    teamName: r.team_name,
    gameId: r.game_id,
    authorId: r.author_id,
    authorUsername: r.author_username,
    voteScore: r.vote_score,
    commentCount: r.comment_count,
    publishedAt: r.published_at,
    viewerVoted: r.viewer_voted,
  };
}

async function viewerId(): Promise<string | null> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const sub = data?.claims?.sub;
  return typeof sub === "string" ? sub : null;
}

/** One page of the feed for the signed-in viewer (blocked authors already removed). */
export async function loadFeed(tab: string, offset = 0): Promise<FeedPage> {
  const safeTab: FeedTab = isFeedTab(tab) ? tab : "hot";
  const safeOffset = Number.isInteger(offset) && offset > 0 ? offset : 0;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("feed", {
    p_tab: safeTab,
    p_offset: safeOffset,
    p_limit: FEED_PAGE_SIZE + 1,
  });
  if (error) return { posts: [], nextOffset: null };
  const rows = (data ?? []) as CardRow[];
  const hasMore = rows.length > FEED_PAGE_SIZE;
  return {
    posts: rows.slice(0, FEED_PAGE_SIZE).map(toPost),
    nextOffset: hasMore ? safeOffset + FEED_PAGE_SIZE : null,
  };
}

export async function loadPost(postId: number): Promise<(FeedPost & { status: string }) | null> {
  if (!Number.isInteger(postId)) return null;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("post_detail", { p_post_id: postId });
  if (error) return null;
  const row = ((data ?? []) as CardRow[])[0];
  if (!row) return null;
  return { ...toPost(row), status: row.status ?? "live" };
}

interface CommentRow {
  id: number;
  post_id: number;
  parent_id: number | null;
  author_id: string | null;
  username: string | null;
  body: string;
  status: "live" | "hidden";
  created_at: string;
}

function toComment(r: CommentRow): PostComment {
  return {
    id: r.id,
    postId: r.post_id,
    parentId: r.parent_id,
    authorId: r.author_id,
    username: r.username,
    body: r.body,
    status: r.status,
    createdAt: r.created_at,
  };
}

export async function loadComments(postId: number): Promise<PostComment[]> {
  if (!Number.isInteger(postId)) return [];
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("post_comments", { p_post_id: postId });
  if (error) return [];
  return ((data ?? []) as CommentRow[]).map(toComment);
}

/** Votes, or takes the vote back, through the `toggle_vote` RPC. */
export async function toggleVote(postId: number): Promise<VoteResult> {
  if (!Number.isInteger(postId)) return { ok: false, message: "That didn't go through." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("toggle_vote", { p_post_id: postId });
  if (error) {
    if (error.code === "42501" && /suspended/i.test(error.message)) {
      return { ok: false, message: "Your account is suspended." };
    }
    if (error.code === "42501") return { ok: false, message: "Sign in to vote." };
    return { ok: false, message: "That didn't go through. Try again." };
  }
  const row = ((data ?? []) as { vote_score: number; voted: boolean }[])[0];
  if (!row) return { ok: false, message: "That didn't go through. Try again." };
  return { ok: true, voteScore: row.vote_score, voted: row.voted };
}

const COMMENT_REJECT_COPY = "That comment can't be posted right now.";

/**
 * Adds a comment for the signed-in user. The filter pipeline runs first
 * (local checks, then the moderation call when a key is set, failing
 * closed): a rejected comment never reaches the database; a held one is
 * stored as hidden for staff and the author sees a neutral message. Then
 * the service-only `add_comment` RPC enforces sanctions, length, the live
 * post and the one-reply-level rule.
 */
export async function addComment(postId: number, body: string, parentId: number | null = null): Promise<AddCommentResult> {
  if (!Number.isInteger(postId) || typeof body !== "string" || (parentId !== null && !Number.isInteger(parentId))) {
    return { ok: false, error: "other", message: "That didn't post. Try again." };
  }
  const uid = await viewerId();
  if (!uid) return { ok: false, error: "not_signed_in", message: "Sign in to comment." };

  const trimmed = body.trim();
  if (trimmed.length === 0) return { ok: false, error: "too_long", message: "Say something first." };
  if (Array.from(trimmed).length > COMMENT_MAX_LENGTH) {
    return { ok: false, error: "too_long", message: `Keep it to ${COMMENT_MAX_LENGTH} characters.` };
  }

  const apiKey = process.env.OPENAI_API_KEY;
  const verdict = await filterText(trimmed, {
    context: "comment",
    moderate: apiKey ? openAiModerator(apiKey) : undefined,
  });
  if (verdict.verdict === "reject") {
    const tooLong = verdict.reason === "too_long";
    return {
      ok: false,
      error: tooLong ? "too_long" : "filtered",
      message: tooLong ? `Keep it to ${COMMENT_MAX_LENGTH} characters.` : COMMENT_REJECT_COPY,
    };
  }
  const status = verdict.verdict === "flag" ? "hidden" : "live";

  const admin = createAdminClient();
  const { data, error } = await admin.rpc("add_comment", {
    p_user_id: uid,
    p_post_id: postId,
    p_body: trimmed,
    p_parent_id: parentId,
    p_status: status,
  });
  if (error) {
    if (error.code === "42501" && /suspended/i.test(error.message)) {
      return { ok: false, error: "suspended", message: "Your account is suspended." };
    }
    if (error.code === "P0002") return { ok: false, error: "not_found", message: "That post isn't available." };
    if (error.code === "23514") return { ok: false, error: "other", message: "Replies can only go one level deep." };
    if (error.code === "22023") return { ok: false, error: "too_long", message: `Keep it to ${COMMENT_MAX_LENGTH} characters.` };
    return { ok: false, error: "other", message: "That didn't post. Try again." };
  }
  if (status === "hidden") {
    return { ok: false, error: "held", message: COMMENT_REJECT_COPY };
  }

  const row = data as { id: number; post_id: number; author_id: string | null; parent_id: number | null; body: string; created_at: string };
  const supabase = await createClient();
  const { data: profile } = await supabase.from("profiles").select("username").eq("id", uid).maybeSingle();
  return {
    ok: true,
    comment: {
      id: row.id,
      postId: row.post_id,
      parentId: row.parent_id,
      authorId: row.author_id,
      username: (profile as { username: string } | null)?.username ?? null,
      body: row.body,
      status: "live",
      createdAt: row.created_at,
    },
  };
}

function field(formData: FormData, name: string): string {
  const v = formData.get(name);
  return typeof v === "string" ? v : "";
}

/**
 * Shares an MLB.com or YouTube link as a post. Server-side: canonicalize the
 * link (allow-list, tracking stripped), filter the title, then the
 * service-only `create_link_post` RPC checks sanctions and the link shape
 * again. Redirects to the new post on success.
 */
export async function createLinkPost(_prev: CreatePostState, formData: FormData): Promise<CreatePostState> {
  const values = {
    title: field(formData, "title").trim(),
    url: field(formData, "url").trim(),
    teamId: field(formData, "team_id"),
  };
  const fail = (error: string): CreatePostState => ({ error, values });

  const uid = await viewerId();
  if (!uid) redirect("/login");

  if (values.title.length === 0) return fail("Give it a title.");
  if (Array.from(values.title).length > 140) return fail("Keep the title to 140 characters.");

  const link = canonicalizeShareUrl(values.url);
  if (!link.ok) return fail(SHARE_REJECTION_MESSAGE);

  const teamId = values.teamId === "" ? null : Number.parseInt(values.teamId, 10);
  if (teamId !== null && !Number.isInteger(teamId)) return fail("Pick a team or leave it blank.");

  const apiKey = process.env.OPENAI_API_KEY;
  const verdict = await filterText(values.title, {
    context: "title",
    allowUrls: SHARE_ALLOW_URLS,
    moderate: apiKey ? openAiModerator(apiKey) : undefined,
  });
  if (verdict.verdict !== "allow") {
    // A held title is not stored: there is no pending state for link posts.
    return fail("That title can't be posted right now.");
  }

  const admin = createAdminClient();
  const { data, error } = await admin.rpc("create_link_post", {
    p_user_id: uid,
    p_title: values.title,
    p_url: link.url,
    p_team_id: teamId,
    p_game_id: null,
  });
  if (error) {
    if (error.code === "23505") return fail("Someone already shared that link.");
    if (error.code === "42501" && /suspended/i.test(error.message)) return fail("Your account is suspended.");
    if (error.code === "22023" && /link/i.test(error.message)) return fail(SHARE_REJECTION_MESSAGE);
    return fail("That didn't post. Try again.");
  }
  const postId = typeof data === "number" ? data : Number(data);
  redirect(Number.isInteger(postId) ? `/post/${postId}` : "/feed");
}
