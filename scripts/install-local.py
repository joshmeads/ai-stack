#!/usr/bin/env python3
"""Install native Claude, Codex, and Cursor links from this checkout."""
import argparse
import json
from pathlib import Path
import shlex
import subprocess
import sys

repo = Path(__file__).resolve().parents[1]
home = Path.home()
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--update', action='store_true', help='Pull the configured tracking branch, then install')
args = parser.parse_args()
if args.update:
    subprocess.run(['git', '-C', str(repo), 'pull', '--ff-only'], check=True)
    # Run the installer from the newly pulled revision.
    subprocess.run([sys.executable, str(Path(__file__).resolve())], check=True)
    raise SystemExit(0)

sources = [
    (repo / 'plugins/pstack/skills', home / '.claude/skills'),
    (repo / 'plugins/pstack/skills', home / '.codex/skills'),
    (repo / 'plugins/pstack/agents', home / '.claude/agents'),
    (repo / 'vendor/cursor-pstack/skills', home / '.cursor/skills'),
    (repo / 'vendor/cursor-pstack/agents', home / '.cursor/agents'),
    (repo / 'vendor/cursor-team-kit/skills', home / '.cursor/skills'),
]
links = []
for source_root, target_root in sources:
    for source in sorted(source_root.iterdir()):
        if not ((source / 'SKILL.md').is_file() or source.is_file() and source.suffix == '.md'):
            continue
        target = target_root / source.name
        if target.exists() or target.is_symlink():
            if not target.is_symlink() or target.resolve() != source.resolve():
                raise SystemExit(f'Existing path requires manual resolution: {target}')
        links.append((source, target))
for source, target in links:
    target.parent.mkdir(parents=True, exist_ok=True)
    if not target.is_symlink():
        target.symlink_to(source, target_is_directory=source.is_dir())
for source_root, target_root in sources:
    for target in target_root.iterdir():
        if target.is_symlink() and not target.exists() and target.readlink().parent == source_root:
            target.unlink()

settings = home / '.claude/settings.json'
data = json.loads(settings.read_text()) if settings.exists() else {}
hook = {
    'matcher': 'startup|clear|compact',
    'hooks': [{'type': 'command', 'command': f"bash {shlex.quote(str(repo / 'plugins/pstack/hooks/session-start'))} | sed 's/pstack://g'", 'async': False}],
}
entries = data.setdefault('hooks', {}).setdefault('SessionStart', [])
if hook not in entries:
    entries.append(hook)
    settings.parent.mkdir(parents=True, exist_ok=True)
    settings.write_text(json.dumps(data, indent=2) + '\n')

print(f'Installed {len(links)} native skill/agent links for Claude, Codex, and Cursor.')
print('Start fresh sessions. Update with: python3 ' + str(Path(__file__).resolve()) + ' --update')
