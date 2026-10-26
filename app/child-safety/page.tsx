import type { Metadata } from "next";
import Link from "next/link";

import { CONTACT_EMAIL, PolicyNote, PolicyPage } from "@/components/policy-page";

export const metadata: Metadata = { title: "Child safety" };

export default function ChildSafetyPage() {
  return (
    <PolicyPage
      title="Child safety standards"
      lede="Caught Looking is built for teens. Keeping kids safe comes first."
    >
      <section aria-labelledby="zero-tolerance">
        <h2 id="zero-tolerance">Zero tolerance</h2>
        <p>
          We do not allow child sexual abuse or exploitation of any kind. That includes sexual images or videos
          of anyone under 18, grooming, asking a minor for sexual content, and sextortion.
        </p>
        <p>Any account involved is banned right away, and we report it as the law requires.</p>
      </section>

      <section aria-labelledby="prevent">
        <h2 id="prevent">How we prevent it</h2>
        <ul>
          <li>
            <strong>No private messages.</strong> There are no DMs, friend lists or private groups. Everything is
            in public spaces that our team can see.
          </li>
          <li>
            <strong>Contact info is blocked.</strong> Phone numbers, social handles, links and &ldquo;add me
            on&rdquo; messages are filtered out of chat, posts and usernames.
          </li>
          <li>
            <strong>Every video is checked first.</strong> Uploads are scanned, then watched by an adult before
            anyone else can see them.
          </li>
          <li>
            <strong>Hash matching.</strong> Uploads are compared against known child sexual abuse material. A
            match is locked away right away and never shown.
          </li>
          <li>
            <strong>Adults in charge.</strong> Only adult admins handle serious reports, approve uploads and ban
            accounts.
          </li>
          <li>
            <strong>Age check.</strong> Everyone must be 13 or older to join.
          </li>
        </ul>
      </section>

      <section aria-labelledby="report">
        <h2 id="report">How to report</h2>
        <h3>In the app</h3>
        <p>
          Tap <strong>Report</strong> on any post, comment, chat message, poll or profile. Choose{" "}
          <strong>&ldquo;Urgent: someone is in danger&rdquo;</strong> for anything that puts a kid at risk. An
          adult admin is alerted right away and looks within 12 hours.
        </p>
        <h3>By email</h3>
        <p>
          Email {CONTACT_EMAIL}. Include the username and where you saw it. Please don&apos;t send screenshots of
          sexual content involving a minor — just tell us where it is.
        </p>
      </section>

      <section aria-labelledby="law">
        <h2 id="law">What we do with reports</h2>
        <ul>
          <li>We remove the content and ban the account.</li>
          <li>
            We report apparent child sexual abuse material to the National Center for Missing &amp; Exploited
            Children (NCMEC) through its CyberTipline.
          </li>
          <li>We keep the evidence locked away for as long as the law requires, and share it only with NCMEC and law enforcement.</li>
          <li>We work with law enforcement when they ask through proper legal channels.</li>
        </ul>
      </section>

      <section aria-labelledby="named-contact">
        <h2 id="named-contact">Child safety contact</h2>
        <p>
          <strong>Jason Lehmbeck</strong>, adult admin
          <br />
          {CONTACT_EMAIL}
        </p>
        <PolicyNote>
          Jason is responsible for our child safety practices and for reports to NCMEC.
        </PolicyNote>
      </section>

      <section aria-labelledby="crisis">
        <h2 id="crisis">Need help right now?</h2>
        <ul>
          <li>
            If someone is in immediate danger, call <strong>911</strong>.
          </li>
          <li>
            Call or text <strong>988</strong> (Suicide &amp; Crisis Lifeline) any time.
          </li>
          <li>
            Text <strong>HOME</strong> to <strong>741741</strong> (Crisis Text Line).
          </li>
          <li>
            Report exploitation directly to NCMEC at{" "}
            <a href="https://report.cybertip.org" rel="noopener noreferrer">
              report.cybertip.org
            </a>{" "}
            or 1-800-843-5678.
          </li>
        </ul>
        <p>
          See also our <Link href="/rules">house rules</Link> and <Link href="/privacy#parents">notes for parents</Link>.
        </p>
      </section>
    </PolicyPage>
  );
}
