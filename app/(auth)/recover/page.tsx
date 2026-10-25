import type { Metadata } from "next";
import Link from "next/link";

import { AuthShell } from "@/components/auth-shell";

import { RecoverForm } from "./recover-form";

export const metadata: Metadata = { title: "Recover your account" };
export const dynamic = "force-dynamic";

export default function RecoverPage() {
  return (
    <AuthShell
      title="Get back in"
      lede="Enter your username and the recovery code you saved when you signed up, then choose a new password."
      footer={
        <>
          <p>
            Remembered it? <Link href="/login">Log in</Link>
          </p>
          <p>
            Lost the code too? <Link href="/contact">Contact us</Link>; we may not be able to help, but we&apos;ll try.
          </p>
        </>
      }
    >
      <RecoverForm />
    </AuthShell>
  );
}
