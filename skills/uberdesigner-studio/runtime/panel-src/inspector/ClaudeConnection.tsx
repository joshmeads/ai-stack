import { useState } from "react";
import type { ClaudeStatus } from "./claudeStatus";
import styles from "./Inspector.module.css";

// What Regenerate needs: Claude Code installed on this computer, and signed in. Setup settles that in the person's chat
// with Claude (SKILL.md step 0), so this box is the fallback for a setup that put it off or a sign-in that ran out: it
// sends them back to the chat first, and keeps the terminal commands folded underneath. Shown in place of the
// Regenerate controls until both are true; once ready, one quiet line says which account pays for the requests.

const INSTALL = "curl -fsSL https://claude.ai/install.sh | bash";
const LOGIN = "claude auth login";
const LOGIN_CONSOLE = "claude auth login --console";
const ASK = "Connect uberdesigner studio to Claude Code";

function Command({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className={styles.command}>
      <code>{text}</code>
      <button
        type="button"
        className={styles.ghost}
        onClick={() => {
          void navigator.clipboard.writeText(text).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          });
        }}
      >
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

type Props = { status: ClaudeStatus | null; ready: boolean; failed: boolean; onCheck: () => void };

export function ClaudeConnection({ status, ready, failed, onCheck }: Props) {
  if (failed) {
    return (
      <div className={styles.setup}>
        <strong>Can't reach the dev server</strong>
        <p>Regenerate works only while <code>pnpm dev</code> is running.</p>
      </div>
    );
  }

  if (!status) return <p className={styles.phone}>Checking Claude Code…</p>;

  if (ready) {
    return (
      <p className={styles.connected}>
        <i /> Claude Code {status.version} · {status.method}
        {status.account ? ` · ${status.account}` : ""}
      </p>
    );
  }

  return (
    <div className={styles.setup}>
      <strong>{status.installed ? "Sign in to Claude Code" : "Connect Claude Code"}</strong>
      <p>
        Regenerate sends your change to Claude through Claude Code on this computer, on your own Claude plan. It isn't{" "}
        {status.installed ? "signed in" : "installed"} yet.
      </p>
      <p>Easiest: in your chat with Claude, say</p>
      <Command text={ASK} />
      <p className={styles.phone}>Claude opens the sign-in for you; you finish it in your browser. This box turns into the Regenerate controls by itself.</p>

      <details className={styles.moreLog}>
        <summary>Or do it yourself in a terminal</summary>
        <ol>
          {!status.installed && (
            <li>
              Install it:
              <Command text={INSTALL} />
              Then open a new terminal window.
            </li>
          )}
          <li>
            Sign in with your Claude subscription. It opens your browser; finish there.
            <Command text={LOGIN} />
            <span className={styles.phone}>
              Paying per token instead? Use your Anthropic Console account: <code>{LOGIN_CONSOLE}</code>, or start{" "}
              <code>pnpm dev</code> with <code>ANTHROPIC_API_KEY</code> set.
            </span>
          </li>
        </ol>
        <button type="button" className={styles.ghost} onClick={onCheck}>
          Check again
        </button>
      </details>
    </div>
  );
}
