#!/bin/sh
set -eu

file=$1/SKILL.md

replace() {
  if ! grep -qF -- "$1" "$file"; then
    echo "skill patch: expected text not found in $file: $1" >&2
    exit 1
  fi
  awk -v old="$1" -v new="$2" '
    {
      out = ""
      rest = $0
      while ((i = index(rest, old)) > 0) {
        out = out substr(rest, 1, i - 1) new
        rest = substr(rest, i + length(old))
      }
      print out rest
    }
  ' "$file" > "$file.patched"
  mv "$file.patched" "$file"
}

replace '## Updating uberdesigner studio' '## Updating uberdesigner studio\n\nThis copy is vendored by ai-stack, so `<skill>` lives inside the ai-stack checkout and step 1 would find it installed another way. In place of steps 1 and 2, give the person `ai-stack skills update uberdesigner-studio` to run in their terminal, wait for them to say it ran, tell them what is new from `CHANGELOG.md`, run step 0'\''s check, then go to step 3.'
