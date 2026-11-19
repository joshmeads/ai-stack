#!/bin/bash
set -euo pipefail
hub_host=cachy
if [ "$(hostname -s)" = "$hub_host" ]; then
    url="${1:-http://127.0.0.1:8317}"
else
    url="${1:-http://$hub_host:8317}"
fi
key="$(fnox get HUB_ACCESS_KEY)"
if ! [[ "$key" =~ ^[A-Za-z0-9._~-]+$ ]]; then
    echo "HUB_ACCESS_KEY in fnox is empty or not a plain token" >&2
    exit 1
fi
status="$(printf 'header = "Authorization: Bearer %s"\n' "$key" | curl -q -s -K - -o /dev/null -w '%{http_code}' "$url/v1/models" || true)"
if [ "$status" != "200" ]; then
    echo "hub $url answered $status with this machine's key; nothing changed" >&2
    exit 1
fi
claude_home="$HOME/.claude-hub"
codex_home="$HOME/.codex-hub"
bin="$HOME/.local/bin"
umask 077
if { [ -e "$bin" ] || [ -L "$bin" ]; } && [ ! -d "$bin" ]; then
    echo "$bin exists and is not a directory; nothing changed" >&2
    exit 1
fi

link_shared() {
    local from="$1" to="$2"
    shift 2
    for name in "$@"; do
        [ -e "$from/$name" ] || continue
        if [ -L "$to/$name" ] || [ ! -e "$to/$name" ]; then
            ln -sfn "$from/$name" "$to/$name"
        else
            echo "kept $to/$name: it is a real file or directory, not a link to $from/$name" >&2
        fi
    done
}

HUB_URL="$url" HUB_ACCESS_KEY="$key" python3 - "$HOME" "$claude_home" "$codex_home" <<'PY'
import copy, json, os, re, sys, tempfile

try:
    import tomllib
except ImportError:
    sys.exit("hub/client.sh needs Python 3.11 or newer (tomllib); nothing changed")

home, claude_home, codex_home = sys.argv[1:]
url, key = os.environ["HUB_URL"], os.environ["HUB_ACCESS_KEY"]


def write_private(path, text):
    fd, tmp = tempfile.mkstemp(dir=os.path.dirname(path), prefix=".hub-")
    try:
        with os.fdopen(fd, "w") as out:
            out.write(text)
        os.chmod(tmp, 0o600)
        os.replace(tmp, path)
    except BaseException:
        os.unlink(tmp)
        raise


def read_json(path):
    try:
        with open(path) as f:
            return json.load(f)
    except FileNotFoundError:
        return {}


ROOT_PROVIDER = r"(?m)^[ \t]*[\"']?model_provider[\"']?[ \t]*=[^\n]*(\n|$)"
PROX = {
    "name": "prox hub",
    "base_url": url + "/v1",
    "wire_api": "responses",
    "requires_openai_auth": False,
    "supports_websockets": True,
    "experimental_bearer_token": key,
}


def normalized(tree):
    tree = copy.deepcopy(tree)
    if tree.get("model_providers") == {}:
        tree.pop("model_providers")
    return tree


def parses_to(text, expected):
    try:
        return normalized(tomllib.loads(text)) == normalized(expected)
    except tomllib.TOMLDecodeError:
        return False


def give_up():
    sys.exit("cannot edit the Codex config without changing anything else; nothing changed")


def codex_config(text):
    try:
        parsed = tomllib.loads(text)
    except tomllib.TOMLDecodeError as err:
        sys.exit(f"~/.codex/config.toml does not parse ({err}); nothing changed")
    expected = copy.deepcopy(parsed)
    if "model_provider" in expected:
        expected.pop("model_provider")
        for match in reversed(list(re.finditer(ROOT_PROVIDER, text))):
            candidate = text[:match.start()] + text[match.end():]
            if parses_to(candidate, expected):
                text = candidate
                break
        else:
            give_up()
    if "prox" in expected.get("model_providers", {}):
        sys.exit("~/.codex/config.toml already defines a prox provider; the hub home adds its own, so remove it there; nothing changed")
    provider = "[model_providers.prox]\n" + "".join(
        f"{name} = {json.dumps(value)}\n" for name, value in PROX.items()
    )
    config = 'model_provider = "prox"\n' + text.rstrip("\n") + "\n\n" + provider
    final = copy.deepcopy(expected)
    final["model_provider"] = "prox"
    final.setdefault("model_providers", {})["prox"] = PROX
    if not parses_to(config, final):
        sys.exit("the hub Codex config did not come out as expected; nothing changed")
    return config


settings = read_json(os.path.join(home, ".claude", "settings.json"))
settings.setdefault("env", {})
settings["env"].update({"ANTHROPIC_BASE_URL": url, "ANTHROPIC_AUTH_TOKEN": key})
settings["promptCacheTtl"] = "1h"
settings.pop("remoteControlAtStartup", None)

servers = read_json(os.path.join(home, ".claude.json")).get("mcpServers") or {}
state_path = os.path.join(claude_home, ".claude.json")
state = None
if servers or os.path.exists(state_path):
    state = read_json(state_path)
    state["mcpServers"] = servers

try:
    with open(os.path.join(home, ".codex", "config.toml")) as f:
        codex_text = f.read()
except FileNotFoundError:
    codex_text = ""
codex = codex_config(codex_text)

for directory in (claude_home, codex_home):
    os.makedirs(directory, mode=0o700, exist_ok=True)
write_private(os.path.join(claude_home, "settings.json"), json.dumps(settings, indent=2) + "\n")
if state is not None:
    write_private(state_path, json.dumps(state, indent=2) + "\n")
write_private(os.path.join(codex_home, "config.toml"), codex)
PY

link_shared "$HOME/.claude" "$claude_home" CLAUDE.md pstack-models.md agents skills plugins commands keybindings.json
link_shared "$HOME/.codex" "$codex_home" AGENTS.md pstack-models.md skills rules plugins hooks
mkdir -p "$bin"
cat > "$bin/claude-hub" <<EOF
#!/bin/sh
CLAUDE_CONFIG_DIR="$claude_home" CODEX_HOME="$codex_home" exec claude "\$@"
EOF
cat > "$bin/codex-hub" <<EOF
#!/bin/sh
CLAUDE_CONFIG_DIR="$claude_home" CODEX_HOME="$codex_home" exec codex "\$@"
EOF
cat > "$bin/claudex" <<EOF
#!/bin/sh
CLAUDE_CONFIG_DIR="$claude_home" CODEX_HOME="$codex_home" CLAUDE_CODE_SUBAGENT_MODEL=gpt-6.2-sol CLAUDE_CODE_ALWAYS_ENABLE_EFFORT=1 CLAUDE_CODE_MAX_TOOL_USE_CONCURRENCY=3 ENABLE_TOOL_SEARCH=false exec claude --model gpt-6.2-sol "\$@"
EOF
chmod 0755 "$bin/claude-hub" "$bin/codex-hub" "$bin/claudex"
echo "hub $url: 200 with this machine's key; hub homes updated"
