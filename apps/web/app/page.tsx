import Link from "next/link";

const SEND_LIST = [
  "Your stated goal for the session",
  "What was already tried, in order",
  "Error messages you hit",
  "A short summary of the stuck session",
  "Your tech stack and which coding tool you're using",
];

const NEVER_LIST = [
  "Your source files or repository contents",
  "Your full conversation transcript",
  "Environment variables, API keys, or secrets (redacted on your machine before anything is sent)",
  "Anything at all, without you saying yes first — every single time",
];

export default function Home() {
  return (
    <div className="flex flex-1 flex-col bg-zinc-50 font-sans dark:bg-black">
      <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-20">
        <p className="mb-3 font-mono text-sm text-amber-600 dark:text-amber-500">
          ✨ get-an-expert-mcp
        </p>
        <h1 className="text-4xl font-semibold tracking-tight text-black dark:text-zinc-50">
          Stuck in your AI coding session?
          <br />
          Get an expert&apos;s eye on it.
        </h1>
        <p className="mt-6 max-w-2xl text-lg leading-8 text-zinc-600 dark:text-zinc-400">
          Get An Expert is an MCP server for Claude Code, Codex, Cursor,
          Windsurf, and other AI coding tools. When a session goes in circles,
          it offers a hand — and with your explicit OK, opens a private
          thread with a real human expert who diagnoses the problem and hands
          you the exact prompt to try next. Still stuck? Keep talking to them
          from inside your session until it&apos;s solved.
        </p>

        <section className="mt-12">
          <h2 className="text-xl font-semibold text-black dark:text-zinc-50">
            Install
          </h2>
          <div className="mt-4 space-y-3">
            <div>
              <p className="mb-1 text-sm text-zinc-500">Claude Code</p>
              <pre className="overflow-x-auto rounded-lg bg-zinc-900 px-4 py-3 font-mono text-sm text-zinc-100">
                claude mcp add get-an-expert -- npx -y get-an-expert-mcp
              </pre>
            </div>
            <div>
              <p className="mb-1 text-sm text-zinc-500">
                Codex CLI (~/.codex/config.toml)
              </p>
              <pre className="overflow-x-auto rounded-lg bg-zinc-900 px-4 py-3 font-mono text-sm text-zinc-100">
                {`[mcp_servers.get-an-expert]\ncommand = "npx"\nargs = ["-y", "get-an-expert-mcp"]\nstartup_timeout_sec = 30`}
              </pre>
            </div>
            <div>
              <p className="mb-1 text-sm text-zinc-500">
                Cursor / Windsurf (mcp.json)
              </p>
              <pre className="overflow-x-auto rounded-lg bg-zinc-900 px-4 py-3 font-mono text-sm text-zinc-100">
                {`{\n  "mcpServers": {\n    "get-an-expert": {\n      "command": "npx",\n      "args": ["-y", "get-an-expert-mcp"]\n    }\n  }\n}`}
              </pre>
            </div>
          </div>
        </section>

        <section className="mt-12">
          <h2 className="text-xl font-semibold text-black dark:text-zinc-50">
            How it works
          </h2>
          <ol className="mt-4 space-y-3 text-zinc-600 dark:text-zinc-400">
            <li>
              <span className="font-medium text-black dark:text-zinc-200">
                1. You get stuck.
              </span>{" "}
              Ten messages deep, same error, going in circles. Your coding
              agent can offer to bring in Get An Expert.
            </li>
            <li>
              <span className="font-medium text-black dark:text-zinc-200">
                2. You say yes (or no).
              </span>{" "}
              Nothing is ever sent without your explicit go-ahead. You see
              exactly what will be shared before it leaves your machine, and
              secrets are redacted locally first.
            </li>
            <li>
              <span className="font-medium text-black dark:text-zinc-200">
                3. An expert takes it from there.
              </span>{" "}
              A human expert — matched to whatever you&apos;re stuck on —
              reviews your summary and responds with why the session stalled
              and one ready-to-paste prompt built to break the loop.
            </li>
          </ol>
        </section>

        <section className="mt-12 grid gap-6 sm:grid-cols-2">
          <div className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
            <h3 className="font-semibold text-black dark:text-zinc-50">
              What we send (with your OK)
            </h3>
            <ul className="mt-3 space-y-2 text-sm text-zinc-600 dark:text-zinc-400">
              {SEND_LIST.map((item) => (
                <li key={item}>• {item}</li>
              ))}
            </ul>
          </div>
          <div className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
            <h3 className="font-semibold text-black dark:text-zinc-50">
              What we never send
            </h3>
            <ul className="mt-3 space-y-2 text-sm text-zinc-600 dark:text-zinc-400">
              {NEVER_LIST.map((item) => (
                <li key={item}>• {item}</li>
              ))}
            </ul>
          </div>
        </section>

        <section className="mt-12 rounded-xl border border-zinc-200 bg-white p-5 text-sm text-zinc-600 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-400">
          <p>
            <span className="font-semibold text-black dark:text-zinc-200">
              Straight talk:
            </span>{" "}
            every response is written by a real human expert who reviewed the
            summary you approved — all types of experts, matched to your
            problem. We never sell your data, never use it for advertising,
            and never train models on it. Requests auto-delete after 30 days,
            and every submission includes a one-click deletion link.
          </p>
        </section>
      </main>

      <footer className="border-t border-zinc-200 py-6 dark:border-zinc-800">
        <div className="mx-auto flex w-full max-w-3xl gap-6 px-6 text-sm text-zinc-500">
          <Link href="/privacy" className="hover:text-black dark:hover:text-zinc-200">
            Privacy Policy
          </Link>
          <Link href="/terms" className="hover:text-black dark:hover:text-zinc-200">
            Terms of Service
          </Link>
          <a
            href="mailto:sweetcodeyrs@gmail.com"
            className="hover:text-black dark:hover:text-zinc-200"
          >
            Contact
          </a>
        </div>
      </footer>
    </div>
  );
}
