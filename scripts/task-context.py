#!/usr/bin/env python3
"""Inject the shared task instructions into a Claude session or subagent."""
import json
from pathlib import Path
import sys

context = (Path(__file__).resolve().parents[1] / 'skills/task-discipline/SKILL.md').read_text()
event = json.load(sys.stdin)['hook_event_name']
if event not in ('SessionStart', 'SubagentStart'):
    raise SystemExit(f'Unsupported hook event: {event}')
print(json.dumps({'hookSpecificOutput': {'hookEventName': event, 'additionalContext': context}}))
