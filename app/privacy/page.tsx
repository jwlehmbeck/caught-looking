import type { Metadata } from "next";
import Link from "next/link";

import { CONTACT_EMAIL, PolicyNote, PolicyPage } from "@/components/policy-page";

export const metadata: Metadata = { title: "Privacy" };

export default function PrivacyPage() {
  return (
    <PolicyPage
      title="Privacy notice"
      lede="What we know about you, why, and how long we keep it. Short version: as little as we can."
      draft
    >
      <section aria-labelledby="collect">
        <h2 id="collect">What we collect</h2>
        <ul>
          <li>
            <strong>Your username</strong> and <strong>favorite team</strong>. Other members can see these.
          </li>
          <li>
            <strong>Your birth year.</strong> We use it to make sure you&apos;re 13 or older. Only you and our
            adult admins can see it. We don&apos;t keep your birth month.
          </li>
          <li>
            <strong>Your password</strong>, stored scrambled (a &ldquo;hash&rdquo;) so even we can&apos;t read it.
            Your recovery code is stored the same way.
          </li>
          <li>
            <strong>Your picks</strong>, badges and stats.
          </li>
          <li>
            <strong>What you post</strong>: chat messages, posts, comments, polls, votes, reports and uploaded
            videos.
          </li>
          <li>
            <strong>Security logs</strong> based on your internet (IP) address, scrambled where we can. We use
            them to stop people from guessing passwords and making fake accounts.
          </li>
        </ul>
      </section>

      <section aria-labelledby="dont">
        <h2 id="dont">What we don&apos;t collect</h2>
        <ul>
          <li>Your real name</li>
          <li>Your email address or phone number</li>
          <li>Photos of you</li>
          <li>Your location</li>
          <li>Your contacts</li>
        </ul>
        <PolicyNote>We don&apos;t sell your information, and we don&apos;t show ads.</PolicyNote>
      </section>

      <section aria-labelledby="why">
        <h2 id="why">Why we use it</h2>
        <ul>
          <li>To run your account and let you log in.</li>
          <li>To score your picks and show leaderboards.</li>
          <li>To show your posts and chat to other members.</li>
          <li>To keep people safe: check content, handle reports and stop abuse.</li>
          <li>To follow the law.</li>
        </ul>
      </section>

      <section aria-labelledby="processors">
        <h2 id="processors">Companies that help us</h2>
        <p>A few companies handle data for us. They may only use it to do this work.</p>
        <ul>
          <li>
            <strong>Supabase</strong> hosts our database, accounts and files.
          </li>
          <li>
            <strong>OpenAI</strong> checks text (like chat messages and post titles) for harmful content. We send
            only the text — never your username or account id.
          </li>
          <li>
            <strong>Amazon Web Services (AWS)</strong> scans uploaded videos for unsafe content. We send only
            the video, and the copy is deleted after the scan.
          </li>
          <li>
            <strong>Cloudflare Turnstile</strong> checks that you&apos;re a person, not a bot, when you sign up or
            log in.
          </li>
        </ul>
        <p>
          We may also share information with the police or the National Center for Missing &amp; Exploited
          Children (NCMEC) when the law requires it or someone is in danger.
        </p>
      </section>

      <section id="retention" aria-labelledby="retention-heading">
        <h2 id="retention-heading">How long we keep it</h2>
        <ul>
          <li>
            <strong>Your account:</strong> until you delete it.
          </li>
          <li>
            <strong>After you delete your account:</strong> your chat, comments and posts show as
            &ldquo;[deleted]&rdquo; with no name on them. Your uploaded videos are deleted. Your picks stay in
            game totals but aren&apos;t linked to you. Your username is held for 90 days so nobody can pretend
            to be you.
          </li>
          <li>
            <strong>Safety holds:</strong> if there&apos;s an open safety report or an active ban, we keep the
            related content, hidden, for up to 1 year. If it was reported to NCMEC, we keep it as long as the
            law requires.
          </li>
          <li>
            <strong>Moderation records:</strong> up to 1 year.
          </li>
          <li>
            <strong>Security logs:</strong> 90 days at most.
          </li>
        </ul>
      </section>

      <section aria-labelledby="choices">
        <h2 id="choices">Your choices</h2>
        <ul>
          <li>
            <strong>Delete your account</strong> any time in Settings.
          </li>
          <li>
            <strong>Make a new recovery code</strong> in Settings if you think someone saw yours.
          </li>
          <li>
            <strong>Block</strong> anyone you don&apos;t want to see.
          </li>
          <li>
            <strong>Ask us</strong> what we have about you, or to fix it, at {CONTACT_EMAIL}.
          </li>
        </ul>
      </section>

      <section aria-labelledby="under-13">
        <h2 id="under-13">Kids under 13</h2>
        <p>
          Caught Looking is not for kids under 13. We don&apos;t knowingly let anyone under 13 make an account. If
          we learn someone is under 13, we delete the account and its information.
        </p>
      </section>

      <section id="parents" aria-labelledby="parents-heading">
        <h2 id="parents-heading">For parents and guardians</h2>
        <ul>
          <li>We collect no contact details from your teen, and there are no private messages.</li>
          <li>Chat and posts are checked automatically, and every video is reviewed by an adult before it shows.</li>
          <li>
            If you think your child is under 13 and has an account, or you want your teen&apos;s account deleted,
            email {CONTACT_EMAIL} with the username. We&apos;ll act on it.
          </li>
          <li>
            Read how we protect kids on our <Link href="/child-safety">child safety</Link> page.
          </li>
        </ul>
      </section>

      <section aria-labelledby="privacy-changes">
        <h2 id="privacy-changes">Changes and questions</h2>
        <p>
          If we change this notice in a big way, we&apos;ll tell you in the app first. Questions? Write to{" "}
          {CONTACT_EMAIL} or see the <Link href="/contact">Contact</Link> page.
        </p>
      </section>
    </PolicyPage>
  );
}
