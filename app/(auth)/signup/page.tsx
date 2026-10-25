import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { AuthShell } from "@/components/auth-shell";
import { FormNotice } from "@/components/auth-ui";
import { birthYearOptions } from "@/lib/auth/age";
import { SIGNUP_STEPS, isSignupStep, type SignupStep } from "@/lib/auth/flow";
import { readSignupStatus, stepIndex } from "@/lib/auth/signup-state";
import { createClient } from "@/lib/supabase/server";

import {
  AgeForm,
  InviteForm,
  PasswordForm,
  RulesForm,
  TeamForm,
  UsernameForm,
  type TeamOption,
} from "./steps";

export const metadata: Metadata = { title: "Sign up" };
export const dynamic = "force-dynamic";

const COPY: Record<SignupStep, { title: string; lede: string }> = {
  age: { title: "When were you born?", lede: "Just the month and year." },
  invite: { title: "Got an invite code?", lede: "Caught Looking is invite-only for now." },
  rules: { title: "House rules", lede: "Short version. The full rules and terms are linked below." },
  username: { title: "Pick a username", lede: "This is how everyone will know you." },
  team: { title: "Who's your team?", lede: "Your picks and the fan-base board follow this." },
  password: { title: "Set a password", lede: "You'll use your username and this password to log in anywhere." },
};

/** The neutral screen for a device that answered under 13. Says nothing about age. */
function BlockedScreen() {
  return (
    <AuthShell title="Thanks for your interest.">
      <p>You can&apos;t create an account right now.</p>
      <p style={{ color: "var(--cl-text-muted)" }}>
        Already have one? <Link href="/login">Log in</Link>.
      </p>
    </AuthShell>
  );
}

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ step?: string; deleted?: string; retry?: string }>;
}) {
  const [{ step: stepParam, deleted, retry }, status] = await Promise.all([searchParams, readSignupStatus()]);

  if (status.blocked) return <BlockedScreen />;

  // A signed-in visitor only belongs here to finish the recovery-code screen.
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const signedIn = Boolean(claims?.claims);

  const requested: SignupStep = isSignupStep(stepParam) ? stepParam : "age";
  if (signedIn && requested !== "password") redirect("/");
  let step: SignupStep = signedIn && requested === "password" ? "password" : requested;
  if (!signedIn && stepIndex(step) > stepIndex(status.furthest)) step = status.furthest;
  if (step === "invite" && status.publicOpen) step = status.furthest === "age" ? "age" : "rules";

  const visibleSteps = SIGNUP_STEPS.filter((s) => !(s === "invite" && status.publicOpen));
  const progress = `Step ${visibleSteps.indexOf(step) + 1} of ${visibleSteps.length}`;

  let teams: TeamOption[] = [];
  if (step === "team") {
    const { data } = await supabase
      .from("teams")
      .select("id, abbreviation, name, city, color_primary, color_secondary")
      .order("abbreviation");
    teams = (data ?? []) as TeamOption[];
  }

  const { title, lede } = COPY[step];

  return (
    <AuthShell
      title={title}
      lede={lede}
      progress={progress}
      footer={
        <>
          {signedIn ? null : (
            <p>
              Already have an account? <Link href="/login">Log in</Link>
            </p>
          )}
          {step !== "age" && !signedIn ? (
            <p>
              <Link href={`/signup?step=${visibleSteps[Math.max(0, visibleSteps.indexOf(step) - 1)]}`}>Back</Link>
            </p>
          ) : null}
        </>
      }
    >
      {deleted === "1" ? <FormNotice message="Your account has been deleted." /> : null}
      {step === "age" ? <AgeForm years={birthYearOptions()} /> : null}
      {step === "invite" ? <InviteForm retry={retry === "1"} /> : null}
      {step === "rules" ? <RulesForm /> : null}
      {step === "username" ? <UsernameForm retry={retry === "1"} /> : null}
      {step === "team" ? <TeamForm teams={teams} /> : null}
      {step === "password" ? <PasswordForm /> : null}
    </AuthShell>
  );
}
