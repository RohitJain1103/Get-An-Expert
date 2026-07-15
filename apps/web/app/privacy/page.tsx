import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Privacy Policy — Get An Expert",
};

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-8">
      <h2 className="text-lg font-semibold text-black dark:text-zinc-50">
        {title}
      </h2>
      <div className="mt-2 space-y-3 text-sm leading-6 text-zinc-600 dark:text-zinc-400">
        {children}
      </div>
    </section>
  );
}

export default function PrivacyPage() {
  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-16">
      <h1 className="text-3xl font-semibold text-black dark:text-zinc-50">
        Privacy Policy
      </h1>
      <p className="mt-2 text-sm text-zinc-500">
        Effective date: July 14, 2026 · Version 1.3
      </p>

      <Section title="1. Who we are">
        <p>
          Get An Expert (&quot;we&quot;, &quot;us&quot;) provides the
          get-an-expert-mcp software and the api at this domain. We act as the
          data controller for the data described below. Contact:{" "}
          <a className="underline" href="mailto:">
            
          </a>
          .
        </p>
      </Section>

      <Section title="2. What this policy covers">
        <p>
          The get-an-expert-mcp MCP server you install in your coding tool,
          the Get An Expert API it talks to, and this website.
        </p>
      </Section>

      <Section title="3. What we collect">
        <p>We collect four things, and only these:</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <strong>The session summary you explicitly send</strong> when you
            ask for expert help: your stated goal, what was tried, error
            messages, a short summary of the stuck session, and your tech
            stack. Secret redaction runs on your machine before this is
            transmitted, and again on our servers when it arrives.
          </li>
          <li>
            <strong>Live chat messages and relayed session activity</strong>{" "}
            once you escalate to an expert — described in full in section 5.
            Both flows start only after your explicit consent and stop the
            instant the chat ends.
          </li>
          <li>
            <strong>A random install ID</strong> (a UUID generated on your
            machine) used for rate limiting and to let you delete your data.
            It is not linked to your name, email, or any account.
          </li>
          <li>
            <strong>Minimal request metadata</strong> (IP-derived rate-limit
            counters and standard server logs) for security and abuse
            prevention. Payload bodies are not written to logs.
          </li>
        </ul>
        <p>
          <strong>What we never collect:</strong> your source files or
          repository contents; your full conversation transcript; environment
          variables, API keys, or other secrets; anything in the background or
          without your explicit per-request consent. The software sends zero
          bytes to us until you say yes to a specific request.
        </p>
      </Section>

      <Section title="4. How and when collection happens">
        <p>
          Only when you explicitly agree to send a specific request. There is
          no passive or background collection of any kind.
        </p>
      </Section>

      <Section title="5. Live expert chat &amp; session relay">
        <p>
          When you escalate to a human expert, you consent once, up front, to
          two additional flows — both start only after your explicit
          &quot;proceed&quot; and both stop the instant the chat ends:
        </p>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <strong>Chat messages</strong> you and the expert exchange in the
            chat terminal. The chat is human-to-human: no AI model ever reads
            it. The only automation touching it is secret redaction, which
            runs on your machine before sending and again on our servers — in
            both directions, expert messages included.
          </li>
          <li>
            <strong>Relayed session activity</strong>: the prompts you type to
            your coding agent, the agent&apos;s replies, the commands it runs
            with their output, and the file edits it makes — so the expert can
            watch real attempts. This relay is active only while the chat is
            open, a RELAY ON indicator shows in your session, and you can
            pause it (/pause) or end everything (/end) at any moment. Either
            side ending the chat is a hard stop: our servers refuse any
            further relayed event.
          </li>
        </ul>
        <p>
          Chat messages and relayed events are stored with the request they
          belong to: they share its 30-day auto-deletion and are removed by
          its private deletion link.
        </p>
      </Section>

      <Section title="6. Why we use it, and our legal basis">
        <ul className="list-disc space-y-1 pl-5">
          <li>
            Sharing your session summary with a human expert who reviews it
            and writes your response — <em>consent</em> (GDPR Art. 6(1)(a)),
            given per request.
          </li>
          <li>
            Service security, rate limiting, and abuse prevention —{" "}
            <em>legitimate interest</em> (GDPR Art. 6(1)(f)) in keeping the
            service available and safe.
          </li>
        </ul>
        <p>
          Providing your data is never required — if you decline, the tool
          simply doesn&apos;t send anything and your session continues
          unaffected. You can withdraw consent for stored data at any time by
          deleting it (section 9).
        </p>
      </Section>

      <Section title="7. Human review">
        <p>
          Your session summary is reviewed by a human expert at Get An
          Expert, who writes the response you receive. We do not use your
          data to generate automated responses, we never permit it to be used
          for model training, and no decision with legal or similarly
          significant effect is made about you (GDPR Art. 22 does not apply).
          The live expert chat and relayed session events are never processed
          by any AI model.
        </p>
      </Section>

      <Section title="8. Who we share data with">
        <p>
          We use two subprocessors, strictly to run the service: Vercel
          (hosting) and Upstash (storage). Your summary is visible to the
          vetted expert who answers it. We do not sell your data, do not
          share it for advertising, and do not allow anyone to train models
          on it. Because we do not sell or share personal information as
          defined by the CCPA/CPRA, no &quot;Do Not Sell or Share&quot;
          mechanism is needed.
        </p>
      </Section>

      <Section title="9. International transfers">
        <p>
          Data is processed in the United States. For transfers from the
          EU/UK, we rely on our subprocessors&apos; safeguards — Standard
          Contractual Clauses and, where applicable, the EU-U.S. Data Privacy
          Framework — under each provider&apos;s data processing agreement.
        </p>
      </Section>

      <Section title="10. Retention and deletion">
        <ul className="list-disc space-y-1 pl-5">
          <li>
            Session summaries, thread messages, and expert responses{" "}
            <strong>auto-delete 30 days</strong> after the request was
            submitted.
          </li>
          <li>
            Every request comes with a private deletion link — use it to
            delete the request and its entire thread immediately, no account
            or email needed.
          </li>
          <li>Rate-limit counters expire within 24 hours.</li>
          <li>
            The install ID lives on your machine; uninstalling the software
            removes it.
          </li>
        </ul>
      </Section>

      <Section title="11. Your rights">
        <p>
          Under the GDPR you have the right to access, rectify, erase,
          restrict, or object to processing of your personal data, the right
          to data portability, the right to withdraw consent at any time, and
          the right to lodge a complaint with your supervisory authority.
          Under the CCPA/CPRA you have the right to know, delete, and correct,
          and the right not to be discriminated against for exercising your
          rights. To exercise any of these, use your deletion link or email{" "}
          <a className="underline" href="mailto:">
            
          </a>
          . We respond within 30 days (GDPR) / 45 days (CCPA).
        </p>
      </Section>

      <Section title="12. Security">
        <p>
          TLS for all data in transit, encryption at rest with our storage
          provider, client-side secret redaction before transmission plus a
          second server-side redaction pass (for summaries and every thread
          message), deletion and thread tokens stored only as hashes, and
          access limited to what operating the service requires.
        </p>
      </Section>

      <Section title="13. Children">
        <p>
          The service is for developers and is not directed at children under
          16. We do not knowingly collect data from children.
        </p>
      </Section>

      <Section title="14. Changes">
        <p>
          We&apos;ll post any changes here with a new effective date and
          version number. Material changes will also be noted in the
          software&apos;s release notes before they take effect.
        </p>
      </Section>

      <p className="mt-10 text-sm text-zinc-500">
        <Link className="underline" href="/">
          ← Back to home
        </Link>
      </p>
    </main>
  );
}
