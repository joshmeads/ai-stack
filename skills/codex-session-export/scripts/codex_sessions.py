#!/usr/bin/env python3
"""List, export and verify original Codex session files (rollout JSONL).

Standard library only. Originals are never modified: export copies bytes.

  codex_sessions.py scan   [--project DIR] [--since YYYY-MM-DD] [--root DIR]... [--json]
  codex_sessions.py show   THREAD_ID [--root DIR]...
  codex_sessions.py export THREAD_ID... --out DIR [--zip NAME] [--allow-open] [--root DIR]...
  codex_sessions.py verify --out DIR
"""
from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import os
import shutil
import sys
import time
import zipfile
from pathlib import Path
from zoneinfo import ZoneInfo

ORIGINATORS = {
    "codex_exec": "Codex CLI (codex exec)",
    "codex_cli_rs": "Codex CLI",
    "codex_vscode": "Codex IDE extension",
    "Codex Desktop": "Codex app",
}
OPEN_SECONDS = 120


def default_roots() -> list[Path]:
    home = Path(os.environ.get("CODEX_HOME", Path.home() / ".codex"))
    return [p for p in (home / "sessions", home / "archived_sessions") if p.is_dir()]


def parse_ts(value: str | None) -> dt.datetime | None:
    if not value:
        return None
    return dt.datetime.fromisoformat(value.replace("Z", "+00:00"))


def local(ts: dt.datetime | None, tz: str | None) -> str:
    if ts is None:
        return ""
    try:
        return ts.astimezone(ZoneInfo(tz)).isoformat(timespec="seconds") + f" ({tz})" if tz else ts.isoformat(timespec="seconds")
    except Exception:
        return ts.isoformat(timespec="seconds")


def read_thread(path: Path) -> dict:
    meta: dict = {}
    settings: list[tuple] = []
    tz = None
    cwds: set[str] = set()
    started = completed = aborted = 0
    first_prompt = ""
    replied = False
    first_ts = last_ts = None
    bad_lines = 0
    with path.open("rb") as fh:
        for raw in fh:
            try:
                rec = json.loads(raw)
            except ValueError:
                bad_lines += 1
                continue
            ts = parse_ts(rec.get("timestamp"))
            first_ts = first_ts or ts
            last_ts = ts or last_ts
            kind = rec.get("type")
            p = rec.get("payload") or {}
            if kind == "session_meta" and not meta:
                meta = p
                if p.get("cwd"):
                    cwds.add(p["cwd"])
            elif kind == "turn_context":
                s = (p.get("model"), p.get("effort"))
                if s not in settings:
                    settings.append(s)
                tz = p.get("timezone") or tz
                if p.get("cwd"):
                    cwds.add(p["cwd"])
            elif kind == "event_msg":
                t = p.get("type")
                started += t == "task_started"
                completed += t == "task_complete"
                aborted += t == "turn_aborted"
            elif kind == "response_item" and not replied:
                # Codex injects AGENTS.md and environment context as user messages before
                # the typed prompt, so keep the last user text before the first reply.
                if p.get("type") == "message" and p.get("role") == "user":
                    for part in p.get("content") or []:
                        text = (part.get("text") or "").strip()
                        if text and not text.startswith(("<", "# AGENTS.md")):
                            first_prompt = " ".join(text.split())[:100]
                elif p.get("type") in ("agent_message", "function_call", "custom_tool_call") or p.get("role") == "assistant":
                    replied = True
    stat = path.stat()
    start = parse_ts(meta.get("timestamp")) or first_ts
    if time.time() - stat.st_mtime < OPEN_SECONDS:
        status = "open"  # still being written
    elif started > completed + aborted:
        status = "unfinished"  # last turn never recorded an end; process probably killed
    elif aborted:
        status = "interrupted"
    else:
        status = "complete"
    origin = meta.get("originator") or ""
    return {
        "file": str(path),
        "filename": path.name,
        "bytes": stat.st_size,
        "thread_id": meta.get("id"),
        "session_id": meta.get("session_id") or meta.get("id"),
        "parent_thread_id": meta.get("parent_thread_id"),
        "source": meta.get("thread_source") or ("subagent" if meta.get("parent_thread_id") else "user"),
        "agent": meta.get("agent_nickname"),
        "originator": origin,
        "surface": f"{ORIGINATORS.get(origin, origin or 'unknown')} {meta.get('cli_version') or ''}".strip(),
        "cli_version": meta.get("cli_version"),
        "cwds": sorted(cwds),
        "timezone": tz,
        "start_utc": start.isoformat(timespec="seconds") if start else None,
        "end_utc": last_ts.isoformat(timespec="seconds") if last_ts else None,
        "start_local": local(start, tz),
        "end_local": local(last_ts, tz),
        "settings": [{"model": m, "reasoning_effort": e} for m, e in settings],
        "turns": {"started": started, "completed": completed, "aborted": aborted},
        "status": status,
        "bad_lines": bad_lines,
        "first_prompt": first_prompt,
    }


def all_threads(roots: list[Path]) -> list[dict]:
    out = []
    for root in roots:
        for path in sorted(root.rglob("*.jsonl")):
            try:
                out.append(read_thread(path))
            except OSError as exc:
                print(f"skip {path}: {exc}", file=sys.stderr)
    return out


def inside(cwd: str, project: Path) -> bool:
    try:
        Path(cwd).resolve().relative_to(project)
        return True
    except ValueError:
        return False


def settings_text(t: dict) -> str:
    return "; ".join(f"{s['model']} / {s['reasoning_effort'] or 'default'}" for s in t["settings"]) or "unknown"


def cmd_scan(args) -> int:
    threads = all_threads(args.roots)
    if args.project:
        project = args.project.resolve()
        hits = {t["thread_id"] for t in threads if any(inside(c, project) for c in t["cwds"])}
        # keep children and parents of matching threads so agents are not lost
        changed = True
        while changed:
            changed = False
            for t in threads:
                if t["thread_id"] not in hits and (t["parent_thread_id"] in hits or any(c["parent_thread_id"] == t["thread_id"] for c in threads if c["thread_id"] in hits)):
                    hits.add(t["thread_id"])
                    changed = True
        threads = [t for t in threads if t["thread_id"] in hits]
    if args.since:
        threads = [t for t in threads if (t["start_utc"] or "") >= args.since]
    threads.sort(key=lambda t: t["start_utc"] or "")
    if args.json:
        json.dump(threads, sys.stdout, indent=2)
        print()
        return 0
    for t in threads:
        rel = f"child of {t['parent_thread_id']}" if t["parent_thread_id"] else "root"
        print(f"{t['thread_id']}  {t['status']:<11} {t['source']:<15} {rel}")
        print(f"    {t['start_local']} -> {t['end_local']}")
        print(f"    {settings_text(t)} | {t['surface']} | {t['filename']}")
        print(f"    cwd: {', '.join(t['cwds'])}")
        if t["first_prompt"]:
            print(f"    first prompt: {t['first_prompt']}")
    print(f"{len(threads)} thread file(s)")
    return 0


def find_files(thread_id: str, roots: list[Path]) -> list[dict]:
    return [t for t in all_threads(roots) if t["thread_id"] == thread_id]


def cmd_show(args) -> int:
    hits = find_files(args.thread_id, args.roots)
    if not hits:
        print(f"no session file has thread id {args.thread_id}", file=sys.stderr)
        return 1
    json.dump(hits, sys.stdout, indent=2)
    print()
    return 0


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for block in iter(lambda: fh.read(1 << 20), b""):
            h.update(block)
    return h.hexdigest()


def cmd_export(args) -> int:
    out = args.out.resolve()
    originals = out / "originals"
    originals.mkdir(parents=True, exist_ok=True)
    entries, problems = [], []
    for tid in args.thread_ids:
        files = find_files(tid, args.roots)
        if not files:
            problems.append(f"{tid}: no session file found")
        for t in files:
            if t["status"] == "open" and not args.allow_open:
                problems.append(f"{tid}: {t['filename']} was written in the last {OPEN_SECONDS}s; finish or close the session first, or pass --allow-open")
            elif t["status"] in ("unfinished", "interrupted"):
                print(f"note: {tid} is {t['status']}; its last turn did not complete. Say so in the submission.", file=sys.stderr)
            if t["bad_lines"]:
                problems.append(f"{tid}: {t['filename']} has {t['bad_lines']} unparseable line(s)")
            entries.append(t)
    if problems:
        print("\n".join(problems), file=sys.stderr)
        return 2
    for t in entries:
        src = Path(t["file"])
        dst = originals / src.name
        before = sha256(src)
        shutil.copyfile(src, dst)
        after = sha256(dst)
        if before != after or sha256(src) != before:
            print(f"{src} changed while copying; retry when the session is idle", file=sys.stderr)
            return 2
        t["sha256"] = after
        t["export_path"] = f"originals/{src.name}"
    manifest = {"created": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"), "threads": entries}
    (out / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    lines = [
        "# Codex sessions",
        "",
        "| Session ID | Export file | Start | End | Model / reasoning | Surface and version | Role | Status |",
        "| --- | --- | --- | --- | --- | --- | --- | --- |",
    ]
    for t in entries:
        role = t["source"] + (f" (child of {t['parent_thread_id']})" if t["parent_thread_id"] else "")
        lines.append(f"| {t['thread_id']} | {t['filename']} | {t['start_local']} | {t['end_local']} | {settings_text(t)} | {t['surface']} | {role} | {t['status']} |")
    (out / "sessions.md").write_text("\n".join(lines) + "\n")
    if args.zip:
        zpath = out / args.zip
        with zipfile.ZipFile(zpath, "w", zipfile.ZIP_DEFLATED) as z:
            for t in entries:
                z.write(originals / t["filename"], t["filename"])
        print(f"zip: {zpath}")
    print(f"exported {len(entries)} file(s) to {out}")
    print((out / "sessions.md").read_text())
    return 0


def cmd_verify(args) -> int:
    out = args.out.resolve()
    manifest = json.loads((out / "manifest.json").read_text())
    bad = 0
    for t in manifest["threads"]:
        copy = out / t["export_path"]
        state = []
        state.append("copy ok" if copy.exists() and sha256(copy) == t["sha256"] else "COPY CHANGED OR MISSING")
        src = Path(t["file"])
        if not src.exists():
            state.append("original missing")
        elif sha256(src) != t["sha256"]:
            state.append("ORIGINAL CHANGED since export (session continued?)")
        else:
            state.append("original unchanged")
        bad += any(s.isupper() or s.startswith("ORIGINAL") or s.startswith("COPY") for s in state)
        print(f"{t['thread_id']} {t['filename']}: {', '.join(state)}")
    return 1 if bad else 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    for name in ("scan", "show", "export"):
        p = sub.add_parser(name)
        p.add_argument("--root", dest="roots", action="append", type=Path, help="session folder; default $CODEX_HOME/sessions and archived_sessions")
        if name == "scan":
            p.add_argument("--project", type=Path, help="keep threads whose cwd is inside this folder, plus their parents and children")
            p.add_argument("--since", help="ISO date, compared with the UTC start time")
            p.add_argument("--json", action="store_true")
        elif name == "show":
            p.add_argument("thread_id")
        else:
            p.add_argument("thread_ids", nargs="+")
            p.add_argument("--out", type=Path, required=True)
            p.add_argument("--zip", help="also write this ZIP of the originals inside --out")
            p.add_argument("--allow-open", action="store_true")
    v = sub.add_parser("verify")
    v.add_argument("--out", type=Path, required=True)
    args = ap.parse_args()
    if getattr(args, "roots", None) is None and args.cmd != "verify":
        args.roots = default_roots()
    return {"scan": cmd_scan, "show": cmd_show, "export": cmd_export, "verify": cmd_verify}[args.cmd](args)


if __name__ == "__main__":
    sys.exit(main())
