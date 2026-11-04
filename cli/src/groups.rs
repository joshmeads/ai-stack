use std::collections::BTreeSet;
use std::path::Path;

use anyhow::{Context as _, Result};
use serde::Serialize;

use crate::stackfile::{self, SkillName, StackFile};

pub const VERSION: u32 = 1;

const CHARS_PER_TOKEN: usize = 4;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Report {
    pub version: u32,
    pub groups: Vec<GroupReport>,
    pub global: Budget,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct GroupReport {
    pub name: String,
    pub global: bool,
    pub includes: Vec<String>,
    pub skills: Vec<String>,
    pub missing: Vec<String>,
    pub tokens: usize,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Budget {
    pub skills: Vec<String>,
    pub missing: Vec<String>,
    pub tokens: usize,
}

pub fn report(stack: &Path, file: &StackFile) -> Result<Report> {
    let budget = |skills: BTreeSet<SkillName>| -> Result<Budget> {
        let mut chars = 0;
        let mut missing = Vec::new();
        for skill in &skills {
            let dir = stack.join(stackfile::SKILLS_DIR).join(skill.as_str());
            if !dir.is_dir() {
                missing.push(skill.to_string());
            }
            chars += frontmatter_chars(&dir.join("SKILL.md"))?;
        }
        Ok(Budget { skills: skills.into_iter().map(String::from).collect(), missing, tokens: chars.div_ceil(CHARS_PER_TOKEN) })
    };
    let mut groups = Vec::new();
    for (name, group) in &file.groups {
        let Budget { skills, missing, tokens } = budget(stackfile::resolve(&file.groups, [name]))?;
        groups.push(GroupReport {
            name: name.to_string(),
            global: group.global,
            includes: group.includes.iter().map(ToString::to_string).collect(),
            skills,
            missing,
            tokens,
        });
    }
    Ok(Report { version: VERSION, groups, global: budget(file.global_skills())? })
}

impl Report {
    pub fn text(&self) -> String {
        let width = self.groups.iter().map(|group| group.name.len()).chain(["global set".len()]).max().unwrap_or_default();
        let mut out = format!("{:<width$}  {:<6}  {:>6}  {:>6}  skills\n", "group", "global", "count", "tokens");
        for group in &self.groups {
            let global = if group.global { "yes" } else { "no" };
            out.push_str(&format!("{:<width$}  {global:<6}  {:>6}  {:>6}  {}\n", group.name, group.skills.len(), group.tokens, group.skills.join(", ")));
        }
        out.push_str(&format!("{:<width$}  {:<6}  {:>6}  {:>6}\n", "global set", "", self.global.skills.len(), self.global.tokens));
        out
    }
}

fn frontmatter_chars(path: &Path) -> Result<usize> {
    let text = match std::fs::read_to_string(path) {
        Ok(text) => text,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => return Ok(0),
        Err(err) => return Err(err).with_context(|| format!("reading {}", path.display())),
    };
    Ok(["name", "description"].iter().filter_map(|key| frontmatter_value(&text, key)).map(|value| value.chars().count()).sum())
}

pub fn frontmatter_value(text: &str, key: &str) -> Option<String> {
    let mut lines = text.lines();
    if lines.next()?.trim_end() != "---" {
        return None;
    }
    let block: Vec<&str> = lines.take_while(|line| line.trim_end() != "---").collect();
    let start = block.iter().position(|line| line.strip_prefix(key).is_some_and(|rest| rest.starts_with(':')))?;
    let value = block[start][key.len() + 1..].trim();
    if value.starts_with('>') || value.starts_with('|') {
        let body: Vec<&str> = block[start + 1..].iter().take_while(|line| line.is_empty() || line.starts_with(' ') || line.starts_with('\t')).map(|line| line.trim()).filter(|line| !line.is_empty()).collect();
        return Some(body.join(" "));
    }
    let unquoted = value.strip_prefix('"').and_then(|v| v.strip_suffix('"')).or_else(|| value.strip_prefix('\'').and_then(|v| v.strip_suffix('\''))).unwrap_or(value);
    Some(unquoted.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_plain_quoted_and_folded_values() {
        let text = "---\nname: handoff\ndescription: >\n  Write a packet\n  for later.\nother: \"x\"\n---\nname: body\n";
        assert_eq!(frontmatter_value(text, "name").as_deref(), Some("handoff"));
        assert_eq!(frontmatter_value(text, "description").as_deref(), Some("Write a packet for later."));
        assert_eq!(frontmatter_value(text, "other").as_deref(), Some("x"));
        assert_eq!(frontmatter_value("no frontmatter\n", "name"), None);
    }

    #[test]
    fn budgets_count_each_skill_once_in_the_global_set() {
        let dir = tempfile::tempdir().unwrap();
        let stack = dir.path();
        for (name, description) in [("aaaaaaaa", "bbbbbbbb"), ("cccc", "dddddddddddd"), ("eeee", "")] {
            std::fs::create_dir_all(stack.join("skills").join(name)).unwrap();
            std::fs::write(stack.join("skills").join(name).join("SKILL.md"), format!("---\nname: {name}\ndescription: {description}\n---\n")).unwrap();
        }
        std::fs::write(stack.join("stack.toml"), concat!(
            "[groups.base]\nskills = [\"aaaaaaaa\", \"cccc\"]\n",
            "[groups.more]\nglobal = true\nincludes = [\"base\"]\nskills = [\"cccc\"]\n",
            "[groups.solo]\nglobal = true\nskills = [\"eeee\", \"aaaaaaaa\", \"grill\"]\n\n",
            "[[skill]]\nname = \"grill\"\nsource = \"https://example.com/s\"\npath = \"grill\"\ncommit = \"0123456789abcdef0123456789abcdef01234567\"\n",
        )).unwrap();
        let report = report(stack, &stackfile::load(stack).unwrap()).unwrap();
        assert_eq!(serde_json::to_value(&report).unwrap(), serde_json::json!({
            "version": 1,
            "groups": [
                {"name": "base", "global": false, "includes": [], "skills": ["aaaaaaaa", "cccc"], "missing": [], "tokens": 8},
                {"name": "more", "global": true, "includes": ["base"], "skills": ["aaaaaaaa", "cccc"], "missing": [], "tokens": 8},
                {"name": "solo", "global": true, "includes": [], "skills": ["aaaaaaaa", "eeee", "grill"], "missing": ["grill"], "tokens": 5},
            ],
            "global": {"skills": ["aaaaaaaa", "cccc", "eeee", "grill"], "missing": ["grill"], "tokens": 9},
        }));
        assert!(report.text().ends_with("solo        yes          3       5  aaaaaaaa, eeee, grill\nglobal set               4       9\n"), "{}", report.text());
    }
}
