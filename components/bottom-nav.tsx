"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type Section = "feed" | "games" | "new" | "ranks" | "profile";

/** Which bottom-nav item a path belongs to (exported for tests). */
export function navSection(pathname: string): Section | null {
  if (pathname === "/" || pathname === "/feed" || (pathname.startsWith("/post/") && pathname !== "/post/new")) return "feed";
  if (pathname === "/post/new") return "new";
  if (pathname === "/picks" || pathname.startsWith("/game/")) return "games";
  if (pathname === "/leaderboard" || pathname.startsWith("/leaderboard/")) return "ranks";
  if (pathname === "/profile" || pathname.startsWith("/profile/")) return "profile";
  return null;
}

/** Bar height above the safe area. `app/(main)/layout.tsx` pads pages by a little more than this. */
const BOTTOM_NAV_HEIGHT = 64;

const ICONS: Record<Exclude<Section, "new">, React.ReactNode> = {
  feed: <path d="M3 11l9-7 9 7v9H3z" />,
  games: <path d="M12 3l9 9-9 9-9-9z" />,
  ranks: <path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0z" />,
  profile: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21a8 8 0 0 1 16 0" />
    </>
  ),
};

const ITEMS: { id: Exclude<Section, "new">; href: string; label: string }[] = [
  { id: "feed", href: "/", label: "Feed" },
  { id: "games", href: "/picks", label: "Games" },
  { id: "ranks", href: "/leaderboard", label: "Ranks" },
  { id: "profile", href: "/profile", label: "Profile" },
];

function itemStyle(on: boolean): React.CSSProperties {
  return {
    minHeight: "var(--cl-tap)",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: 3,
    color: on ? "var(--cl-accent)" : "var(--cl-text-muted)",
    fontSize: 11,
    fontWeight: on ? 700 : 500,
    // The active item is also bold and underlined, so it never relies on color alone.
    textDecoration: on ? "underline" : "none",
    textUnderlineOffset: 3,
  };
}

function NavItem({ id, href, label, current }: { id: Exclude<Section, "new">; href: string; label: string; current: Section | null }) {
  const on = current === id;
  return (
    <Link href={href} aria-current={on ? "page" : undefined} style={itemStyle(on)}>
      <svg
        width="22"
        height="22"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        {ICONS[id]}
      </svg>
      {label}
    </Link>
  );
}

/**
 * The five-item bar fixed to the bottom of every main page: Feed, Games,
 * a big amber "+" for a new post, Ranks, Profile. Mounted once in
 * `app/(main)/layout.tsx`, which also pads the page so nothing hides under it.
 */
export function BottomNav() {
  const current = navSection(usePathname() ?? "/");
  const [feed, games, ranks, profile] = ITEMS;
  const newOn = current === "new";

  return (
    <nav
      aria-label="Main"
      style={{
        position: "fixed",
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 20,
        background: "var(--cl-bg-nav)",
        borderTop: "1px solid var(--cl-border)",
        paddingBottom: "env(safe-area-inset-bottom, 0px)",
      }}
    >
      <div
        style={{
          maxWidth: "var(--cl-max-width)",
          margin: "0 auto",
          minHeight: BOTTOM_NAV_HEIGHT,
          padding: "6px 4px",
          display: "grid",
          gridTemplateColumns: "repeat(5, minmax(0, 1fr))",
          alignItems: "center",
        }}
      >
        <NavItem {...feed} current={current} />
        <NavItem {...games} current={current} />
        <Link
          href="/post/new"
          aria-label="New post"
          aria-current={newOn ? "page" : undefined}
          style={{ minHeight: "var(--cl-tap)", display: "flex", alignItems: "center", justifyContent: "center" }}
        >
          <span
            style={{
              width: 48,
              height: 48,
              borderRadius: 24,
              background: "var(--cl-accent)",
              color: "var(--cl-on-accent)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              outline: newOn ? "2px solid var(--cl-text)" : "none",
              outlineOffset: 2,
            }}
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true">
              <path d="M12 5v14M5 12h14" />
            </svg>
          </span>
        </Link>
        <NavItem {...ranks} current={current} />
        <NavItem {...profile} current={current} />
      </div>
    </nav>
  );
}
