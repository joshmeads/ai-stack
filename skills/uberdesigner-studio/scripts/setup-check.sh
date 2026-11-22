#!/bin/sh
# What this computer still needs before the design inspector can work, checked in the order the person settles it
# (SKILL.md step 0): 1. Claude Code installed in the terminal, 2. logged in, 3. Node.js, which runs the inspector and
# the skill's scripts. Plain shell on purpose: it has to run on a computer that has no Node yet. It never installs or
# signs in anything, and spends no tokens.
#
#   sh scripts/setup-check.sh              check; print what's left and the person's next step
#   sh scripts/setup-check.sh --wait 600   run in the background while the person does that step: returns as soon as
#                                          it changes (done, or a different problem), or when the seconds run out
#
# Output:
#   READY Claude Code <v> (<who pays>), Node.js <v> at <path>
# or
#   STEPS <the steps left, in order: install-claude, log-in, install-node, update-node>
#   NEXT <step>: <what's wrong, in plain words>
#   PERSON RUNS <command>     the command for the person to run themselves
# Exit 0 when ready, 2 when not, 1 on a bad argument.

NODE_MIN_MAJOR=23
NODE_MIN_MINOR=6
# The person's command for Node.js: the skill's installer next to this script (official build from nodejs.org, checked,
# into the home folder, no password)
HERE=$(cd "$(dirname "$0")" && pwd)
NODE_INSTALL="sh $(echo "$HERE/install-node.sh" | sed "s|^$HOME/|~/|")"
CLAUDE_INSTALL="curl -fsSL https://claude.ai/install.sh | bash"

WAIT=0
if [ "$1" = "--wait" ]; then
  WAIT=${2:-600}
  case $WAIT in '' | *[!0-9]*) echo "usage: sh scripts/setup-check.sh [--wait <seconds>]" >&2; exit 1 ;; esac
elif [ -n "$1" ]; then
  echo "usage: sh scripts/setup-check.sh [--wait <seconds>]" >&2
  exit 1
fi

# Claude Code: where the inspector's server looks for it (claude.ts), in the same order
claude_bin() {
  for b in "$CLAUDE_BIN" "$HOME/.local/bin/claude" /opt/homebrew/bin/claude /usr/local/bin/claude; do
    [ -n "$b" ] && [ -x "$b" ] && { echo "$b"; return; }
  done
  command -v claude 2>/dev/null
}

# Node.js: the newest of the one on the PATH, the skill's own installer's (~/.local/bin, install-node.sh), the
# nodejs.org installer's (/usr/local/bin) and Homebrew's (/opt/homebrew/bin). After installing a new one, an older one can still come first on the PATH; READY then names the
# path to run the scripts with.
node_bin() {
  # NODE_BIN: only this one (tests, or a Node somewhere else); like CLAUDE_BIN for Claude Code
  if [ -n "$NODE_BIN" ]; then [ -x "$NODE_BIN" ] && echo "$NODE_BIN"; return; fi
  best=""
  bestv=0
  for b in "$(command -v node 2>/dev/null)" "$HOME/.local/bin/node" /usr/local/bin/node /opt/homebrew/bin/node; do
    [ -n "$b" ] && [ -x "$b" ] || continue
    v=$("$b" --version 2>/dev/null | sed 's/^v//' | awk -F. '{ printf "%d", $1 * 1000000 + $2 * 1000 + $3 }')
    [ -n "$v" ] && [ "$v" -gt "$bestv" ] && { best=$b; bestv=$v; }
  done
  echo "$best"
}

# The command to give: plain `claude` when that's what the PATH finds, else its path (right after an install,
# ~/.local/bin may not be on the PATH yet)
claude_cmd() {
  if [ "$(command -v claude 2>/dev/null)" = "$1" ]; then echo claude
  else echo "$1" | sed "s|^$HOME/|~/|"; fi
}

check() {
  STEPS=""
  NEXT=""
  CB=$(claude_bin)
  CV=""
  [ -n "$CB" ] && CV=$("$CB" --version 2>/dev/null | awk '{print $1}')
  if [ -z "$CV" ]; then
    STEPS="install-claude log-in"
    NEXT="install-claude: Claude Code isn't installed in the terminal yet (the desktop app and IDEs keep their own copy)"
    PERSON="RUNS $CLAUDE_INSTALL"
  elif [ -n "$ANTHROPIC_API_KEY" ]; then
    WHO="an API key (ANTHROPIC_API_KEY)"
  else
    AUTH=$("$CB" auth status --json 2>/dev/null)
    if echo "$AUTH" | grep -Eq '"loggedIn": *true'; then
      if echo "$AUTH" | grep -Eq '"authMethod": *"claude.ai"'; then WHO="a Claude subscription"; else WHO="an Anthropic Console account"; fi
    else
      STEPS="log-in"
      NEXT="log-in: Claude Code $CV is installed in the terminal but not logged in there (the desktop app and IDEs keep their own login)"
      PERSON="RUNS $(claude_cmd "$CB") auth login"
    fi
  fi

  NB=$(node_bin)
  NV=""
  [ -n "$NB" ] && NV=$("$NB" --version 2>/dev/null | sed 's/^v//')
  if [ -z "$NV" ]; then
    STEPS="$STEPS install-node"
    [ -z "$NEXT" ] && { NEXT="install-node: Node.js isn't installed on this computer"; PERSON="RUNS $NODE_INSTALL"; }
  else
    MAJ=${NV%%.*}
    REST=${NV#*.}
    MIN=${REST%%.*}
    if [ "$MAJ" -lt $NODE_MIN_MAJOR ] || { [ "$MAJ" -eq $NODE_MIN_MAJOR ] && [ "$MIN" -lt $NODE_MIN_MINOR ]; }; then
      STEPS="$STEPS update-node"
      [ -z "$NEXT" ] && { NEXT="update-node: Node.js $NV is too old (uberdesigner studio needs $NODE_MIN_MAJOR.$NODE_MIN_MINOR or newer)"; PERSON="RUNS $NODE_INSTALL"; }
    fi
  fi
  STEPS=$(echo $STEPS)
}

check
if [ "$WAIT" -gt 0 ] && [ -n "$NEXT" ]; then
  FROM=$NEXT
  END=$(($(date +%s) + WAIT))
  while [ "$NEXT" = "$FROM" ] && [ "$(date +%s)" -lt "$END" ]; do
    sleep 3
    check
  done
fi

if [ -z "$NEXT" ]; then
  echo "READY Claude Code $CV ($WHO), Node.js $NV at $NB"
  exit 0
fi
echo "STEPS $STEPS"
echo "NEXT $NEXT"
echo "PERSON $PERSON"
exit 2
