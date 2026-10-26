import type { Metadata } from "next";
import Link from "next/link";

import { CONTACT_EMAIL, DMCA_AGENT, PolicyNote, PolicyPage } from "@/components/policy-page";

export const metadata: Metadata = { title: "Contact" };

export default function ContactPage() {
  return (
    <PolicyPage title="Contact us" lede="Questions, appeals, safety worries or copyright notices — here's how to reach us.">
      <section aria-labelledby="email">
        <h2 id="email">Email</h2>
        <p>
          <strong>{CONTACT_EMAIL}</strong>
        </p>
        <p>Adults run Caught Looking, and an adult reads every message.</p>
        <PolicyNote>
          If someone is in danger, don&apos;t wait for email. Use Report → &ldquo;Urgent&rdquo; in the app, call or
          text 988, or text HOME to 741741. In an emergency, call 911.
        </PolicyNote>
      </section>

      <section aria-labelledby="include">
        <h2 id="include">What to include</h2>
        <ul>
          <li>Your username (if you have one).</li>
          <li>What happened, and where in the app (game, post or chat).</li>
          <li>About when it happened.</li>
        </ul>
        <p>Please don&apos;t send your password, recovery code, real name, phone number or address.</p>
      </section>

      <section aria-labelledby="response">
        <h2 id="response">When we&apos;ll answer</h2>
        <ul>
          <li>
            <strong>Urgent safety issues:</strong> within 12 hours.
          </li>
          <li>
            <strong>Everything else:</strong> within 2 days.
          </li>
          <li>
            <strong>Appeals:</strong> a decision within 7 days.
          </li>
        </ul>
      </section>

      <section aria-labelledby="appeal">
        <h2 id="appeal">Appeals</h2>
        <p>
          Think a hide, mute, suspension or ban was a mistake? Email us with your username, what happened and why
          you think we got it wrong. See <Link href="/rules#appeals">how appeals work</Link>.
        </p>
      </section>

      <section aria-labelledby="dmca">
        <h2 id="dmca">Copyright (DMCA) notices</h2>
        <p>Send copyright notices and counter-notices to our designated agent:</p>
        <p>
          <strong>{DMCA_AGENT}</strong>
          <br />
          {CONTACT_EMAIL}
        </p>
        <p>
          What to include is listed in our <Link href="/terms#copyright">terms</Link>.
        </p>
      </section>

      <section aria-labelledby="parents">
        <h2 id="parents">Parents and guardians</h2>
        <p>
          You can email us to ask about your teen&apos;s account, ask us to delete it, or tell us about a child under
          13. Include the username. Read more in our <Link href="/privacy#parents">privacy notice</Link> and{" "}
          <Link href="/child-safety">child safety standards</Link>.
        </p>
      </section>
    </PolicyPage>
  );
}
