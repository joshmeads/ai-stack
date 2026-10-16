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
    pub name: String,
    pub source: String,
    pub path: String,
    #[serde(rename = "ref", default = "default_ref")]
    pub git_ref: String,
    pub commit: String,
    #[serde(default = "default_dest")]
    pub dest: String,
    #[serde(rename = "move", default, skip_serializing_if = "Option::is_none")]
    pub rename: Option<String>,
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
    pub fn installed_name(&self) -> &str {
        self.rename.as_deref().unwrap_or(&self.name)
    }

    /// `<dest>/<installed name>`, relative to the stack root.
    pub fn target(&self) -> PathBuf {
        Path::new(&self.dest).join(self.installed_name())
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
        self.skills.iter().find(|skill| skill.is_standalone() && skill.installed_name() == name)
    }

    /// Checks the file on its own: vendored entries, group includes and membership.
    pub fn validate(&self) -> Result<()> {
        let (mut targets, mut names) = (BTreeSet::new(), BTreeSet::new());
        for skill in &self.skills {
            let what = format!("[[skill]] {:?}", skill.name);
            plain_name(&skill.name).with_context(|| format!("{what}: name"))?;
            if let Some(rename) = &skill.rename {
                plain_name(rename).with_context(|| format!("{what}: move"))?;
            }
            if skill.path != "." {
                inside(&skill.path).with_context(|| format!("{what}: path"))?;
            }
            inside(&skill.dest).with_context(|| format!("{what}: dest"))?;
            ensure!(!Path::new(&skill.dest).components().any(|part| part.as_os_str() == ".git"), "{what}: dest {:?} must not be inside a .git directory", skill.dest);
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
            ensure!(targets.insert(key.clone()), "{what}: another entry also installs {}", key.display());
            for name in BTreeSet::from([skill.name.as_str(), skill.installed_name()]) {
                ensure!(names.insert(name), "{what}: another entry already uses the name {name:?}");
            }
        }

        for (name, group) in &self.groups {
            let mut listed = BTreeSet::new();
            for skill in &group.skills {
                ensure!(listed.insert(skill), "[groups.{name}] skills: {skill:?} is listed twice");
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
            ensure!(members.contains(skill.installed_name()), "[[skill]] {:?}: installs skills/{} but no [groups.<name>] skills list names {:?}", skill.name, skill.installed_name(), skill.installed_name());
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

/// Rewrites the whole file. Values survive; comments do not.
pub fn save(stack: &Path, file: &StackFile) -> Result<()> {
    file.validate()?;
    let text = format!("# Skill groups and vendored skills. Written by `ai-stack skills`; comments are not kept.\n\n{}", toml::to_string(file)?);
    let path = stack.join(FILE);
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
