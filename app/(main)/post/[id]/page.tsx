import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { Comments } from "@/components/feed/comments";
import { PostCard } from "@/components/feed/post-card";
import { loadComments, loadPost } from "@/lib/feed/actions";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

function parseId(raw: string): number | null {
  if (!/^\d{1,12}$/.test(raw)) return null;
  const n = Number(raw);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const postId = parseId(id);
  if (postId === null) return { title: "Post" };
  const post = await loadPost(postId);
  return { title: post ? post.title : "Post" };
}

/** One post with its comments. Blocked authors and non-live posts 404. */
export default async function PostPage({ params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const viewerId = claims?.claims?.sub;
  if (typeof viewerId !== "string") redirect("/login");

  const { id } = await params;
  const postId = parseId(id);
  if (postId === null) notFound();

  const [post, comments] = await Promise.all([loadPost(postId), loadComments(postId)]);
  if (!post) notFound();

  return (
    <main className="cl-shell" style={{ paddingTop: 32, paddingBottom: 48, display: "grid", gap: 20 }}>
      <nav aria-label="Breadcrumb" style={{ fontSize: 14, color: "var(--cl-text-muted)" }}>
        <Link href="/feed" style={{ display: "inline-flex", alignItems: "center", minHeight: "var(--cl-tap)" }}>
          ← Feed
        </Link>
      </nav>

      {post.status !== "live" ? (
        <p
          role="status"
          style={{
            padding: 12,
            borderRadius: "var(--cl-radius-sm)",
            background: "var(--cl-bg-raised)",
            border: "1px solid var(--cl-border)",
            fontSize: 14,
          }}
        >
          This post isn&apos;t public right now ({post.status}).
        </p>
      ) : null}

      <PostCard post={post} detail />

      <Comments postId={post.id} initial={comments} viewerId={post.status === "live" ? viewerId : null} />

      <p style={{ fontSize: 12, color: "var(--cl-text-muted)", textAlign: "center" }}>
        Not affiliated with MLB or any club.
      </p>
    </main>
  );
}
