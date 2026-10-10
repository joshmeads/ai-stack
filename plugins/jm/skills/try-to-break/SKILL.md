---
name: try-to-break
description: >
  Try to break a feature, change or integration on purpose and report what
  fails, with evidence. Use when asked to try to break something, test
  adversarially, or look for logic, state or security failures before a merge
  or release. Any kind of app or game. Not a style or architecture review.
---

# Try to break it

Normal checks show the intended path works. Your job is the opposite: find
where it doesn't. Think like a careless user, a hostile user and an unreliable
network, and aim at what the change is supposed to guarantee. Spend effort in
proportion to the change and its risk.

Follow `/home/me/.local/share/open-pstack/skills/task-discipline/SKILL.md` for
scope, autonomy and model routing.

Use your judgement on what to attack and how. A few things are not optional:

- **Real behaviour, not assumptions.** Exercise the actual code through its
  real entry points. Passing tests and summaries are leads, not proof.
- **Safe targets only.** Disruptive attempts run against local or test
  environments. Never touch production, third-party systems or real users'
  data without explicit permission. If a check needs access you don't have,
  say exactly what's missing rather than faking it.
- **Honest evidence.** Report what you saw, with enough to reproduce it.
  Keep confirmed failures, unconfirmed suspicions and untested areas clearly
  apart. Finding nothing is a valid result, not a guarantee.
- **Report, don't fix,** unless you are inside a build that already
  authorises repairs; then fix only the requested behaviour and recheck it.

End with a short report: what broke and how to reproduce it, what you
suspect but couldn't confirm, and what you didn't cover.
