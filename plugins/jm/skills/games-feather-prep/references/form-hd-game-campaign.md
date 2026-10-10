# Form reference: 09_ai-hd-game-campaign-a (seen 2026-10-09)

Fields as they appeared on the task page on 2026-10-09. Forms change between
campaigns and over time. Before drafting, compare this list with the field
list the user pastes or screenshots, and use theirs wherever they differ. Never
open Feather yourself. Add a note at the top of this
file when you find a difference.

Fields marked * are required.

| # | Field | Type | Who supplies it |
| --- | --- | --- | --- |
| 1 | Which tools or workflows did you use? * | Checkboxes: Codex; Manual coding in a code editor or IDE; Game-creation or prototyping tools; Visual-design, graphics, animation, or 3D-modeling tools; Audio or music tools; Existing assets, templates, libraries, or references; Feedback or playtesting from another person; Other | Draft from evidence; user confirms |
| 2 | Tools and workflow details * | Text: specific tools and how each was used | Draft from evidence; user confirms |
| 3 | Complete final game project * | Upload: ZIP or TAR with editable source, assets, dependency manifests and lockfiles, README, and any browser export needed to run. No credentials, dependency caches or unnecessary generated files | `prep.py package` |
| 4 | How to run and review the game * | Text: runtime and version, install and start commands, local URL, browser and version tested, controls, objective or main interaction, remaining issues ("None" if none), setup or sample data | Draft from README + `games-tools-web-qa` run; user confirms remaining issues |
| 5 | Screenshot of the exact submitted version * | Upload: one PNG, JPEG or WebP of representative gameplay | User captures; `prep.py media` checks |
| 6 | Short gameplay recording * | Upload: roughly 30-90 s MP4, WebM or MOV of actual play in the submitted version, showing main controls and loop with feedback or outcomes. Narration not required | User records; `prep.py media` checks |
| 7 | Complete Codex conversation (required if Codex was used) | Upload: original complete export, preferably `session.md` (Codex `/export`) or the native JSON/JSONL. Several sessions: one ZIP of all originals | `codex-session-export` |
| 8 | Codex sessions used for this submission (required if Codex was used) | Repeating entries, one per contributing conversation, matched to its export file: session ID, export filename(s), start/end timestamps with timezone, model/reasoning settings, Codex app/CLI/IDE version | `codex-session-export` `sessions.md` |
| 9 | Starting materials and reused content * | Text: scratch, template or existing project; source name/link; what was already present; what was reused (code, design systems, assets). If none: "Started from scratch; no pre-existing materials." | User; draft from repo history if available |
| 10 | Work done outside Codex * | Text: what was created or changed manually or with other tools, human feedback used, tools and affected features/files. "None." if none | User; `prep.py after` lists candidate files |
| 11 | Changes after the final Codex interaction (required if Codex was used) | Text: changes after the last exported Codex turn, tools, affected features/files. "None." if none | `prep.py after` + user |
| Q1 | About how much active working time did you spend? Exclude breaks. * | Choice | **User only** |
| Q2 | How complete is the game relative to the requested scope? * | Choice | **User only** |
| Q3 | Why did you stop? * | Choice | **User only** |
| Q4 | Would you submit this web game to a paying client? * | Choice | **User only** |
| Q5 | How playable is the main gameplay loop? * | Choice | **User only** (QA evidence can inform it) |
| Q6 | How did you turn your initial idea, design, or prototype into a playable browser game? Describe the main steps and any handoffs between tools. | Text | Draft from session history; user rewrites in their words |
| Q7 | Did you use any AI tool other than Codex? * | Choice | **User only**; answer accurately |
| Q8 | Roughly what share of your active working time was spent using Codex? * | Choice | **User only** |
| Q9 | Which tool or workflow contributed most to the quality of the final game? * | Checkboxes (same list as field 1) | **User only** |

Choice options for Q1-Q5, Q7 and Q8 were not visible in the screenshots.
Ask the user to paste them; the user selects them in Feather.

Task rules that affect preparation:

- If an AI tool is used, only Codex is allowed.
- Upload the original complete exports, not summaries or excerpts, including
  all prompts, replies and tool interactions the export exposes.
- Use the campaign account and setup specified by the lead. Check that session
  IDs and exports are available before substantial Codex work.
- Do not guess session IDs or replace an export with a summary.
- Before submitting: the project runs from the supplied instructions; the
  screenshot and recording show that exact version; the uploaded exports are
  readable, include every contributing conversation through its final
  interaction, and match the listed session IDs and files; starting materials,
  outside work and post-Codex changes are described accurately.
