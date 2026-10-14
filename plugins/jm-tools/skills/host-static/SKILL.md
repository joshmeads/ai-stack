---
name: host-static
description: Host a built static folder (a demo, playground or build preview) at an unlisted URL, https://games.joshmeads.dev/hosted/<slug>/. Use when the user asks to host, publish or share a static build on games.joshmeads.dev or wants a URL for a demo without listing it on the site.
---

# Host a static folder

The logic lives in `scripts/host.sh` of the games deploy repo on `cachy`:
`~/Documents/Projects/@joshmeads/games/deploy/.claude/worktrees/host` (branch `host-caddy`). It copies the folder to `hosted/<slug>/` on the `site` branch, commits only that path, releases it, checks for a 200 and prints the URL. Nothing on the site links to it.

1. Build with relative asset paths (Vite: `--base ./`). Pick a slug of lowercase letters, digits and dashes. Rerunning with the same slug replaces that page.
2. Pass the page to open as ENTRY when the folder's `index.html` is not the one to land on; the root then redirects there.
3. Run it. On cachy, call the script directly. From another machine, copy the folder over first:

```sh
rsync -a --delete <dir>/ cachy:/tmp/host-<slug>/
ssh cachy '~/Documents/Projects/@joshmeads/games/deploy/.claude/worktrees/host/scripts/host.sh /tmp/host-<slug> <slug> [entry.html] && rm -rf /tmp/host-<slug>'
```

4. Report the printed URL. If the script fails on SSH, the git push or SSM credentials, report the error; do not create or enter credentials.

Do not edit other paths of the `site` branch or run `deploy.sh` for this; that rebuilds the whole site.
