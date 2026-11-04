#!/bin/sh
set -eu

file=$1/agents/openai.yaml

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

replace 'display_name: "Handoff"' 'display_name: "Compact Handoff"'
