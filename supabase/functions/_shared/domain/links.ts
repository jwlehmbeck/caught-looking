/**
 * Share-link rules (plan U10). Members may share only MLB.com pages and
 * YouTube videos (MLB's official channels; v1 cannot verify the channel
 * server-side, so any well-formed video id is accepted and the post still
 * goes through the title filter and reporting). Everything else is refused.
 *
 * The result carries a canonical URL with tracking parameters stripped, so
 * the same clip shared twice collides on posts.url.
 */
import { checkUrl, type UrlRejection } from "../filters/url.ts";

export const SHARE_HOSTS: readonly string[] = ["mlb.com", "www.mlb.com", "youtube.com", "www.youtube.com", "youtu.be"];

/** Hosts handed to the text filter so a title may mention these links. */
export const SHARE_ALLOW_URLS: readonly string[] = ["mlb.com", "youtube.com", "youtu.be"];

export type ShareKind = "mlb" | "youtube";

export type ShareRejection = UrlRejection | "youtube_id" | "path";

export type ShareUrl =
  | { ok: true; url: string; kind: ShareKind }
  | { ok: false; reason: ShareRejection };

const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;

export const SHARE_REJECTION_MESSAGE = "Links must be to MLB.com or a YouTube video.";

function youtubeId(url: URL): string | null {
  const host = url.hostname.toLowerCase();
  if (host === "youtu.be") {
    const id = url.pathname.split("/").filter(Boolean)[0] ?? "";
    return YOUTUBE_ID.test(id) ? id : null;
  }
  const parts = url.pathname.split("/").filter(Boolean);
  if (url.pathname === "/watch") {
    const id = url.searchParams.get("v") ?? "";
    return YOUTUBE_ID.test(id) ? id : null;
  }
  if (parts.length === 2 && (parts[0] === "shorts" || parts[0] === "live" || parts[0] === "embed")) {
    return YOUTUBE_ID.test(parts[1]) ? parts[1] : null;
  }
  return null;
}

export function canonicalizeShareUrl(raw: string): ShareUrl {
  const check = checkUrl(raw, SHARE_HOSTS);
  if (!check.ok) return { ok: false, reason: check.reason };

  const { url, host } = check;

  if (host === "mlb.com" || host === "www.mlb.com") {
    // MLB.com pages carry no meaningful query: drop it and the fragment.
    const path = url.pathname.replace(/\/+$/, "") || "/";
    if (path === "/") return { ok: false, reason: "path" };
    return { ok: true, url: `https://www.mlb.com${path}`, kind: "mlb" };
  }

  if (host === "youtube.com" || host === "www.youtube.com" || host === "youtu.be") {
    const id = youtubeId(url);
    if (!id) return { ok: false, reason: "youtube_id" };
    return { ok: true, url: `https://www.youtube.com/watch?v=${id}`, kind: "youtube" };
  }

  return { ok: false, reason: "host" };
}

/** Which site a stored post link opens, for the "Opens on …" label. */
export function linkDestination(url: string | null | undefined): "MLB.com" | "YouTube" | null {
  if (!url) return null;
  if (/^https:\/\/(www\.)?mlb\.com\//i.test(url)) return "MLB.com";
  if (/^https:\/\/(www\.)?youtube\.com\//i.test(url) || /^https:\/\/youtu\.be\//i.test(url)) return "YouTube";
  return null;
}
