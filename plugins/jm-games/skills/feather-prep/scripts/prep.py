#!/usr/bin/env python3
"""Prepare the files for a Codex game submission. Standard library only (ffprobe optional).

  prep.py package --project DIR --out FILE.zip [--keep PATH]...   archive + secret scan + checks
  prep.py media   --project DIR [--screenshot FILE] [--recording FILE]
  prep.py after   --project DIR (--since ISO | --sessions EXPORT_DIR)  files changed after last Codex turn
  prep.py guide   --draft FILE.md [--sessions EXPORT_DIR] [--upload DIR] --out FILE.html   offline copy guide

Nothing here connects to Feather; the user copies, uploads and submits by hand.

Originals are never modified.
"""
from __future__ import annotations

import argparse
import datetime as dt
import fnmatch
import hashlib
import json
import re
import shutil
import subprocess
import sys
import zipfile
from pathlib import Path

SKIP_DIRS = {
    "node_modules", ".git", ".venv", "venv", "__pycache__", ".cache", ".parcel-cache", ".turbo",
    ".next", ".nuxt", ".svelte-kit", "coverage", ".godot", ".import", ".worktrees", "qa",
    ".pytest_cache", ".mypy_cache", ".idea", ".vscode", "dist", "build", "out", ".output",
}
SKIP_FILES = ["*.log", ".DS_Store", "Thumbs.db", "*.tmp", "*.swp"]
SECRET_NAMES = [".env", ".env.*", "*.pem", "*.key", "*.p12", "*.pfx", "id_rsa*", "id_ed25519*",
                "credentials.json", "service-account*.json", ".npmrc", ".netrc", "auth.json"]
SECRET_PATTERNS = [
    (r"sk-[A-Za-z0-9_-]{20,}", "OpenAI-style API key"),
    (r"sk-ant-[A-Za-z0-9_-]{20,}", "Anthropic API key"),
    (r"AKIA[0-9A-Z]{16}", "AWS access key"),
    (r"gh[pousr]_[A-Za-z0-9]{30,}", "GitHub token"),
    (r"AIza[0-9A-Za-z_-]{35}", "Google API key"),
    (r"-----BEGIN [A-Z ]*PRIVATE KEY-----", "private key"),
    (r"xox[abposr]-[A-Za-z0-9-]{10,}", "Slack token"),
]
LOCKFILES = ["package-lock.json", "pnpm-lock.yaml", "yarn.lock", "bun.lock", "bun.lockb", "npm-shrinkwrap.json"]


def git_files(project: Path) -> list[Path] | None:
    try:
        out = subprocess.run(["git", "-C", str(project), "ls-files", "-z", "--cached", "--others", "--exclude-standard"],
                             capture_output=True, check=True).stdout
    except (OSError, subprocess.CalledProcessError):
        return None
    return [project / p for p in out.decode().split("\0") if p and (project / p).is_file()]


def walk_files(project: Path) -> list[Path]:
    files = []
    stack = [project]
    while stack:
        d = stack.pop()
        for p in sorted(d.iterdir()):
            if p.is_symlink():
                continue
            if p.is_dir():
                if p.name not in SKIP_DIRS:
                    stack.append(p)
            elif not any(fnmatch.fnmatch(p.name, pat) for pat in SKIP_FILES):
                files.append(p)
    return files


def project_files(project: Path, keep: list[str]) -> tuple[list[Path], str]:
    files = git_files(project)
    how = "git (tracked + untracked, .gitignore respected)"
    if files is None:
        files, how = walk_files(project), "folder walk with default excludes"
    else:
        files = [f for f in files if not any(part in SKIP_DIRS for part in f.relative_to(project).parts[:-1])]
    for k in keep:
        extra = (project / k)
        if extra.is_dir():
            files += [p for p in extra.rglob("*") if p.is_file()]
        elif extra.is_file():
            files.append(extra)
    return sorted(set(files)), how


def scan_secrets(project: Path, files: list[Path]) -> tuple[list[Path], list[str]]:
    clean, hits = [], []
    for f in files:
        rel = f.relative_to(project)
        if any(fnmatch.fnmatch(f.name, pat) for pat in SECRET_NAMES) and not f.name.endswith((".example", ".sample", ".template")):
            hits.append(f"{rel}: secret-like filename (excluded)")
            continue
        if f.stat().st_size < 2_000_000:
            try:
                text = f.read_text(errors="ignore")
            except OSError:
                text = ""
            found = [label for pat, label in SECRET_PATTERNS if re.search(pat, text)]
            if found:
                hits.append(f"{rel}: contains {', '.join(sorted(set(found)))} (excluded; the user must remove it from the project, then re-run)")
                continue
        clean.append(f)
    return clean, hits


def cmd_package(a) -> int:
    project = a.project.resolve()
    files, how = project_files(project, a.keep)
    files, secrets = scan_secrets(project, files)
    names = {f.relative_to(project).as_posix() for f in files}
    checks = []
    if not any(n.lower().startswith("readme") and "/" not in n for n in names):
        checks.append("MISSING README at project root (setup/run instructions are required)")
    if "package.json" in names and not any(l in names for l in LOCKFILES):
        checks.append("package.json without a lockfile; run the package manager once and include its lockfile")
    if any((project / d).is_dir() for d in ("dist", "build")) and not a.keep:
        checks.append("dist/ or build/ exists but was left out; pass --keep dist if the game needs it to run")
    a.out.parent.mkdir(parents=True, exist_ok=True)
    root = a.root or project.name
    with zipfile.ZipFile(a.out, "w", zipfile.ZIP_DEFLATED) as z:
        for f in files:
            z.write(f, f"{root}/{f.relative_to(project).as_posix()}")
    digest = hashlib.sha256(a.out.read_bytes()).hexdigest()
    report = {"archive": str(a.out), "sha256": digest, "bytes": a.out.stat().st_size, "files": len(files),
              "selection": how, "excluded_for_secrets": secrets, "checks": checks}
    a.out.with_suffix(".manifest.json").write_text(json.dumps({**report, "contents": sorted(names)}, indent=2) + "\n")
    print(json.dumps(report, indent=2))
    return 1 if secrets or any(c.startswith("MISSING") for c in checks) else 0


def ffprobe(path: Path) -> dict | None:
    if not shutil.which("ffprobe"):
        return None
    out = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration,format_name:stream=codec_type,width,height",
                          "-of", "json", str(path)], capture_output=True, text=True)
    return json.loads(out.stdout) if out.returncode == 0 else {"error": out.stderr.strip()}


def newest_project_change(project: Path) -> tuple[float, str]:
    files, _ = project_files(project, [])
    newest = max(files, key=lambda f: f.stat().st_mtime)
    return newest.stat().st_mtime, newest.relative_to(project).as_posix()


def cmd_media(a) -> int:
    problems, info = [], {}
    newest, newest_file = newest_project_change(a.project.resolve())
    info["newest_project_change"] = f"{dt.datetime.fromtimestamp(newest).isoformat(timespec='seconds')} ({newest_file})"
    for kind, path, exts in (("screenshot", a.screenshot, (".png", ".jpg", ".jpeg", ".webp")),
                             ("recording", a.recording, (".mp4", ".webm", ".mov"))):
        if not path:
            continue
        entry = {"file": str(path), "bytes": path.stat().st_size,
                 "modified": dt.datetime.fromtimestamp(path.stat().st_mtime).isoformat(timespec="seconds")}
        if path.suffix.lower() not in exts:
            problems.append(f"{kind}: {path.suffix} is not one of {', '.join(exts)}")
        probe = ffprobe(path)
        if probe and "error" not in probe:
            vids = [s for s in probe.get("streams", []) if s.get("codec_type") == "video"]
            if vids:
                entry["size"] = f"{vids[0].get('width')}x{vids[0].get('height')}"
            if kind == "recording":
                dur = float(probe.get("format", {}).get("duration") or 0)
                entry["seconds"] = round(dur, 1)
                if not vids:
                    problems.append("recording has no video stream")
                if not 30 <= dur <= 90:
                    problems.append(f"recording is {dur:.0f}s; the brief asks for roughly 30-90s")
        elif probe:
            problems.append(f"{kind}: ffprobe could not read it: {probe['error']}")
        if path.stat().st_mtime < newest:
            problems.append(f"{kind} is older than the latest project change ({newest_file}); confirm it shows the final version or capture it again")
        info[kind] = entry
    print(json.dumps({**info, "problems": problems}, indent=2))
    return 1 if problems else 0


def cmd_after(a) -> int:
    project = a.project.resolve()
    if a.sessions:
        manifest = json.loads((a.sessions / "manifest.json").read_text())
        ends = [t["end_utc"] for t in manifest["threads"] if t.get("end_utc")]
        since = max(dt.datetime.fromisoformat(e) for e in ends)
    else:
        since = dt.datetime.fromisoformat(a.since.replace("Z", "+00:00"))
    if since.tzinfo is None:
        since = since.astimezone()
    files, how = project_files(project, [])
    changed = sorted((f for f in files if f.stat().st_mtime > since.timestamp()), key=lambda f: f.stat().st_mtime)
    result = {"last_codex_turn": since.isoformat(timespec="seconds"), "selection": how,
              "files_changed_after": [f"{dt.datetime.fromtimestamp(f.stat().st_mtime).isoformat(timespec='seconds')}  {f.relative_to(project).as_posix()}" for f in changed]}
    try:
        log = subprocess.run(["git", "-C", str(project), "log", f"--since={since.isoformat()}", "--format=%h %ad %s", "--date=iso"],
                             capture_output=True, text=True, check=True).stdout.strip()
        result["commits_after"] = log.splitlines()
    except (OSError, subprocess.CalledProcessError):
        pass
    print(json.dumps(result, indent=2))
    return 0


GUIDE_PAGE = """<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src 'none'; form-action 'none'">
<title>Manual submission guide</title><style>
body{{font:15px system-ui,sans-serif;max-width:1000px;margin:24px auto;padding:0 16px;color:#222}}
section{{border:1px solid #ccc;border-radius:6px;padding:10px 14px;margin:12px 0}}
section.done{{opacity:.55}} section.ask{{border-color:#c00;background:#fff4f4}}
pre{{white-space:pre-wrap;background:#f6f6f6;padding:8px;border-radius:4px;user-select:all}}
button{{margin-right:8px}} td{{padding:4px 8px;vertical-align:top}} code{{user-select:all}}
</style></head><body>
<h1>Manual submission guide</h1>
<p>Everything here is for you to copy, upload and submit in Feather yourself. This page has no connection to Feather: a Copy button only puts text on your clipboard, and ticks are saved in this browser only. Generated {created}.</p>
{warning}<h2>Files to upload</h2><ul>{files}</ul>
<h2>Form fields</h2>{fields}
<h2>Codex session rows</h2><p>One row per session in Feather, values in this order.</p>{sessions}
<script>
const key='feather-guide:'+location.pathname;
const state=JSON.parse(localStorage.getItem(key)||'{{}}');
document.querySelectorAll('[data-copy]').forEach(b=>b.onclick=()=>navigator.clipboard.writeText(document.getElementById(b.dataset.copy).innerText));
document.querySelectorAll('input[type=checkbox]').forEach(c=>{{c.checked=!!state[c.id];c.closest('section')?.classList.toggle('done',c.checked);
c.onchange=()=>{{state[c.id]=c.checked;localStorage.setItem(key,JSON.stringify(state));c.closest('section')?.classList.toggle('done',c.checked);}};}});
</script></body></html>
"""


def cmd_guide(a) -> int:
    import html
    esc = html.escape
    parts = re.split(r"^## +(.+)$", a.draft.read_text(), flags=re.M)
    fields, asks = [], []
    for i in range(1, len(parts), 2):
        title, body = parts[i].strip(), parts[i + 1].strip()
        ask = "ASK USER" in body
        if ask:
            asks.append(title)
        fields.append(f'<section class="{"ask" if ask else ""}"><h3>{esc(title)}</h3><pre id="f{i}">{esc(body)}</pre>'
                      f'<button data-copy="f{i}">Copy</button><label><input type="checkbox" id="c{i}"> Pasted or selected in Feather</label></section>')
    rows: dict[str, list[str]] = {}
    if a.sessions:
        for line in (a.sessions / "sessions.md").read_text().splitlines():
            cells = [c.strip() for c in line.strip().strip("|").split("|")]
            if len(cells) >= 6 and cells[0] not in ("Session ID", "---") and not set(cells[0]) <= {"-"}:
                if cells[0] in rows:
                    rows[cells[0]][1] += "; " + cells[1]
                else:
                    rows[cells[0]] = cells[:6]
    names = ["Session ID", "Export filenames", "Start", "End", "Model / reasoning", "Codex surface and version"]
    sessions = []
    for n, cells in enumerate(rows.values()):
        trs = "".join(f'<tr><td>{esc(names[k])}</td><td><code id="s{n}_{k}">{esc(v)}</code></td><td><button data-copy="s{n}_{k}">Copy</button></td></tr>'
                      for k, v in enumerate(cells))
        sessions.append(f'<section><h3>Session {n + 1}</h3><table>{trs}</table><label><input type="checkbox" id="sc{n}"> Row added in Feather</label></section>')
    files = "".join(f'<li><a href="{esc(f.resolve().as_uri())}">{esc(f.name)}</a> ({f.stat().st_size:,} bytes)</li>'
                    for f in sorted(a.upload.iterdir()) if f.is_file()) if a.upload else ""
    warning = (f'<p style="color:#c00"><b>Still needs your answer:</b> {esc(", ".join(asks))}</p>' if asks else "")
    a.out.write_text(GUIDE_PAGE.format(created=dt.datetime.now().astimezone().isoformat(timespec="seconds"), warning=warning,
                                       files=files or "<li>None listed</li>", fields="".join(fields), sessions="".join(sessions) or "<p>None</p>"))
    print(f"guide: {a.out}  ({len(fields)} fields, {len(rows)} session rows)")
    if asks:
        print("fields still marked ASK USER: " + ", ".join(asks), file=sys.stderr)
        return 1
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("package")
    p.add_argument("--project", type=Path, required=True)
    p.add_argument("--out", type=Path, required=True)
    p.add_argument("--keep", action="append", default=[], help="include this normally-excluded path, e.g. dist")
    p.add_argument("--root", help="top folder name inside the ZIP (default: project folder name)")
    m = sub.add_parser("media")
    m.add_argument("--project", type=Path, required=True)
    m.add_argument("--screenshot", type=Path)
    m.add_argument("--recording", type=Path)
    t = sub.add_parser("after")
    t.add_argument("--project", type=Path, required=True)
    g = t.add_mutually_exclusive_group(required=True)
    g.add_argument("--since", help="ISO timestamp of the last Codex turn")
    g.add_argument("--sessions", type=Path, help="codex-session-export output folder; uses the latest end time")
    gd = sub.add_parser("guide")
    gd.add_argument("--draft", type=Path, required=True, help="submission-draft.md with one '## ' section per form field")
    gd.add_argument("--sessions", type=Path, help="codex-session-export output folder (sessions.md)")
    gd.add_argument("--upload", type=Path, help="folder holding the files to upload")
    gd.add_argument("--out", type=Path, required=True)
    a = ap.parse_args()
    return {"package": cmd_package, "media": cmd_media, "after": cmd_after, "guide": cmd_guide}[a.cmd](a)


if __name__ == "__main__":
    sys.exit(main())
