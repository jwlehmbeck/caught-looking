import { createClient } from "@/lib/supabase/server";

// Signed-out visitors never reach this page: proxy.ts redirects them to
// /signup. The real feed home screen arrives in U7.
export default async function Home() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();

  return (
    <main className="cl-shell" style={{ paddingTop: 52 }}>
      <h1 style={{ fontSize: 28 }}>
        CAUGHT <span style={{ color: "var(--cl-accent)" }}>LOOKING</span>
      </h1>
      <p style={{ color: "var(--cl-text-muted)", marginTop: 12 }}>
        Signed in as {String(data?.claims?.sub ?? "unknown")}. The feed is on
        its way.
      </p>
    </main>
  );
}
