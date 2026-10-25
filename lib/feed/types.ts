/** Shapes shared by the feed server actions and components (plan U10). */

export const FEED_PAGE_SIZE = 20;
export const COMMENT_MAX_LENGTH = 500;

export type PostKind = "mlb_clip" | "fan_edit" | "news";

export interface FeedPost {
  id: number;
  kind: PostKind;
  title: string;
  url: string | null;
  thumbnailPath: string | null;
  durationSeconds: number | null;
  teamId: number | null;
  teamAbbreviation: string | null;
  teamName: string | null;
  gameId: number | null;
  authorId: string | null;
  authorUsername: string | null;
  voteScore: number;
  commentCount: number;
  publishedAt: string;
  viewerVoted: boolean;
}

export interface PostComment {
  id: number;
  postId: number;
  parentId: number | null;
  authorId: string | null;
  username: string | null;
  body: string;
  status: "live" | "hidden";
  createdAt: string;
}

export interface FeedPage {
  posts: FeedPost[];
  /** Offset for the next page, or null when this was the last one. */
  nextOffset: number | null;
}

export type VoteResult = { ok: true; voteScore: number; voted: boolean } | { ok: false; message: string };

export type AddCommentResult =
  | { ok: true; comment: PostComment }
  | {
      ok: false;
      error: "not_signed_in" | "too_long" | "filtered" | "held" | "suspended" | "not_found" | "other";
      message: string;
    };

export interface CreatePostState {
  error: string | null;
  /** Echoed so the form keeps what was typed. */
  values: { title: string; url: string; teamId: string };
}

export const EMPTY_CREATE_POST_STATE: CreatePostState = { error: null, values: { title: "", url: "", teamId: "" } };
