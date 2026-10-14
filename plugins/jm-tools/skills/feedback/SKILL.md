---
name: feedback
description: >
  Record the user's feedback on the current project in FEEDBACK.md: a dated
  entry with the newest at the top, in the user's own words. Use when the user
  gives review notes, playtest feedback, change requests or reviewer comments
  and asks to log, save, note or record them, or invokes this skill. Only
  records; it does not act on the feedback.
---

# Feedback log

Write the feedback down exactly as given so later work (for example the
`jm-games:final` stage) can act on it. Do not start changing the project.

## File

`FEEDBACK.md` in the project root. If a `feedback.md` already exists, use that
file instead of creating a second one.

```markdown
# Feedback

## 2026-10-10 14:32 (-07:00)

- First point, in the user's words.
- Second point.

## 2026-10-08 09:05 (-07:00)

- Older feedback.
```

## Steps

1. Get the date and time from the system clock (`date '+%Y-%m-%d %H:%M (%:z)'`).
   Never guess it.
2. Create the file with the `# Feedback` title if it does not exist.
3. Insert the new entry directly under the title, above every earlier entry.
   Never edit, reorder or delete earlier entries.
4. Keep the user's wording. Split it into one bullet per separate point, fix
   nothing but obvious typos, and add nothing: no interpretation, priority or
   plan. If the user names who the feedback is from (a reviewer, a
   playtester), put that in parentheses after the heading's time.
5. Attached screenshots or files: copy them into `feedback/<date>/` and link
   them from the bullet they belong to.
6. Reply with the entry as written and the file path.
