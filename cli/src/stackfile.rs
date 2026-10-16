//! `<stack>/stack.toml`: the groups of standalone skills, and every skill the stack vendors
//! from an external git repo.

use std::collections::{BTreeMap, BTreeSet};
use std::fmt;
use std::path::{Component, Path, PathBuf};

use anyhow::{Context as _, Result, anyhow, bail, ensure};
use serde::{Deserialize, Deserializer, Serialize};

pub const FILE: &str = "stack.toml";
/// The stack's standalone skills live flat in `<stack>/skills/<name>/`.
pub const SKILLS_DIR: &str = "skills";
pub const DEFAULT_DEST: &str = SKILLS_DIR;
pub const DEFAULT_REF: &str = "HEAD";

/// A group or skill name: letters, digits, `.`, `_` or `-`, not starting with `.`. Checked
/// when parsed, so a `Name` is always safe as one path component.
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

/// Skills turned on or off together. A global group is on for every harness.
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

/// A vendored skill: copied from `source` at `commit` into `<dest>/<installed name>`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Skill {
    pub name: SkillName,
    pub source: String,
    pub path: String,
    #[serde(rename = "ref", default = "default_ref")]
    pub git_ref: String,
    pub commit: String,
    /// Parent directory in the stack. The default, `skills`, makes a standalone skill that a
    /// group lists. Any other value vendors a skill somewhere a plugin reads it, by hand only.
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

    /// `<dest>/<installed name>`, relative to the stack root.
    pub fn target(&self) -> PathBuf {
        Path::new(&self.dest).join(self.installed_name().as_str())
    }

    /// Installed into `skills/`, so it is a standalone skill and must belong to a group.
    pub fn is_standalone(&self) -> bool {
        crate::paths::normalize(Path::new(&self.dest)) == Path::new(SKILLS_DIR)
    }
}

/// Every skill reachable from `roots` through `includes`, each once. Pure: unknown groups and
/// cycles are skipped here because `StackFile::validate` refuses them at load.
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
    /// The skills every harness gets: the union of the global groups.
    pub fn global_skills(&self) -> BTreeSet<SkillName> {
        resolve(&self.groups, self.groups.iter().filter(|(_, group)| group.global).map(|(name, _)| name))
    }

    /// The vendored entry that installs `name` into `skills/`, if any.
    pub fn vendored(&self, name: &str) -> Option<&Skill> {
        self.skills.iter().find(|skill| skill.is_standalone() && skill.installed_name().as_str() == name)
    }

    /// Checks the file on its own: vendored entries, group includes and membership.
    pub fn validate(&self) -> Result<()> {
        // Keyed by lowercase, because a case-insensitive disk holds one directory for both.
        let (mut targets, mut names) = (BTreeMap::new(), BTreeMap::new());
        for skill in &self.skills {
            let what = format!("[[skill]] {:?}", skill.name);
            if skill.path != "." {
                inside(&skill.path).with_context(|| format!("{what}: path"))?;
            }
            inside(&skill.dest).with_context(|| format!("{what}: dest"))?;
            ensure!(!Path::new(&skill.dest).components().any(|part| part.as_os_str() == ".git"), "{what}: dest {:?} must not be inside a .git directory", skill.dest);
            let under_skills = Path::new(&skill.dest).components().next().is_some_and(|part| part.as_os_str() == SKILLS_DIR);
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

    /// The first include cycle, as the path that closes it, e.g. `[a, b, a]`.
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

    /// Checks the file against the stack's `skills/` directory: every group member is a
    /// directory there with a `SKILL.md`, and every directory there belongs to a group. A
    /// vendored skill may be missing, because `skills status` reports that and `skills update`
    /// rebuilds it.
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

/// The names of the directories in `<stack>/skills/`, sorted, without dot entries.
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

/// `, which differs only by case` when `a` and `b` differ.
fn case_note(a: &Path, b: &Path) -> &'static str {
    if a == b { "" } else { ", which differs only by case" }
}

/// A relative path made only of plain components, so joining it to the stack stays inside.
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

/// Parses and validates the file on its own, without looking at the stack's directories.
pub fn from_str(text: &str) -> Result<StackFile> {
    let file: StackFile = toml::from_str(text)?;
    file.validate()?;
    Ok(file)
}

/// Loads and validates `<stack>/stack.toml` against `<stack>/skills/`. An absent file is an
/// empty one, which is valid only while `skills/` holds no skill.
pub fn load(stack: &Path) -> Result<StackFile> {
    let path = stack.join(FILE);
    let file = match std::fs::read_to_string(&path) {
        Ok(text) => from_str(&text).with_context(|| format!("invalid {}", path.display()))?,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => StackFile::default(),
        Err(err) => return Err(anyhow!("cannot read {}: {err}", path.display())),
    };
    file.check_skills_dir(stack).with_context(|| format!("invalid {}", path.display()))?;
    Ok(file)
}

/// Writes `file` into `<stack>/stack.toml`, editing only the tables and values that changed, so
/// comments, key order and array layout elsewhere survive.
pub fn save(stack: &Path, file: &StackFile) -> Result<()> {
    file.validate()?;
    let path = stack.join(FILE);
    let before = match std::fs::read_to_string(&path) {
        Ok(text) => text,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => "# Skill groups and vendored skills. See cli/README.md.\n".to_string(),
        Err(err) => return Err(anyhow!("cannot read {}: {err}", path.display())),
    };
    let old: StackFile = toml::from_str(&before).with_context(|| format!("invalid {}", path.display()))?;
    let mut doc: toml_edit::DocumentMut = before.parse().with_context(|| format!("invalid {}", path.display()))?;
    edit::apply(&mut doc, &old, file);
    let text = doc.to_string();
    use std::io::Write as _;
    use std::os::unix::fs::PermissionsExt as _;
    let mut tmp = tempfile::Builder::new()
        .prefix(".stack.")
        .suffix(".ai-stack-tmp")
        .permissions(std::fs::Permissions::from_mode(0o644))
        .tempfile_in(stack)
        .with_context(|| format!("creating a temp file in {}", stack.display()))?;
    tmp.write_all(text.as_bytes())?;
    tmp.persist(&path).with_context(|| format!("cannot write {}", path.display()))?;
    Ok(())
}

/// Edits a parsed `stack.toml` in place from the old model to the new one, touching only what
/// differs.
mod edit {
    use toml_edit::{Array, ArrayOfTables, DocumentMut, InlineTable, Item, Table, Value};

    use super::{DEFAULT_DEST, DEFAULT_REF, Group, Name, Skill, StackFile, Step, StepKind};

    pub fn apply(doc: &mut DocumentMut, old: &StackFile, new: &StackFile) {
        if old.groups != new.groups {
            groups(doc, old, new);
        }
        if old.skills != new.skills {
            skills(doc, old, new);
        }
    }

    fn groups(doc: &mut DocumentMut, old: &StackFile, new: &StackFile) {
        let groups = doc.entry("groups").or_insert_with(|| {
            let mut table = Table::new();
            table.set_implicit(true);
            Item::Table(table)
        });
        let Some(groups) = groups.as_table_like_mut() else { return };
        let gone: Vec<String> = groups.iter().map(|(name, _)| name.to_string()).filter(|name| !new.groups.keys().any(|kept| kept.as_str() == name)).collect();
        for name in gone {
            groups.remove(&name);
        }
        for (name, group) in &new.groups {
            let before = old.groups.get(name);
            if before == Some(group) {
                continue;
            }
            let item = groups.entry(name.as_str()).or_insert(Item::Table(Table::new()));
            let Some(table) = item.as_table_like_mut() else { continue };
            let empty = Group::default();
            let before = before.unwrap_or(&empty);
            if before.global != group.global {
                set(table, "global", Value::from(group.global));
            }
            if before.includes != group.includes {
                list(table, "includes", &group.includes);
            }
            if before.skills != group.skills || table.get("skills").is_none() {
                list(table, "skills", &group.skills);
            }
        }
    }

    fn skills(doc: &mut DocumentMut, old: &StackFile, new: &StackFile) {
        let item = doc.entry("skill").or_insert(Item::ArrayOfTables(ArrayOfTables::new()));
        let Some(tables) = item.as_array_of_tables_mut() else { return };
        // Tables follow the old entries in order; one whose entry is gone is dropped.
        let mut index = 0;
        tables.retain(|_| {
            let kept = new.skills.iter().any(|skill| skill.name == old.skills[index].name);
            index += 1;
            kept
        });
        let old: Vec<&Skill> = old.skills.iter().filter(|skill| new.skills.iter().any(|kept| kept.name == skill.name)).collect();
        for skill in &new.skills {
            match old.iter().position(|before| before.name == skill.name) {
                Some(at) => fields(tables.get_mut(at).expect("one table per entry"), Some(old[at]), skill),
                None => {
                    let mut table = Table::new();
                    fields(&mut table, None, skill);
                    tables.push(table);
                }
            }
        }
    }

    /// Writes each field of `skill` that differs from `before`. A new entry leaves out `ref` and
    /// `dest` at their defaults.
    fn fields(table: &mut Table, before: Option<&Skill>, skill: &Skill) {
        let changed = |old: Option<&str>, new: &str, default: Option<&str>| match old {
            Some(old) => old != new,
            None => default != Some(new),
        };
        if before.is_none() {
            set(table, "name", Value::from(skill.name.as_str()));
        }
        for (key, old, new, default) in [
            ("source", before.map(|b| b.source.as_str()), skill.source.as_str(), None),
            ("path", before.map(|b| b.path.as_str()), skill.path.as_str(), None),
            ("ref", before.map(|b| b.git_ref.as_str()), skill.git_ref.as_str(), Some(DEFAULT_REF)),
            ("commit", before.map(|b| b.commit.as_str()), skill.commit.as_str(), None),
            ("dest", before.map(|b| b.dest.as_str()), skill.dest.as_str(), Some(DEFAULT_DEST)),
        ] {
            if changed(old, new, default) {
                set(table, key, Value::from(new));
            }
        }
        if before.map(|b| &b.rename) != Some(&skill.rename) {
            match &skill.rename {
                Some(rename) => set(table, "move", Value::from(rename.as_str())),
                None => {
                    table.remove("move");
                }
            }
        }
        if before.map_or(!skill.process.is_empty(), |b| b.process != skill.process) {
            if skill.process.is_empty() {
                table.remove("process");
            } else {
                set(table, "process", Value::Array(skill.process.iter().map(step).collect()));
            }
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

    /// Sets `key`, keeping an existing value's surrounding whitespace and comment.
    fn set(table: &mut dyn toml_edit::TableLike, key: &str, mut value: Value) {
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

    /// Sets the name array at `key`. When the new list only drops names or appends them, the
    /// existing array is edited in place, so its layout and comments stay; otherwise it is
    /// rewritten.
    fn list(table: &mut dyn toml_edit::TableLike, key: &str, names: &[Name]) {
        let Some(array) = table.get_mut(key).and_then(Item::as_array_mut) else {
            set(table, key, Value::Array(names.iter().map(|name| name.as_str()).collect()));
            return;
        };
        let kept: Vec<String> = array.iter().filter_map(Value::as_str).filter(|item| names.iter().any(|name| name.as_str() == *item)).map(str::to_string).collect();
        let prefix: Vec<String> = names.iter().take(kept.len()).map(|name| name.as_str().to_string()).collect();
        if kept != prefix {
            let fresh: Array = names.iter().map(|name| name.as_str()).collect();
            set(table, key, Value::Array(fresh));
            return;
        }
        array.retain(|item| item.as_str().is_some_and(|item| names.iter().any(|name| name.as_str() == item)));
        for name in &names[kept.len()..] {
            append(array, name.as_str());
        }
    }

    /// Appends like the last item: same indentation, and a comment that trailed the last item
    /// stays on its line.
    fn append(array: &mut Array, item: &str) {
        let mut value = Value::from(item);
        if let Some(last) = array.iter().last() {
            let prefix = last.decor().prefix().and_then(|raw| raw.as_str()).unwrap_or(" ").to_string();
            let trailing = array.trailing().as_str().unwrap_or("").to_string();
            match (prefix.rfind('\n'), trailing.rfind('\n')) {
                // Multi-line: the old trailing text up to its last newline ends the last item's line.
                (Some(indent), Some(close)) => {
                    value.decor_mut().set_prefix(format!("{}{}", &trailing[..close], &prefix[indent..]));
                    array.set_trailing(trailing[close..].to_string());
                    array.set_trailing_comma(true);
                }
                _ => value.decor_mut().set_prefix(prefix),
            }
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
            // A vendored skill installed into skills/ is a standalone skill, so it needs a group.
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

    #[test]
    fn save_edits_only_what_changed_and_keeps_comments_and_layout() {
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
        let mut file = from_str(text).unwrap();
        file.groups.get_mut("tools").unwrap().skills.push(name("grill"));
        file.skills[0].commit = "89abcdef0123456789abcdef0123456789abcdef".into();
        file.skills.push(from_str(&format!("[groups.x]\nskills = [\"grill\"]\n{}", entry("").replace("dest = \"vendor\"\n", ""))).unwrap().skills.remove(0));
        save(dir.path(), &file).unwrap();
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
        assert_eq!(from_str(&saved).unwrap(), file);
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
        // A vendored member that is not built yet is allowed; `skills update` rebuilds it.
        write(&format!("[groups.tools]\nskills = [\"handoff\", \"feedback\", \"grill\"]\n\n{}", entry("").replace("dest = \"vendor\"\n", "")));
        assert!(load(stack).is_ok());
    }
}
