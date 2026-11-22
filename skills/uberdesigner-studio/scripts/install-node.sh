#!/bin/sh
# Installs Node.js for the design inspector, for the person to run themselves (SKILL.md step 0): the current LTS
# version, downloaded from nodejs.org, its checksum checked against nodejs.org's own list, unpacked into the home folder
# (~/.local/share/node) and linked into ~/.local/bin, where Claude Code's own command lives. No password, nothing
# outside the home folder, nothing else on the computer touched. Running it again with Node already current does
# nothing.
#
#   sh install-node.sh

set -eu

DIST="https://nodejs.org/dist"
ROOT="$HOME/.local/share/node"
BIN="$HOME/.local/bin"

say() { printf '%s\n' "$*"; }
fail() { say "Couldn't install Node.js: $*"; say "You can also install it from https://nodejs.org/en/download instead."; exit 1; }

case "$(uname -s)" in
  Darwin) os=darwin ;;
  Linux) os=linux ;;
  *) fail "this installer is for macOS and Linux." ;;
esac
case "$(uname -m)" in
  arm64 | aarch64) arch=arm64 ;;
  x86_64 | amd64) arch=x64 ;;
  *) fail "this computer's processor ($(uname -m)) isn't one it knows." ;;
esac

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

say "Finding the current Node.js (LTS) on nodejs.org…"
# index.tab lists every release, newest first; the tenth column names the LTS line ("-" when it isn't one)
curl -fsSL "$DIST/index.tab" -o "$tmp/index.tab" || fail "nodejs.org didn't answer. Check the internet connection and run it again."
version=$(awk -F'\t' 'NR > 1 && $10 != "-" { print $1; exit }' "$tmp/index.tab")
[ -n "$version" ] || fail "nodejs.org's release list didn't name a current version."

if [ -x "$BIN/node" ] && [ "$("$BIN/node" --version 2>/dev/null)" = "$version" ]; then
  say "Node.js $version is already installed. Nothing to do."
  exit 0
fi

file="node-$version-$os-$arch.tar.gz"

say "Downloading Node.js $version (about 50 MB)…"
curl -fsSL "$DIST/$version/$file" -o "$tmp/$file" || fail "the download didn't finish. Run it again."
curl -fsSL "$DIST/$version/SHASUMS256.txt" -o "$tmp/SHASUMS256.txt" || fail "couldn't get nodejs.org's checksum list."

say "Checking the download against nodejs.org's checksum…"
want=$(awk -v f="$file" '$2 == f { print $1 }' "$tmp/SHASUMS256.txt")
if command -v shasum >/dev/null 2>&1; then got=$(shasum -a 256 "$tmp/$file" | awk '{ print $1 }')
else got=$(sha256sum "$tmp/$file" | awk '{ print $1 }'); fi
[ -n "$want" ] && [ "$want" = "$got" ] || fail "the download doesn't match nodejs.org's checksum, so it wasn't installed."

say "Installing…"
mkdir -p "$ROOT" "$BIN"
rm -rf "$ROOT/$version"
mkdir "$ROOT/$version"
tar -xzf "$tmp/$file" -C "$ROOT/$version" --strip-components 1
for tool in node npm npx corepack; do
  [ -e "$ROOT/$version/bin/$tool" ] && ln -sf "$ROOT/$version/bin/$tool" "$BIN/$tool"
done

say "Done: Node.js $("$BIN/node" --version) is installed in your home folder."
case ":$PATH:" in
  *":$BIN:"*) ;;
  *) say "(New terminal windows may need it added to the PATH; uberdesigner studio finds it either way.)" ;;
esac
