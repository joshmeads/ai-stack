//! `<stack>/manifest.toml`: every skill the stack vendors from an external git repo.

use std::collections::BTreeSet;
use std::path::{Component, Path, PathBuf};

use anyhow::{Context as _, Result, anyhow, ensure};
use serde::{Deserialize, Deserializer, Serialize};

pub const FILE: &str = "manifest.toml";
pub const DEFAULT_DEST: &str = "plugins/jm-tools/skills";
pub const DEFAULT_REF: &str = "HEAD";

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Manifest {
    #[serde(default, rename = "skill", skip_serializing_if = "Vec::is_empty")]
    pub skills: Vec<Skill>,
}

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
}

impl Manifest {
    pub fn validate(&self) -> Result<()> {
        let mut seen = BTreeSet::new();
        for skill in &self.skills {
            let what = format!("[[skill]] {:?}", skill.name);
            single_component(&skill.name).with_context(|| format!("{what}: name"))?;
            if let Some(rename) = &skill.rename {
                single_component(rename).with_context(|| format!("{what}: move"))?;
            }
            inside(&skill.path).with_context(|| format!("{what}: path"))?;
            inside(&skill.dest).with_context(|| format!("{what}: dest"))?;
            crate::exec::check_ref(&skill.git_ref).with_context(|| format!("{what}: ref"))?;
            ensure!(!skill.source.trim().is_empty() && !skill.source.starts_with('-'), "{what}: invalid source {:?}", skill.source);
            ensure!(skill.commit.len() == 40 && skill.commit.bytes().all(|b| b.is_ascii_hexdigit()), "{what}: commit {:?} is not a 40-hex commit", skill.commit);
            let key = crate::paths::normalize(&skill.target());
            ensure!(seen.insert(key.clone()), "{what}: another entry also installs {}", key.display());
        }
        Ok(())
    }
}

/// A relative path made only of plain components, so joining it to the stack stays inside.
fn inside(path: &str) -> Result<()> {
    let parts: Vec<_> = Path::new(path).components().collect();
    ensure!(!parts.is_empty(), "is empty");
    ensure!(parts.iter().all(|part| matches!(part, Component::Normal(_))), "{path:?} must be relative, without `.` or `..`");
    Ok(())
}

fn single_component(name: &str) -> Result<()> {
    inside(name)?;
    ensure!(!name.contains('/') && !name.starts_with('.'), "{name:?} must be one plain directory name");
    Ok(())
}

pub fn from_str(text: &str) -> Result<Manifest> {
    let manifest: Manifest = toml::from_str(text)?;
    manifest.validate()?;
    Ok(manifest)
}

/// An absent manifest is an empty one.
pub fn load(stack: &Path) -> Result<Manifest> {
    let path = stack.join(FILE);
    match std::fs::read_to_string(&path) {
        Ok(text) => from_str(&text).with_context(|| format!("invalid {}", path.display())),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(Manifest::default()),
        Err(err) => Err(anyhow!("cannot read {}: {err}", path.display())),
    }
}

pub fn save(stack: &Path, manifest: &Manifest) -> Result<()> {
    manifest.validate()?;
    let text = format!("# Skills vendored from external git repos. Written by `ai-stack skills`.\n\n{}", toml::to_string(manifest)?);
    let path = stack.join(FILE);
    use std::io::Write as _;
    use std::os::unix::fs::PermissionsExt as _;
    let mut tmp = tempfile::Builder::new()
        .prefix(".manifest.")
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
        format!("[[skill]]\nname = \"grill\"\nsource = \"https://example.com/skills\"\npath = \"skills/grill\"\ncommit = \"{COMMIT}\"\n{extra}")
    }

    #[test]
    fn accepts_one_or_many_process_steps_and_round_trips() {
        let one = from_str(&entry("process = { type = \"script\", input = \"s.sh\" }\n")).unwrap();
        assert_eq!(one.skills[0].process, vec![Step { kind: StepKind::Script, input: "s.sh".into() }]);
        assert_eq!(one.skills[0].dest, DEFAULT_DEST);
        assert_eq!(one.skills[0].git_ref, "HEAD");
        let many = from_str(&entry("process = [{ type = \"script\", input = \"s.sh\" }, { type = \"prompt\", input = \"Be terse.\" }]\n")).unwrap();
        assert_eq!(many.skills[0].process[1].kind, StepKind::Prompt);
        assert_eq!(from_str(&toml::to_string(&many).unwrap()).unwrap(), many);
    }

    #[test]
    fn rejects_paths_outside_the_stack_and_duplicate_installs() {
        for (extra, message) in [
            ("dest = \"../elsewhere\"\n", "dest"),
            ("dest = \"/abs\"\n", "dest"),
            ("move = \"a/b\"\n", "move"),
            ("ref = \"--upload-pack=x\"\n", "ref"),
        ] {
            let err = format!("{:#}", from_str(&entry(extra)).unwrap_err());
            assert!(err.contains(message), "{message}: {err}");
        }
        let err = format!("{:#}", from_str(&entry("").replace("skills/grill", "skills/../../x")).unwrap_err());
        assert!(err.contains("path"), "{err}");
        let twice = format!("{}\n{}", entry(""), entry("").replace("name = \"grill\"", "name = \"other\"\nmove = \"grill\""));
        assert!(format!("{:#}", from_str(&twice).unwrap_err()).contains("also installs"));
    }
}
