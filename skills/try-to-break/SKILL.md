---
name: try-to-break
description: "Use when you have to break a change, feature or integration on purpose before a merge or release, hunting logic, state or security failures with evidence. Not a style review; for a multi-model diff read use pstack:interrogate, and for effects outside the diff use pstack:blast-radius."
---

# Try to break it

Normal checks show the intended path works. Your job is the opposite: find
where it doesn't. Think like a careless user, a hostile user and an unreliable
network, and aim at what the change is supposed to guarantee. Spend effort in
proportion to the change and its risk.

Keep to the requested scope. Any review delegation follows the routing block
in your global instructions. The parent chooses the route; a child neither
delegates nor reroutes itself.

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
