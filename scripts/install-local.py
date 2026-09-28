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
    (repo / 'skills', home / '.claude/skills'),
    (repo / 'skills', home / '.codex/skills'),
    (repo / 'skills', home / '.cursor/skills'),
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
data.setdefault('hooks', {}).setdefault('SessionStart', [])
if hook not in data['hooks']['SessionStart']:
    data['hooks']['SessionStart'].append(hook)
context_command = 'python3 ' + shlex.quote(str(repo / 'scripts/task-context.py'))
for event in ('SessionStart', 'SubagentStart'):
    entry = {'hooks': [{'type': 'command', 'command': context_command, 'async': False}]}
    if event == 'SessionStart':
        entry['matcher'] = 'startup|clear|compact'
    entries = data['hooks'].setdefault(event, [])
    if entry not in entries:
        entries.append(entry)
rendered = json.dumps(data, indent=2) + '\n'
if not settings.exists() or settings.read_text() != rendered:
    settings.parent.mkdir(parents=True, exist_ok=True)
    settings.write_text(rendered)

# One shared skill supplies the policy; startup files only point to it.
start_marker = '<!-- ai-stack:task-discipline:begin -->'
end_marker = '<!-- ai-stack:task-discipline:end -->'
boot = (
    f'Before every task and before dispatching a subagent, read and follow '
    f'`{repo / "skills/task-discipline/SKILL.md"}`. '
    'Pass it to every child; a delegated agent must apply it before acting. '
    'These are the current user preferences for scope, autonomy, prose, tests, '
    'and model routing, replacing older conflicting preferences or pstack defaults. '
    'Questions and problem descriptions request an assessment, not an unrequested fix.'
)
block = start_marker + '\n' + boot + '\n' + end_marker
for path in (home / '.claude/CLAUDE.md', home / '.codex/AGENTS.md', home / '.cursor/rules/ai-stack-task-discipline.mdc'):
    text = path.read_text() if path.exists() else ''
    if start_marker in text or end_marker in text:
        if text.count(start_marker) != 1 or text.count(end_marker) != 1 or text.index(start_marker) >= text.index(end_marker):
            raise SystemExit(f'Invalid task-discipline block in {path}')
        text = text[:text.index(start_marker)] + block + text[text.index(end_marker) + len(end_marker):]
    else:
        if path.suffix == '.mdc' and not text:
            text = '---\ndescription: Apply task discipline and approved model routing.\nalwaysApply: true\n---\n'
        text = text.rstrip() + '\n\n' + block + '\n'
    if not path.exists() or path.read_text() != text:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text)

print(f'Installed {len(links)} native skill/agent links for Claude, Codex, and Cursor.')
print('Start fresh sessions. Update with: python3 ' + str(Path(__file__).resolve()) + ' --update')
