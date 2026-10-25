"use client";

import { useSyncExternalStore } from "react";

const subscribeNoop = () => () => {};
const getClientSnapshot = () => true;
const getServerSnapshot = () => false;

interface LocalTimeProps {
  /** ISO timestamp (UTC in the database). */
  iso: string;
  /** "time" renders "5:08 PM" (plus the date when not today); "date" renders "Wed, Oct 21". */
  mode?: "time" | "date";
  style?: React.CSSProperties;
  className?: string;
}

function isSameLocalDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

export function formatLocalTime(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  if (isSameLocalDay(d, now)) return time;
  const date = d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  return `${date} · ${time}`;
}

export function formatLocalDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

/**
 * Formats a UTC timestamp in the device's timezone. The server renders a
 * UTC-based placeholder; the client replaces it after mount so the text
 * never mismatches during hydration.
 */
export function LocalTime({ iso, mode = "time", style, className }: LocalTimeProps) {
  // false during server render and hydration, true once the client takes over.
  const mounted = useSyncExternalStore(subscribeNoop, getClientSnapshot, getServerSnapshot);
  const text = mounted ? (mode === "date" ? formatLocalDate(iso) : formatLocalTime(iso)) : null;

  const fallback =
    mode === "date"
      ? new Date(iso).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" })
      : new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "UTC" }) + " UTC";

  return (
    <time dateTime={iso} style={style} className={className} suppressHydrationWarning>
      {text ?? fallback}
    </time>
  );
}
