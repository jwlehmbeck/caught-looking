import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { AuthShell } from "@/components/auth-shell";
import { FormNotice } from "@/components/auth-ui";
import { createClient } from "@/lib/supabase/server";

import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Log in" };
export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ created?: string }>;
}) {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (data?.claims) redirect("/");

  const { created } = await searchParams;

  return (
    <AuthShell
      title="Welcome back"
      lede="Username and password. No email needed."
      footer={
        <>
          <p>
            Forgot your password? <Link href="/recover">Use your recovery code</Link>
          </p>
          <p>
            New here? <Link href="/signup">Sign up</Link>
          </p>
        </>
      }
    >
      {created === "1" ? <FormNotice message="Your account is ready. Log in to continue." /> : null}
      <LoginForm />
    </AuthShell>
  );
}
