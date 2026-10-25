"use client";

import { useSyncExternalStore } from "react";

const subscribeNoop = () => () => {};
const getClientSnapshot = () => true;
const getServerSnapshot = () => false;

export function formatTimeAgo(iso: string, now: Date = new Date()): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "";
  const seconds = Math.max(0, Math.round((now.getTime() - t) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/**
 * "3h ago" style stamp. The server renders a UTC date so nothing mismatches
 * during hydration; the client swaps in the relative form after mount.
 */
export function TimeAgo({ iso, style }: { iso: string; style?: React.CSSProperties }) {
  const mounted = useSyncExternalStore(subscribeNoop, getClientSnapshot, getServerSnapshot);
  const fallback = new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  return (
    <time dateTime={iso} style={style} suppressHydrationWarning>
      {mounted ? formatTimeAgo(iso) : fallback}
    </time>
  );
}
