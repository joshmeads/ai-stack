#!/bin/bash
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
prox="${1:-$HOME/Documents/Projects/@joshmeads/prox}"
dest="$HOME/cliproxyapi"
unit_dir="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
umask 077
mkdir -p "$dest" "$unit_dir" "$HOME/.cli-proxy-api"

sh "$prox/scripts/web.sh"
(cd "$prox" && mise exec -- go build -trimpath -ldflags "-X github.com/router-for-me/CLIProxyAPI/v8/internal/buildinfo.Version=$(git describe --tags --always) -X github.com/router-for-me/CLIProxyAPI/v8/internal/buildinfo.Commit=$(git rev-parse --short HEAD)" -o "$dest/cli-proxy-api.new" ./cmd/server)
mv -f "$dest/cli-proxy-api.new" "$dest/cli-proxy-api"

if [ ! -f "$dest/config.yaml" ]; then
    access="$(fnox get HUB_ACCESS_KEY)"
    management="$(fnox get HUB_MANAGEMENT_KEY)"
    if ! [[ "$access" =~ ^[A-Za-z0-9._~-]+$ ]] || ! [[ "$management" =~ ^[A-Za-z0-9._~-]+$ ]]; then
        echo "HUB_ACCESS_KEY and HUB_MANAGEMENT_KEY in fnox must be non-empty plain tokens; an empty access key leaves the hub open" >&2
        exit 1
    fi
    HUB_ACCESS_KEY="$access" HUB_MANAGEMENT_KEY="$management" \
        python3 - "$here/config.yaml.tmpl" "$dest/config.yaml" <<'PY'
import json, os, sys, tempfile
source, target = sys.argv[1:]
text = open(source).read()
for name in ("HUB_ACCESS_KEY", "HUB_MANAGEMENT_KEY"):
    placeholder = f'"@{name}@"'
    value = os.environ[name].strip()
    if text.count(placeholder) != 1 or not value:
        sys.exit(f"cannot render {name} into the config")
    text = text.replace(placeholder, json.dumps(value))
fd, tmp = tempfile.mkstemp(dir=os.path.dirname(target), prefix=".config-")
try:
    with os.fdopen(fd, "w") as out:
        out.write(text)
    os.chmod(tmp, 0o600)
    os.link(tmp, target)
finally:
    os.unlink(tmp)
PY
    echo "wrote $dest/config.yaml"
else
    chmod 0600 "$dest/config.yaml"
    echo "kept the existing $dest/config.yaml"
fi

if ! fnox get HUB_CLICKHOUSE_PASSWORD >/dev/null 2>&1; then
    head -c 40 /dev/urandom | base64 | tr -d '/+=\n' | cut -c1-48 | fnox set -g -d "prox hub clickhouse" HUB_CLICKHOUSE_PASSWORD >/dev/null
fi
clickhouse_password="$(fnox get HUB_CLICKHOUSE_PASSWORD)"
[ -n "$clickhouse_password" ]
printf '%s' "$clickhouse_password" > "$dest/clickhouse.password.new"
chmod 0600 "$dest/clickhouse.password.new"
mv -f "$dest/clickhouse.password.new" "$dest/clickhouse.password"
bash "$prox/hub/clickhouse/up.sh"

install -m 0644 "$here/cliproxyapi.service" "$unit_dir/cliproxyapi.service"
systemctl --user daemon-reload
systemctl --user enable --now cliproxyapi.service
systemctl --user restart cliproxyapi.service
sleep 2
systemctl --user --no-pager --lines=5 status cliproxyapi.service
