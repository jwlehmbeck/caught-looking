import { BottomNav } from "@/components/bottom-nav";

/** The bottom bar is 64 px plus a 1 px border; leave a little extra room. */
const NAV_CLEARANCE = 72;

/**
 * Shell for every signed-in main page: the page itself, then the fixed
 * bottom navigation. The padding keeps the end of each page clear of the bar.
 */
export default function MainLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <div style={{ paddingBottom: `calc(${NAV_CLEARANCE}px + env(safe-area-inset-bottom, 0px))` }}>{children}</div>
      <BottomNav />
    </>
  );
}
