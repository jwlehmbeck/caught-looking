import { redirect } from "next/navigation";

import { isFeedTab } from "@shared/domain/hot-score.ts";

/** The feed lives on the home screen now (U7); old links land there. */
export default async function FeedPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { tab } = await searchParams;
  redirect(isFeedTab(tab) && tab !== "hot" ? `/?tab=${tab}` : "/");
}
