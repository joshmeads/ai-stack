### Authoring or modifying a skill

**You own the skill's voice.**

1. Write the `SKILL.md`. Its frontmatter has `name` and `description`. The `description` says when to use the skill, front-loads the words a user would say, and stays one YAML scalar: quote it or use `description: >-` with indented continuation lines when punctuation or wrapping requires it. Keep the body short, and move long detail into `references/` files that the body links to.
2. Validate the skill: frontmatter has `name` and `description`, referenced files exist, cross-skill links resolve.
3. Test cases if structural. Skip if subjective.
4. Run **Opening a PR**.

When in doubt, delete. Keep only prose that changes a decision. Tell it to do the thing and skip the reason. Explain only when the rule is confusing without one. Match tone to scope. Point at structural sources (types, READMEs, config) per the **encode-lessons-in-structure** principle skill. Delegate to other skills by path. Don't restate. A workflow you keep hitting but isn't captured → propose a new skill.

**Reply:** summary of the skill, key design decisions, validation notes.
