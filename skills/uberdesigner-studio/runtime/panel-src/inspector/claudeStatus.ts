import { api } from "./api";
import { useCallback, useEffect, useState } from "react";

// Is Claude Code on this computer and signed in? Asked of the dev server (GET /__inspector/status), which runs
// `claude auth status`, so checking spends no tokens. While it isn't ready, it's asked again every few seconds, so the
// panel turns ready by itself once the user finishes signing in.

export type ClaudeStatus = {
  installed: boolean;
  version?: string;
  loggedIn: boolean;
  method?: string;
  account?: string;
  expires?: string;
};

const POLL_MS = 4000;

export function useClaudeStatus() {
  const [status, setStatus] = useState<ClaudeStatus | null>(null);
  const [failed, setFailed] = useState(false);

  const check = useCallback(async () => {
    try {
      const out = (await (await api("/__inspector/status")).json()) as { status: ClaudeStatus };
      setStatus(out.status);
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, []);

  useEffect(() => {
    void check();
  }, [check]);

  const ready = !!status?.installed && status.loggedIn;
  useEffect(() => {
    if (ready) return;
    const id = setInterval(() => void check(), POLL_MS);
    return () => clearInterval(id);
  }, [ready, check]);

  return { status, ready, failed, check };
}
