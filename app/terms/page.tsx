import type { Metadata } from "next";
import Link from "next/link";

import { CONTACT_EMAIL, DMCA_AGENT, PolicyNote, PolicyPage } from "@/components/policy-page";

export const metadata: Metadata = { title: "Terms of use" };

export default function TermsPage() {
  return (
    <PolicyPage
      title="Terms of use"
      lede="The deal between you and Caught Looking, in plain words. By using the app, you agree to it."
      draft
    >
      <section aria-labelledby="who">
        <h2 id="who">Who can use Caught Looking</h2>
        <ul>
          <li>You must be 13 or older.</li>
          <li>Right now Caught Looking is invite-only. You need an invite code to join.</li>
          <li>One account per person. Don&apos;t make extra accounts, and don&apos;t make one after a ban.</li>
          <li>
            You agree to follow the <Link href="/rules">house rules</Link>. They are part of these terms.
          </li>
        </ul>
      </section>

      <section aria-labelledby="account">
        <h2 id="account">Your account</h2>
        <ul>
          <li>Keep your password and your recovery code safe. Don&apos;t share them with anyone.</li>
          <li>
            We don&apos;t have your email or phone number. If you lose both your password and your recovery
            code, we may not be able to get your account back.
          </li>
          <li>You are responsible for what happens on your account.</li>
          <li>Pick a username that follows the rules. We can change or remove one that doesn&apos;t.</li>
        </ul>
      </section>

      <section aria-labelledby="content">
        <h2 id="content">Your content</h2>
        <ul>
          <li>You own what you post: chat messages, posts, comments, polls and uploads.</li>
          <li>
            When you post, you give us permission to store it, show it to other members in the app, and make
            the copies we need to run the app (like a thumbnail). This permission is free and lasts while
            your content is on Caught Looking.
          </li>
          <li>Only post things you made or have the right to share.</li>
          <li>
            We can hide, remove or refuse anything, at any time, especially if it breaks the rules or the
            law.
          </li>
          <li>Uploads are checked by an adult on our team before anyone else sees them.</li>
        </ul>
      </section>

      <section aria-labelledby="picks">
        <h2 id="picks">Picks are just for fun</h2>
        <ul>
          <li>Picks, badges, streaks and leaderboards are for bragging rights only.</li>
          <li>There are no prizes, no money, no points you can buy, and nothing to cash out.</li>
          <li>Caught Looking is not betting, and you may not use it to bet or to settle bets.</li>
          <li>Game times, scores and results can be late or wrong. We fix mistakes when we find them.</li>
        </ul>
      </section>

      <section aria-labelledby="mlb">
        <h2 id="mlb">We&apos;re not MLB</h2>
        <ul>
          <li>
            Caught Looking is a fan project. It is not affiliated with, endorsed by or sponsored by Major
            League Baseball or any club.
          </li>
          <li>
            Team names are used only to say which team is which. We don&apos;t use MLB or club logos.
          </li>
          <li>
            MLB highlight clips are links. They open on MLB.com (or an official YouTube video), and MLB&apos;s
            own terms apply there.
          </li>
        </ul>
      </section>

      <section aria-labelledby="copyright">
        <h2 id="copyright">Copyright</h2>
        <p>
          We respect copyright and follow the Digital Millennium Copyright Act (DMCA). If you think something
          on Caught Looking uses your work without permission, send a notice to our copyright agent:
        </p>
        <p>
          <strong>{DMCA_AGENT}</strong>
          <br />
          Email: {CONTACT_EMAIL}
        </p>
        <p>Your notice needs:</p>
        <ul>
          <li>Your name, contact details and signature (typed is fine).</li>
          <li>What work you own, and where it is on Caught Looking.</li>
          <li>A statement that you believe in good faith the use isn&apos;t allowed.</li>
          <li>A statement, under penalty of perjury, that your notice is accurate and you&apos;re the owner or allowed to act for them.</li>
        </ul>
        <p>
          We remove the content and tell the person who posted it. If they think we made a mistake, they can
          send a counter-notice to the same address.
        </p>
        <h3>Repeat infringers</h3>
        <p>
          Each upheld copyright complaint is a strike. An account with three upheld strikes is banned.
        </p>
      </section>

      <section aria-labelledby="ending">
        <h2 id="ending">Ending your account</h2>
        <ul>
          <li>You can delete your account any time in Settings. It can&apos;t be undone.</li>
          <li>
            We can suspend or close an account that breaks these terms or the house rules, or to keep people
            safe. See <Link href="/rules#consequences">what happens if you break the rules</Link>.
          </li>
          <li>
            Some records stay after an account ends, as explained in the{" "}
            <Link href="/privacy#retention">privacy notice</Link>.
          </li>
        </ul>
      </section>

      <section aria-labelledby="as-is">
        <h2 id="as-is">The fine print</h2>
        <ul>
          <li>Caught Looking is free and is provided as it is. It may go down, change or stop.</li>
          <li>We are not responsible for what other members post, though we work to remove what breaks the rules.</li>
          <li>As far as the law allows, we aren&apos;t liable for losses from using the app.</li>
        </ul>
      </section>

      <section aria-labelledby="changes">
        <h2 id="changes">Changes to these terms</h2>
        <p>
          We may update these terms. When we make a big change, we&apos;ll tell you in the app before it takes
          effect. The date at the top shows the latest version.
        </p>
      </section>

      <section aria-labelledby="terms-contact">
        <h2 id="terms-contact">Questions</h2>
        <p>
          Write to us at {CONTACT_EMAIL}. More ways to reach us are on the <Link href="/contact">Contact</Link>{" "}
          page.
        </p>
        <PolicyNote>Parents and guardians are welcome to contact us too.</PolicyNote>
      </section>
    </PolicyPage>
  );
}
