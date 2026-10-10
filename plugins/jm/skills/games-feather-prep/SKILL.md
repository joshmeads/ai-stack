---
name: games-feather-prep
description: >
  Prepare a Codex-built web game for submission on an OpenAI Feather task,
  entirely locally: package the project, check the screenshot and recording,
  export the contributing Codex sessions, draft every form field from
  evidence, collect the answers only the user can give, and produce an offline
  copy-and-upload guide. The user does every Feather action by hand. Use when
  asked to prepare, package or check a Feather game submission.
---

# Feather submission prep

This skill prepares materials, a draft and a guide on this computer. It never
answers the user's questionnaire for them.

**No automation in Feather.** Campaign leads have said automating anything in
Feather can get the account banned. Do not open, read, fill, paste into,
upload to or submit Feather through browser tools, computer use, scripts,
extensions or simulated input, even when asked to "fill the form". If the user
asks for that, explain the rule and give them the guide instead.

The form changes between campaigns. Ask the user to paste the task
instructions and the form's field list (or share screenshots of them), then
compare them with `references/form-hd-game-campaign.md`. Where they differ,
what the user supplied wins.

Scripts:

- `scripts/prep.py`: package the project, check media, list changes after the
  last Codex turn (Python 3.11+, standard library; `ffprobe` for media).
- The `codex-session-export` skill: find, export and verify the Codex
  sessions.
- The `games-tools-web-qa` skill: run the game from its README and record evidence
  for the run instructions and remaining issues.

Keep everything in one private working folder outside the game project, for
example `~/feather/<task-slug>/`. It holds the exports, archives, draft and
notes. None of it goes into the game repository.

## 1. Gather inputs

Ask once, together, for whatever is missing:

- the game project folder;
- the task instructions and the form's field list, pasted or as screenshots;
- the screenshot and the 30-90 s recording, if they already exist;
- any sessions run on another computer (their `~/.codex/sessions` files).

## 2. Sessions

Follow `codex-session-export`:

1. `scan --project <game>`, then decide which threads contributed and why.
2. Export the contributing threads with `--zip codex-sessions.zip` into
   `<work>/sessions/`.
3. `verify` immediately before upload. If an original changed, export again.
4. Tell the user that `/export` in the interactive Codex CLI produces the
   preferred `session.md`. Offer it as an addition to the JSONL originals.

## 3. Project archive

```sh
python3 scripts/prep.py package --project <game> --out <work>/upload/<game>.zip [--keep dist]
```

- Exit code 1 means a secret was found or the README is missing. Stop and
  show the user the file and line. Do not edit the project yourself: the user
  removes the secret (and rotates the key if it was ever shared), then you
  re-run.
- Use `--keep dist` (or the build folder) only when the README's run steps
  need the built output.
- Open the archive's manifest and check that every source, asset and lockfile
  the game needs is present. Then follow the README from the extracted
  archive, using the `games-tools-web-qa` skill. The archive passes only if the game
  runs from it.

## 4. Media

```sh
python3 scripts/prep.py media --project <game> --screenshot <png> --recording <mp4>
```

Fix every problem it lists, or get the user's explicit confirmation that the
media shows the final version. Look at the screenshot yourself. The user
captures the screenshot and records the gameplay; do not generate either.

## 5. Changes after the last Codex turn

```sh
python3 scripts/prep.py after --project <game> --sessions <work>/sessions
```

This lists files and commits newer than the last exported Codex turn. Show the
list to the user and ask what each change was. If the list is empty and
nothing else changed, the answer is "None."

## 6. Draft the form

Write `<work>/submission-draft.md` with one `## ` section per form field, in
form order. Fill from evidence:

- **Tools (field 1) and details (field 2):** Codex if sessions were exported;
  manual coding if `after` found changes or the user describes edits; other
  tools only when the user names them.
- **How to run and review:** the exact commands, versions and URL from the
  `games-tools-web-qa` run, the controls, the objective, and the QA report's
  remaining issues.
- **Sessions:** one entry per row of `sessions.md`, with the exact values.
- **Starting materials, outside work, post-Codex changes:** draft from repo
  history and `after`, marked as drafts for the user to correct.
- **Q6 (idea to playable game):** a factual outline from the session history,
  marked as a draft the user should rewrite in their own words.

Mark every **User only** field (`references/form-hd-game-campaign.md`) as
`ASK USER` and ask all of them together, offering the options the user supplied.
Record the user's answers verbatim. Never infer working time, completeness,
readiness, playability, AI use or tool shares.

## 7. Final check

Before handing over, confirm each item and show the evidence:

- [ ] The archive runs from its README (QA report attached).
- [ ] Screenshot and recording show this exact version (`media` clean, or user
      confirmed).
- [ ] `verify` passes; every contributing thread is included through its final
      turn; the session entries match the export filenames.
- [ ] Starting materials, outside work and post-Codex changes are described.
- [ ] Every `ASK USER` field has the user's own answer.
- [ ] No secrets in any upload.

## 8. Manual handoff

Ask the user to confirm that the screenshot, recording, archive and sessions
are the version they will submit, and record their words in the draft. Then
build the guide:

```sh
python3 scripts/prep.py guide --draft <work>/submission-draft.md \
  --sessions <work>/sessions --upload <work>/upload --out <work>/manual-guide.html
```

It writes one offline page: links to the files to upload, every draft field
with a Copy button, and one block per Codex session with its six values (ID,
export filenames, start, end, model/reasoning, surface and version). Ticks
save in the browser as a checklist. The page has no network access. Exit code
1 means a field still says `ASK USER`; get the answer and rebuild.

Tell the user to open the guide, paste and upload each item into Feather
themselves, select the questionnaire answers themselves, reload Feather to
check everything saved, and submit. A prepared package is not "submitted".
