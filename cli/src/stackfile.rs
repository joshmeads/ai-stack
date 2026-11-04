use std::collections::{BTreeMap, BTreeSet};
use std::fmt;
use std::path::{Component, Path, PathBuf};

use anyhow::{Context as _, Result, anyhow, bail, ensure};
use serde::{Deserialize, Deserializer, Serialize};

pub const FILE: &str = "stack.toml";
pub const SKILLS_DIR: &str = "skills";
pub const DEFAULT_DEST: &str = SKILLS_DIR;
pub const DEFAULT_REF: &str = "HEAD";

#[derive(Clone, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(try_from = "String", into = "String")]
pub struct Name(String);

pub type GroupName = Name;
pub type SkillName = Name;

impl Name {
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl TryFrom<String> for Name {
    type Error = anyhow::Error;
    fn try_from(name: String) -> Result<Name> {
        plain_name(&name)?;
        Ok(Name(name))
    }
}

impl TryFrom<&str> for Name {
    type Error = anyhow::Error;
    fn try_from(name: &str) -> Result<Name> {
        Name::try_from(name.to_string())
    }
}

impl From<Name> for String {
    fn from(name: Name) -> String {
        name.0
    }
}

impl fmt::Debug for Name {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        fmt::Debug::fmt(&self.0, f)
    }
}

impl fmt::Display for Name {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

impl std::borrow::Borrow<str> for Name {
    fn borrow(&self) -> &str {
        &self.0
    }
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct StackFile {
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub groups: BTreeMap<GroupName, Group>,
    #[serde(default, rename = "skill", skip_serializing_if = "Vec::is_empty")]
    pub skills: Vec<Skill>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Group {
    #[serde(default)]
    pub global: bool,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub includes: Vec<GroupName>,
    #[serde(default)]
    pub skills: Vec<SkillName>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Skill {
    pub name: SkillName,
    pub source: String,
    pub path: String,
    #[serde(rename = "ref", default = "default_ref")]
    pub git_ref: String,
    pub commit: String,
    #[serde(default = "default_dest")]
    pub dest: String,
    #[serde(rename = "move", default, skip_serializing_if = "Option::is_none")]
    pub rename: Option<SkillName>,
    #[serde(default, deserialize_with = "one_or_many", skip_serializing_if = "Vec::is_empty")]
    pub process: Vec<Step>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Step {
    #[serde(rename = "type")]
    pub kind: StepKind,
    pub input: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum StepKind {
    Script,
    Prompt,
}

fn default_ref() -> String {
    DEFAULT_REF.into()
}
fn default_dest() -> String {
    DEFAULT_DEST.into()
}

fn one_or_many<'de, D: Deserializer<'de>>(deserializer: D) -> Result<Vec<Step>, D::Error> {
    #[derive(Deserialize)]
    #[serde(untagged)]
    enum OneOrMany {
        One(Step),
        Many(Vec<Step>),
    }
    Ok(match OneOrMany::deserialize(deserializer)? {
        OneOrMany::One(step) => vec![step],
        OneOrMany::Many(steps) => steps,
    })
}

impl Skill {
    pub fn installed_name(&self) -> &SkillName {
        self.rename.as_ref().unwrap_or(&self.name)
    }

    pub fn target(&self) -> PathBuf {
        Path::new(&self.dest).join(self.installed_name().as_str())
    }

    pub fn is_standalone(&self) -> bool {
        crate::paths::normalize(Path::new(&self.dest)) == Path::new(SKILLS_DIR)
    }
}

pub fn resolve<'a>(groups: &'a BTreeMap<GroupName, Group>, roots: impl IntoIterator<Item = &'a GroupName>) -> BTreeSet<SkillName> {
    let mut seen = BTreeSet::new();
    let mut pending: Vec<&GroupName> = roots.into_iter().collect();
    let mut skills = BTreeSet::new();
    while let Some(name) = pending.pop() {
        if !seen.insert(name) {
            continue;
        }
        if let Some(group) = groups.get(name) {
            skills.extend(group.skills.iter().cloned());
            pending.extend(&group.includes);
        }
    }
    skills
}

impl StackFile {
    pub fn global_skills(&self) -> BTreeSet<SkillName> {
        resolve(&self.groups, self.groups.iter().filter(|(_, group)| group.global).map(|(name, _)| name))
    }

    pub fn vendored(&self, name: &str) -> Option<&Skill> {
        self.skills.iter().find(|skill| skill.is_standalone() && skill.installed_name().as_str() == name)
    }

    pub fn validate(&self) -> Result<()> {
        let (mut targets, mut names) = (BTreeMap::new(), BTreeMap::new());
        for skill in &self.skills {
            let what = format!("[[skill]] {:?}", skill.name);
            if skill.path != "." {
                inside(&skill.path).with_context(|| format!("{what}: path"))?;
            }
            inside(&skill.dest).with_context(|| format!("{what}: dest"))?;
            let is = |part: Component, name: &str| part.as_os_str().to_string_lossy().eq_ignore_ascii_case(name);
            ensure!(!Path::new(&skill.dest).components().any(|part| is(part, ".git")), "{what}: dest {:?} must not be inside a .git directory", skill.dest);
            let under_skills = Path::new(&skill.dest).components().next().is_some_and(|part| is(part, SKILLS_DIR));
            ensure!(!under_skills || skill.is_standalone(), "{what}: dest {:?} is inside {SKILLS_DIR}/, where every directory is a standalone skill; use {SKILLS_DIR:?} itself or a directory outside it", skill.dest);
            crate::exec::check_ref(&skill.git_ref).with_context(|| format!("{what}: ref"))?;
            ensure!(!skill.source.trim().is_empty() && !skill.source.starts_with('-'), "{what}: invalid source {:?}", skill.source);
            ensure!(crate::exec::is_commit(&skill.commit), "{what}: commit {:?} is not a 40-hex commit", skill.commit);
            for step in &skill.process {
                match step.kind {
                    StepKind::Script => inside(&step.input).with_context(|| format!("{what}: process script, relative to the stack root"))?,
                    StepKind::Prompt => ensure!(!step.input.starts_with('-'), "{what}: a process prompt must not start with `-`, or the runner reads it as an option"),
                }
            }
            let key = crate::paths::normalize(&skill.target());
            if let Some(other) = targets.insert(key.to_string_lossy().to_lowercase(), key.clone()) {
                bail!("{what}: another entry also installs {}{}", other.display(), case_note(&other, &key));
            }
            for name in BTreeSet::from([skill.name.as_str(), skill.installed_name().as_str()]) {
                if let Some(other) = names.insert(name.to_lowercase(), name) {
                    bail!("{what}: another entry already uses the name {other:?}{}", case_note(Path::new(other), Path::new(name)));
                }
            }
        }

        let mut members: BTreeMap<String, (&GroupName, &SkillName)> = BTreeMap::new();
        for (name, group) in &self.groups {
            let mut listed = BTreeSet::new();
            for skill in &group.skills {
                ensure!(listed.insert(skill), "[groups.{name}] skills: {skill:?} is listed twice");
                if let Some((other_group, other)) = members.insert(skill.as_str().to_lowercase(), (name, skill)) {
                    ensure!(other == skill, "[groups.{name}] skills: {skill:?} and {other:?} (in [groups.{other_group}]) differ only by case, so a case-insensitive disk holds one directory for both; rename one");
                }
            }
            for include in &group.includes {
                ensure!(self.groups.contains_key(include), "[groups.{name}] includes: there is no group {include:?}");
            }
        }
        if let Some(cycle) = self.include_cycle() {
            bail!("[groups.{}] includes: groups include each other in a cycle: {}", cycle[0], cycle.iter().map(|name| name.as_str()).collect::<Vec<_>>().join(" -> "));
        }
        let members = resolve(&self.groups, self.groups.keys());
        for skill in self.skills.iter().filter(|skill| skill.is_standalone()) {
            ensure!(members.contains(skill.installed_name().as_str()), "[[skill]] {:?}: installs skills/{} but no [groups.<name>] skills list names {:?}", skill.name, skill.installed_name(), skill.installed_name());
        }
        Ok(())
    }

    fn include_cycle(&self) -> Option<Vec<&GroupName>> {
        fn visit<'a>(name: &'a GroupName, groups: &'a BTreeMap<GroupName, Group>, path: &mut Vec<&'a GroupName>, done: &mut BTreeSet<&'a GroupName>) -> Option<Vec<&'a GroupName>> {
            if let Some(start) = path.iter().position(|step| *step == name) {
                let mut cycle = path[start..].to_vec();
                cycle.push(name);
                return Some(cycle);
            }
            if !done.insert(name) {
                return None;
            }
            path.push(name);
            for include in groups.get(name).map(|group| group.includes.as_slice()).unwrap_or_default() {
                if let Some(cycle) = visit(include, groups, path, done) {
                    return Some(cycle);
                }
            }
            path.pop();
            None
        }
        let mut done = BTreeSet::new();
        self.groups.keys().find_map(|name| visit(name, &self.groups, &mut Vec::new(), &mut done))
    }

    pub fn check_dests(&self, stack: &Path) -> Result<()> {
        let root = crate::paths::resolve(stack);
        let (git, skills) = (crate::paths::resolve(&stack.join(".git")), crate::paths::resolve(&stack.join(SKILLS_DIR)));
        for skill in &self.skills {
            let dest = crate::paths::resolve(&stack.join(&skill.dest));
            let what = format!("[[skill]] {:?}: dest {:?} resolves to {}", skill.name, skill.dest, dest.display());
            ensure!(dest.starts_with(&root), "{what}, outside the stack");
            ensure!(!dest.starts_with(&git), "{what}, inside the stack's .git directory");
            ensure!(skill.dest == SKILLS_DIR || !dest.starts_with(&skills), "{what}, inside {SKILLS_DIR}/, where every directory is a standalone skill; use {SKILLS_DIR:?} itself or a directory outside it");
        }
        Ok(())
    }

    pub fn check_skills_dir(&self, stack: &Path) -> Result<()> {
        let dir = stack.join(SKILLS_DIR);
        for (name, group) in &self.groups {
            for skill in &group.skills {
                let path = dir.join(skill.as_str());
                if !path.exists() && self.vendored(skill.as_str()).is_some() {
                    continue;
                }
                ensure!(path.join("SKILL.md").is_file(), "[groups.{name}] skills: {skill:?} has no {}/{skill}/SKILL.md", SKILLS_DIR);
            }
        }
        let members = resolve(&self.groups, self.groups.keys());
        for entry in skill_dirs(stack)? {
            ensure!(members.contains(entry.as_str()), "{}/{entry} is in no group; add {entry:?} to a [groups.<name>] skills list", SKILLS_DIR);
        }
        Ok(())
    }
}

pub fn skill_dirs(stack: &Path) -> Result<Vec<String>> {
    let dir = stack.join(SKILLS_DIR);
    let read = match std::fs::read_dir(&dir) {
        Ok(read) => read,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(err) => return Err(err).with_context(|| format!("reading {}", dir.display())),
    };
    let mut names = Vec::new();
    for entry in read {
        let entry = entry?;
        let name = entry.file_name().to_string_lossy().into_owned();
        if !name.starts_with('.') && entry.path().is_dir() {
            names.push(name);
        }
    }
    names.sort();
    Ok(names)
}

fn case_note(a: &Path, b: &Path) -> &'static str {
    if a == b { "" } else { ", which differs only by case" }
}

fn inside(path: &str) -> Result<()> {
    let parts: Vec<_> = Path::new(path).components().collect();
    ensure!(!parts.is_empty(), "is empty");
    ensure!(parts.iter().all(|part| matches!(part, Component::Normal(_))), "{path:?} must be relative, without `.` or `..`");
    Ok(())
}

fn plain_name(name: &str) -> Result<()> {
    let plain = !name.is_empty() && !name.starts_with('.') && name.chars().all(|c| c.is_ascii_alphanumeric() || "._-".contains(c));
    ensure!(plain, "{name:?} must be letters, digits, `.`, `_` or `-`, not starting with `.`");
    Ok(())
}

pub fn from_str(text: &str) -> Result<StackFile> {
    let file: StackFile = toml::from_str(text)?;
    file.validate()?;
    Ok(file)
}

pub fn load(stack: &Path) -> Result<StackFile> {
    let path = stack.join(FILE);
    let file = match std::fs::read_to_string(&path) {
        Ok(text) => from_str(&text).with_context(|| format!("invalid {}", path.display()))?,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => StackFile::default(),
        Err(err) => return Err(anyhow!("cannot read {}: {err}", path.display())),
    };
    file.check_skills_dir(stack).and_then(|()| file.check_dests(stack)).with_context(|| format!("invalid {}", path.display()))?;
    Ok(file)
}

#[derive(Debug, Clone, Copy)]
pub enum Op<'a> {
    AddMember { group: &'a GroupName, skill: &'a SkillName },
    PushSkill(&'a Skill),
    SetSkill { name: &'a SkillName, git_ref: &'a str, commit: &'a str },
}

pub fn edit(stack: &Path, ops: &[Op]) -> Result<()> {
    let path = crate::paths::write_through(&stack.join(FILE)).with_context(|| format!("cannot inspect {}", stack.join(FILE).display()))?;
    let before = match std::fs::read_to_string(&path) {
        Ok(text) => text,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => "# Skill groups and vendored skills. See cli/README.md.\n".to_string(),
        Err(err) => return Err(anyhow!("cannot read {}: {err}", path.display())),
    };
    let mut doc: toml_edit::DocumentMut = before.parse().with_context(|| format!("invalid {}", path.display()))?;
    for op in ops {
        edit::apply(&mut doc, op).with_context(|| format!("cannot edit {}", path.display()))?;
    }
    let text = doc.to_string();
    let file = from_str(&text).with_context(|| format!("editing {} would make it invalid; nothing was written", path.display()))?;
    for op in ops {
        ensure!(edit::done(&file, op), "editing {} did not record {op:?}; nothing was written", path.display());
    }
    let permissions = std::fs::metadata(&path).ok().map(|meta| meta.permissions());
    crate::plan::write_atomic(&path, &text, permissions)
}

mod edit {
    use anyhow::{Result, anyhow, bail};
    use toml_edit::{Array, ArrayOfTables, DocumentMut, InlineTable, Item, Table, TableLike, Value};

    use super::{DEFAULT_DEST, DEFAULT_REF, Op, Skill, StackFile, Step, StepKind};

    pub fn apply(doc: &mut DocumentMut, op: &Op) -> Result<()> {
        match *op {
            Op::AddMember { group, skill } => {
                let groups = doc.get_mut("groups").and_then(Item::as_table_like_mut).ok_or_else(|| anyhow!("there is no [groups] table"))?;
                let table = groups.get_mut(group.as_str()).and_then(Item::as_table_like_mut).ok_or_else(|| anyhow!("there is no [groups.{group}] table"))?;
                match table.get_mut("skills") {
                    None => set(table, "skills", Value::Array(Array::from_iter([skill.as_str()]))),
                    Some(item) => {
                        let array = item.as_array_mut().ok_or_else(|| anyhow!("[groups.{group}] skills is not an array"))?;
                        if !array.iter().any(|item| item.as_str() == Some(skill.as_str())) {
                            append(array, Value::from(skill.as_str()));
                        }
                    }
                }
            }
            Op::PushSkill(skill) => match doc.get_mut("skill") {
                None => {
                    let mut table = Table::new();
                    fields(&mut table, skill);
                    doc.insert("skill", Item::ArrayOfTables(ArrayOfTables::from_iter([table])));
                }
                Some(Item::ArrayOfTables(tables)) => {
                    let mut table = Table::new();
                    fields(&mut table, skill);
                    tables.push(table);
                }
                Some(Item::Value(Value::Array(array))) if array.iter().all(Value::is_inline_table) => {
                    let mut table = InlineTable::new();
                    fields(&mut table, skill);
                    append(array, Value::InlineTable(table));
                }
                Some(_) => bail!("skill is neither [[skill]] tables nor an array of inline tables"),
            },
            Op::SetSkill { name, git_ref, commit } => {
                let table = entry(doc, name.as_str())?;
                let current = table.get("ref").and_then(Item::as_str).unwrap_or(DEFAULT_REF);
                if current != git_ref {
                    set(table, "ref", Value::from(git_ref));
                }
                set(table, "commit", Value::from(commit));
            }
        }
        Ok(())
    }

    pub fn done(file: &StackFile, op: &Op) -> bool {
        match *op {
            Op::AddMember { group, skill } => file.groups.get(group).is_some_and(|group| group.skills.contains(skill)),
            Op::PushSkill(skill) => file.skills.contains(skill),
            Op::SetSkill { name, git_ref, commit } => file.skills.iter().any(|skill| skill.name == *name && skill.git_ref == git_ref && skill.commit == commit),
        }
    }

    fn entry<'d>(doc: &'d mut DocumentMut, name: &str) -> Result<&'d mut dyn TableLike> {
        let named = |table: &dyn TableLike| table.get("name").and_then(Item::as_str) == Some(name);
        match doc.get_mut("skill") {
            Some(Item::ArrayOfTables(tables)) => tables.iter_mut().find(|table| named(*table)).map(|table| table as &mut dyn TableLike),
            Some(Item::Value(Value::Array(array))) => array.iter_mut().filter_map(Value::as_inline_table_mut).find(|table| named(*table)).map(|table| table as &mut dyn TableLike),
            _ => None,
        }
        .ok_or_else(|| anyhow!("there is no [[skill]] named {name:?}"))
    }

    fn fields(table: &mut dyn TableLike, skill: &Skill) {
        set(table, "name", Value::from(skill.name.as_str()));
        set(table, "source", Value::from(skill.source.as_str()));
        set(table, "path", Value::from(skill.path.as_str()));
        if skill.git_ref != DEFAULT_REF {
            set(table, "ref", Value::from(skill.git_ref.as_str()));
        }
        set(table, "commit", Value::from(skill.commit.as_str()));
        if skill.dest != DEFAULT_DEST {
            set(table, "dest", Value::from(skill.dest.as_str()));
        }
        if let Some(rename) = &skill.rename {
            set(table, "move", Value::from(rename.as_str()));
        }
        if !skill.process.is_empty() {
            set(table, "process", Value::Array(skill.process.iter().map(step).collect()));
        }
    }

    fn step(step: &Step) -> Value {
        let mut table = InlineTable::new();
        table.insert("type", Value::from(match step.kind {
            StepKind::Script => "script",
            StepKind::Prompt => "prompt",
        }));
        table.insert("input", Value::from(step.input.as_str()));
        Value::InlineTable(table)
    }

    fn set(table: &mut dyn TableLike, key: &str, mut value: Value) {
        match table.get_mut(key).and_then(Item::as_value_mut) {
            Some(current) => {
                *value.decor_mut() = current.decor().clone();
                *current = value;
            }
            None => {
                table.insert(key, Item::Value(value));
            }
        }
    }

    fn append(array: &mut Array, mut value: Value) {
        let Some(last) = array.iter_mut().last() else {
            array.push_formatted(value);
            return;
        };
        let prefix = last.decor().prefix().and_then(|raw| raw.as_str()).unwrap_or(" ").to_string();
        let suffix = last.decor().suffix().and_then(|raw| raw.as_str()).unwrap_or("").to_string();
        let between = format!("{suffix}{}", array.trailing().as_str().unwrap_or(""));
        match between.rfind('\n') {
            Some(close) => {
                let indent = match prefix.rfind('\n') {
                    Some(at) => prefix[at..].to_string(),
                    None => format!("\n{}", prefix.trim()),
                };
                let last = array.iter_mut().last().expect("checked above");
                last.decor_mut().set_suffix("");
                value.decor_mut().set_prefix(format!("{}{indent}", &between[..close]));
                array.set_trailing(between[close..].to_string());
                array.set_trailing_comma(true);
            }
            None if array.len() == 1 => value.decor_mut().set_prefix(" "),
            None => value.decor_mut().set_prefix(prefix),
        }
        array.push_formatted(value);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const COMMIT: &str = "0123456789abcdef0123456789abcdef01234567";

    fn entry(extra: &str) -> String {
        format!("[[skill]]\nname = \"grill\"\nsource = \"https://example.com/skills\"\npath = \"skills/grill\"\ncommit = \"{COMMIT}\"\ndest = \"vendor\"\n{extra}")
    }

    fn name(text: &str) -> Name {
        Name::try_from(text).unwrap()
    }

    #[test]
    fn accepts_one_or_many_process_steps_and_round_trips() {
        let one = from_str(&entry("process = { type = \"script\", input = \"s.sh\" }\n")).unwrap();
        assert_eq!(one.skills[0].process, vec![Step { kind: StepKind::Script, input: "s.sh".into() }]);
        assert_eq!(one.skills[0].git_ref, "HEAD");
        let many = from_str(&entry("process = [{ type = \"script\", input = \"s.sh\" }, { type = \"prompt\", input = \"Be terse.\" }]\n")).unwrap();
        assert_eq!(many.skills[0].process[1].kind, StepKind::Prompt);
        assert_eq!(from_str(&toml::to_string(&many).unwrap()).unwrap(), many);
    }

    #[test]
    fn rejects_invalid_entries() {
        let other = entry("").replace("name = \"grill\"", "name = \"other\"").replace("skills/grill", "skills/other");
        for (text, message) in [
            (entry("").replace("dest = \"vendor\"", "dest = \"../elsewhere\""), "dest"),
            (entry("").replace("dest = \"vendor\"", "dest = \"/abs\""), "dest"),
            (entry("").replace("dest = \"vendor\"", "dest = \"plugins/.git/hooks\""), ".git"),
            (entry("move = \"a/b\"\n"), "move"),
            (entry("move = \".hidden\"\n"), "move"),
            (entry("move = \"a b\"\n"), "move"),
            (entry("ref = \"--upload-pack=x\"\n"), "ref"),
            (entry("").replace("skills/grill", "skills/../../x"), "path"),
            (entry("process = { type = \"script\", input = \"/abs/s.sh\" }\n"), "process script"),
            (entry("process = { type = \"script\", input = \"../s.sh\" }\n"), "process script"),
            (entry("process = { type = \"prompt\", input = \"--help\" }\n"), "must not start with `-`"),
            (format!("{}\n{}", entry(""), entry("").replace("name = \"grill\"", "name = \"other\"\nmove = \"grill\"")), "also installs"),
            (format!("{}\n{}", entry(""), other.replace("dest = \"vendor\"", "dest = \"elsewhere\"\nmove = \"grill\"")), "already uses the name \"grill\""),
            (format!("{}\n{}", entry(""), entry("").replace("dest = \"vendor\"", "dest = \"elsewhere\"")), "already uses the name \"grill\""),
            (entry("").replace("dest = \"vendor\"\n", ""), "no [groups.<name>] skills list names \"grill\""),
        ] {
            let err = format!("{:#}", from_str(&text).unwrap_err());
            assert!(err.contains(message), "{message}: {err}");
        }
        assert!(from_str(&entry("").replace("skills/grill", ".")).is_ok());
        assert!(from_str(&format!("{}\n{other}", entry(""))).is_ok());
        let grouped = from_str(&format!("[groups.tools]\nskills = [\"grill\"]\n\n{}", entry("").replace("dest = \"vendor\"\n", ""))).unwrap();
        assert_eq!(grouped.skills[0].dest, DEFAULT_DEST);
        assert!(grouped.vendored("grill").is_some());
    }

    #[test]
    fn names_that_differ_only_by_case_and_dests_inside_skills_are_refused() {
        let grouped = |extra: &str| format!("[groups.tools]\nskills = [\"grill\"]\n\n{}", entry(extra).replace("dest = \"vendor\"\n", ""));
        for (text, message) in [
            ("[groups.a]\nskills = [\"handoff\"]\n[groups.b]\nskills = [\"HANDOFF\"]\n".to_string(), "[groups.b] skills: \"HANDOFF\" and \"handoff\" (in [groups.a]) differ only by case"),
            ("[groups.a]\nskills = [\"handoff\", \"Handoff\"]\n".to_string(), "\"Handoff\" and \"handoff\" (in [groups.a]) differ only by case"),
            (format!("{}\n{}", entry(""), entry("").replace("name = \"grill\"", "name = \"GRILL\"").replace("dest = \"vendor\"", "dest = \"other\"")), "already uses the name \"grill\", which differs only by case"),
            (format!("{}\n{}", entry(""), entry("").replace("name = \"grill\"", "name = \"x\"\nmove = \"GRILL\"").replace("skills/grill", "skills/x")), "also installs vendor/grill, which differs only by case"),
            (entry("").replace("dest = \"vendor\"", "dest = \"skills/nested\""), "dest \"skills/nested\" is inside skills/"),
            (entry("").replace("dest = \"vendor\"", "dest = \"Skills/vendor\""), "dest \"Skills/vendor\" is inside skills/"),
            (entry("").replace("dest = \"vendor\"", "dest = \"SKILLS\""), "dest \"SKILLS\" is inside skills/"),
            (entry("").replace("dest = \"vendor\"", "dest = \".GIT/refs\""), "must not be inside a .git directory"),
        ] {
            let err = format!("{:#}", from_str(&text).unwrap_err());
            assert!(err.contains(message), "{message}: {err}");
        }
        assert!(from_str(&grouped("")).is_ok());
        assert!(from_str(&entry("").replace("dest = \"vendor\"", "dest = \"plugins/pstack/skills\"")).is_ok());
    }

    #[test]
    fn the_repos_own_stack_toml_matches_its_skills_dir() {
        let repo = Path::new(env!("CARGO_MANIFEST_DIR")).parent().unwrap();
        let file = load(repo).unwrap();
        assert!(!file.global_skills().is_empty());
    }

    fn skill(name_text: &str) -> Skill {
        Skill { name: name(name_text), source: "https://example.com/skills".into(), path: format!("skills/{name_text}"), git_ref: DEFAULT_REF.into(), commit: COMMIT.into(), dest: DEFAULT_DEST.into(), rename: None, process: Vec::new() }
    }

    #[test]
    fn edit_applies_each_op_to_the_current_file_and_keeps_comments_and_layout() {
        let dir = tempfile::tempdir().unwrap();
        let text = concat!(
            "# The owner's groups.\n\n",
            "[groups.tools]\n",
            "global = true   # every machine\n",
            "skills = [\n",
            "    \"handoff\",  # mine\n",
            "    \"feedback\",  # theirs\n",
            "]\n\n",
            "# Pinned upstream skills.\n",
            "[[skill]]\n",
            "name = \"old\"\n",
            "source = \"https://example.com/old\"\n",
            "path = \"old\"\n",
            "commit = \"0123456789abcdef0123456789abcdef01234567\"   # reviewed\n",
            "dest = \"vendor\"\n",
        );
        std::fs::write(dir.path().join(FILE), text).unwrap();
        let grill = skill("grill");
        let new = "89abcdef0123456789abcdef0123456789abcdef";
        edit(dir.path(), &[
            Op::AddMember { group: &name("tools"), skill: &name("grill") },
            Op::PushSkill(&grill),
            Op::SetSkill { name: &name("old"), git_ref: DEFAULT_REF, commit: new },
        ]).unwrap();
        let saved = std::fs::read_to_string(dir.path().join(FILE)).unwrap();
        assert_eq!(saved, concat!(
            "# The owner's groups.\n\n",
            "[groups.tools]\n",
            "global = true   # every machine\n",
            "skills = [\n",
            "    \"handoff\",  # mine\n",
            "    \"feedback\",  # theirs\n",
            "    \"grill\",\n",
            "]\n\n",
            "# Pinned upstream skills.\n",
            "[[skill]]\n",
            "name = \"old\"\n",
            "source = \"https://example.com/old\"\n",
            "path = \"old\"\n",
            "commit = \"89abcdef0123456789abcdef0123456789abcdef\"   # reviewed\n",
            "dest = \"vendor\"\n",
            "\n[[skill]]\n",
            "name = \"grill\"\n",
            "source = \"https://example.com/skills\"\n",
            "path = \"skills/grill\"\n",
            "commit = \"0123456789abcdef0123456789abcdef01234567\"\n",
        ));
    }

    #[test]
    fn edit_supports_every_shape_load_accepts_and_refuses_the_rest() {
        let dir = tempfile::tempdir().unwrap();
        let run = |text: &str, ops: &[Op]| {
            std::fs::write(dir.path().join(FILE), text).unwrap();
            edit(dir.path(), ops).map(|()| std::fs::read_to_string(dir.path().join(FILE)).unwrap())
        };
        let (tools, grill, other) = (name("tools"), name("grill"), skill("other"));
        let add = [Op::AddMember { group: &tools, skill: &grill }];
        assert_eq!(run("groups = { tools = { skills = [\"a\"] } }\n", &add).unwrap(), "groups = { tools = { skills = [\"a\", \"grill\"] } }\n");
        assert_eq!(run("groups.tools.skills = [\"a\"]\n", &add).unwrap(), "groups.tools.skills = [\"a\", \"grill\"]\n");
        assert_eq!(
            run("[groups.tools]\nskills = [\n    \"a\",\n    \"b\"  # last one\n]\n", &add).unwrap(),
            "[groups.tools]\nskills = [\n    \"a\",\n    \"b\",  # last one\n    \"grill\",\n]\n"
        );
        let inline = format!("skill = [\n  {{ name = \"other\", source = \"https://example.com/skills\", path = \"skills/other\", commit = \"{COMMIT}\", dest = \"vendor\" }},\n]\n");
        let mut vendored = other.clone();
        vendored.dest = "vendor".into();
        let mut pushed = skill("pushed");
        pushed.dest = "vendor".into();
        let new = "89abcdef0123456789abcdef0123456789abcdef";
        let text = run(&inline, &[Op::PushSkill(&pushed), Op::SetSkill { name: &other.name, git_ref: "main", commit: new }]).unwrap();
        let file = from_str(&text).unwrap();
        assert_eq!(file.skills.len(), 2, "{text}");
        assert_eq!((file.skills[0].git_ref.as_str(), file.skills[0].commit.as_str()), ("main", new));
        assert_eq!(file.skills[1], pushed);
        assert!(text.starts_with("skill = [\n  { name = \"other\""), "{text}");
        for (text, ops, message) in [
            ("[groups]\n", &add[..], "there is no [groups.tools] table"),
            ("[groups.tools]\nskills = \"grill\"\n", &add[..], "skills is not an array"),
            ("skill = 3\n", &[Op::PushSkill(&vendored)][..], "neither [[skill]] tables"),
            ("", &[Op::SetSkill { name: &other.name, git_ref: "main", commit: new }][..], "there is no [[skill]] named \"other\""),
        ] {
            let err = format!("{:#}", run(text, ops).unwrap_err());
            assert!(err.contains(message), "{message}: {err}");
            assert_eq!(std::fs::read_to_string(dir.path().join(FILE)).unwrap(), text);
        }
        let err = format!("{:#}", run("[groups.tools]\nskills = [\"Grill\"]\n", &add).unwrap_err());
        assert!(err.contains("would make it invalid"), "{err}");
    }

    #[test]
    fn edit_writes_through_a_symlink_and_keeps_the_mode() {
        use std::os::unix::fs::PermissionsExt as _;
        let dir = tempfile::tempdir().unwrap();
        let (stack, real) = (dir.path().join("stack"), dir.path().join("dotfiles/stack.toml"));
        std::fs::create_dir_all(&stack).unwrap();
        std::fs::create_dir_all(real.parent().unwrap()).unwrap();
        std::fs::write(&real, "[groups.tools]\nskills = []\n").unwrap();
        std::fs::set_permissions(&real, std::fs::Permissions::from_mode(0o600)).unwrap();
        std::os::unix::fs::symlink(&real, stack.join(FILE)).unwrap();
        edit(&stack, &[Op::AddMember { group: &name("tools"), skill: &name("grill") }]).unwrap();
        assert!(std::fs::symlink_metadata(stack.join(FILE)).unwrap().file_type().is_symlink());
        assert_eq!(std::fs::read_to_string(&real).unwrap(), "[groups.tools]\nskills = [\"grill\"]\n");
        assert_eq!(std::fs::metadata(&real).unwrap().permissions().mode() & 0o777, 0o600);
    }

    #[test]
    fn groups_resolve_through_includes_and_refuse_unknown_names_and_cycles() {
        let file = from_str(concat!(
            "[groups.threejs]\nskills = [\"threejs\", \"tools-r3f\"]\n\n",
            "[groups.games]\nglobal = true\nincludes = [\"threejs\"]\nskills = [\"game-mvp\", \"threejs\"]\n\n",
            "[groups.art]\nskills = [\"art-iteration\"]\n",
        )).unwrap();
        let names = |set: BTreeSet<SkillName>| set.into_iter().map(String::from).collect::<Vec<_>>();
        assert_eq!(names(resolve(&file.groups, [&name("games")])), ["game-mvp", "threejs", "tools-r3f"]);
        assert_eq!(names(resolve(&file.groups, [&name("threejs")])), ["threejs", "tools-r3f"]);
        assert_eq!(names(file.global_skills()), ["game-mvp", "threejs", "tools-r3f"]);
        let text = toml::to_string(&file).unwrap();
        assert!(text.contains("[groups.games]\nglobal = true\nincludes = [\"threejs\"]"), "{text}");
        assert_eq!(from_str(&text).unwrap(), file);

        for (text, message) in [
            ("[groups.a]\nincludes = [\"b\"]\n", "[groups.a] includes: there is no group \"b\""),
            ("[groups.a]\nincludes = [\"b\"]\n[groups.b]\nincludes = [\"c\"]\n[groups.c]\nincludes = [\"a\"]\n", "cycle: a -> b -> c -> a"),
            ("[groups.a]\nincludes = [\"a\"]\n", "cycle: a -> a"),
            ("[groups.a]\nskills = [\"x\", \"x\"]\n", "\"x\" is listed twice"),
            ("[groups.a]\nskills = [\"../x\"]\n", "must be letters"),
            ("[groups.\".a\"]\nskills = []\n", "must be letters"),
            ("[groups.a]\nskill = []\n", "unknown field"),
        ] {
            let err = format!("{:#}", from_str(text).unwrap_err());
            assert!(err.contains(message), "{message}: {err}");
        }
    }

    #[test]
    fn every_member_needs_a_skill_dir_and_every_skill_dir_a_group() {
        let dir = tempfile::tempdir().unwrap();
        let stack = dir.path();
        for skill in ["handoff", "feedback"] {
            std::fs::create_dir_all(stack.join("skills").join(skill)).unwrap();
            std::fs::write(stack.join("skills").join(skill).join("SKILL.md"), "---\nname: x\n---\n").unwrap();
        }
        std::fs::create_dir_all(stack.join("skills/.cache")).unwrap();
        std::fs::write(stack.join("skills/README.md"), "index\n").unwrap();
        let write = |text: &str| std::fs::write(stack.join(FILE), text).unwrap();
        let err = |text: &str| { write(text); format!("{:#}", load(stack).unwrap_err()) };

        let message = err("[groups.tools]\nskills = [\"handoff\"]\n");
        assert!(message.contains("stack.toml") && message.contains("skills/feedback is in no group"), "{message}");
        let message = err("[groups.tools]\nskills = [\"handoff\", \"feedback\", \"gone\"]\n");
        assert!(message.contains("[groups.tools] skills: \"gone\" has no skills/gone/SKILL.md"), "{message}");
        write("[groups.tools]\nskills = [\"handoff\"]\n[groups.more]\nskills = [\"feedback\"]\n");
        assert_eq!(load(stack).unwrap().groups.len(), 2);
        write(&format!("[groups.tools]\nskills = [\"handoff\", \"feedback\", \"grill\"]\n\n{}", entry("").replace("dest = \"vendor\"\n", "")));
        assert!(load(stack).is_ok());
    }

    #[test]
    fn a_dest_that_resolves_into_git_skills_or_outside_the_stack_is_refused() {
        let dir = tempfile::tempdir().unwrap();
        let stack = dir.path().join("stack");
        std::fs::create_dir_all(stack.join(".git/refs")).unwrap();
        std::fs::create_dir_all(stack.join("skills")).unwrap();
        std::fs::create_dir_all(dir.path().join("outside")).unwrap();
        std::os::unix::fs::symlink(".git", stack.join("hooks-dir")).unwrap();
        std::os::unix::fs::symlink("skills", stack.join("aliased")).unwrap();
        std::os::unix::fs::symlink("../outside", stack.join("away")).unwrap();
        for (dest, message) in [("hooks-dir/refs", "inside the stack's .git directory"), ("aliased/vendor", "inside skills/"), ("aliased", "inside skills/"), ("away/x", "outside the stack")] {
            let file = from_str(&entry("").replace("dest = \"vendor\"", &format!("dest = {dest:?}"))).unwrap();
            let err = format!("{:#}", file.check_dests(&stack).unwrap_err());
            assert!(err.contains(message), "{dest}: {err}");
        }
        assert!(from_str(&entry("")).unwrap().check_dests(&stack).is_ok());
    }
}
