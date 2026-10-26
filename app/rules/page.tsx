import type { Metadata } from "next";
import Link from "next/link";

import { PolicyNote, PolicyPage } from "@/components/policy-page";

export const metadata: Metadata = { title: "House rules" };

export default function RulesPage() {
  return (
    <PolicyPage
      title="House rules"
      lede="Caught Looking is for baseball fans 13 and up. Five rules keep it fun for everyone."
    >
      <section aria-labelledby="house-rules">
        <h2 id="house-rules">The five rules</h2>
        <ol>
          <li>
            <strong>Be a good teammate.</strong> No bullying, no hate, no threats. Trash talk a team all you
            want. Never trash talk a person.
          </li>
          <li>
            <strong>Keep it about baseball.</strong> Posts, chat, polls and uploads are for the game.
          </li>
          <li>
            <strong>No personal info — yours or anyone else&apos;s.</strong> No real names, schools, addresses,
            phone numbers or photos of people. No social media handles or other ways to reach you. Never
            plan to meet up with someone from the app.
          </li>
          <li>
            <strong>No betting, no money, no selling.</strong> Picks are for bragging rights only. Don&apos;t
            offer or ask for money, gift cards or trades.
          </li>
          <li>
            <strong>Report what&apos;s wrong. Don&apos;t fight it.</strong> If something breaks the rules or
            worries you, tap Report. Then block the person if you want. Don&apos;t argue back.
          </li>
        </ol>
      </section>

      <section aria-labelledby="chat-rules">
        <h2 id="chat-rules">Chat rules</h2>
        <ul>
          <li>Each game has its own chat. It opens before first pitch and closes a little after the game ends.</li>
          <li>New accounts can read chat right away and can send messages after 24 hours.</li>
          <li>Messages are short (200 characters max). In a busy room, slow mode makes you wait between messages.</li>
          <li>
            Every message is checked before it posts. Links, handles, phone numbers and mean words are
            blocked. Some messages wait for a check before anyone sees them.
          </li>
          <li>There are no private messages. Everything you say in chat, the whole room can see.</li>
          <li>Blocking someone hides their messages from you.</li>
        </ul>
      </section>

      <section id="uploads" aria-labelledby="uploads-heading">
        <h2 id="uploads-heading">Fan edit uploads</h2>
        <h3>You can upload</h3>
        <ul>
          <li>Your own footage, like a clip from the stands or the backyard.</li>
          <li>A short commentary edit — you talking about baseball moments.</li>
          <li>60 seconds or less. MP4 or MOV, up to 150 MB. Up to 3 a day.</li>
        </ul>
        <h3>You can&apos;t upload</h3>
        <ul>
          <li>Faces of you or your friends. Far-away crowd shots are fine.</li>
          <li>School names, jersey names, street signs or anything that shows where you live or go to school.</li>
          <li>Usernames, phone numbers or other contact info, on screen or in the title.</li>
          <li>Songs or music you don&apos;t own. Stadium noise and your own voice are fine.</li>
          <li>Clips of TV broadcasts or other people&apos;s videos. Share those as MLB.com or YouTube links instead.</li>
        </ul>
        <h3>How review works</h3>
        <p>
          Every upload is scanned. Then an adult on our team watches it before anyone else can see it. That
          usually takes less than a day. If it&apos;s turned down, you&apos;ll see why under My uploads, and you
          can fix it and try again.
        </p>
      </section>

      <section aria-labelledby="consequences">
        <h2 id="consequences">If you break the rules</h2>
        <p>What happens depends on how serious it is and whether it keeps happening.</p>
        <ol>
          <li>
            <strong>Hide.</strong> The post, comment or message disappears for everyone else.
          </li>
          <li>
            <strong>Mute.</strong> You can&apos;t send chat messages for a while (hours to days).
          </li>
          <li>
            <strong>Suspension.</strong> You can&apos;t post, chat or pick for a set time, usually 7 days.
          </li>
          <li>
            <strong>Ban.</strong> Your account is closed for good.
          </li>
        </ol>
        <p>
          Some things skip straight to a ban. That includes anything sexual involving a kid, threats, or trying
          to get someone to meet up or move to another app.
        </p>
        <PolicyNote>When you get a mute, suspension or ban, the app tells you why and when it ends.</PolicyNote>
      </section>

      <section aria-labelledby="appeals">
        <h2 id="appeals">How to appeal</h2>
        <p>
          If you think we got it wrong, write to us. Use the address on the <Link href="/contact">Contact</Link>{" "}
          page. Tell us your username, what happened and why you think it was a mistake.
        </p>
        <p>
          An adult admin answers within 7 days. If possible, someone other than the person who made the call
          looks at it again.
        </p>
      </section>
    </PolicyPage>
  );
}
