use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};

use anyhow::{Context as _, Result};
use globset::GlobSet;

use super::repo::Repo;
use super::rules::{Rules, glob_set};
use super::{Level, Scope, Severity};
use crate::config::{LintSection, Stack};
use crate::paths;

pub struct Settings {
    pub enabled: bool,
    pub scope: Scope,
    disable: BTreeSet<String>,
    enable: BTreeSet<String>,
    severity: BTreeMap<String, Level>,
    ignore: GlobSet,
    projects: Vec<Project>,
    pub shipped_rules: PathBuf,
    pub local_rules: PathBuf,
    pub state_dir: PathBuf,
}

struct Project {
    key: PathBuf,
    paths: BTreeMap<String, GlobSet>,
    ignore: GlobSet,
    scope: Option<Scope>,
    enabled: Option<bool>,
}

impl Settings {
    pub fn new(section: LintSection, stack: &Stack, config_dir: &Path, home: &Path) -> Result<Settings> {
        let projects = section
            .project
            .iter()
            .map(|project| {
                let context = || format!("[[lint.project]] {}", project.path);
                Ok(Project {
                    key: paths::resolve(&paths::absolute(&project.path, home).with_context(context)?),
                    paths: project.paths.iter().map(|(id, globs)| Ok((id.clone(), glob_set(globs)?))).collect::<Result<_>>().with_context(context)?,
                    ignore: glob_set(&project.ignore).with_context(context)?,
                    scope: project.scope,
                    enabled: project.enabled,
                })
            })
            .collect::<Result<_>>()?;
        Ok(Settings {
            enabled: section.enabled,
            scope: section.scope,
            disable: section.disable.into_iter().collect(),
            enable: section.enable.into_iter().collect(),
            severity: section.severity,
            ignore: glob_set(&section.ignore).context("[lint] ignore")?,
            projects,
            shipped_rules: stack.path.join("lint/rules"),
            local_rules: config_dir.join("lint/rules"),
            state_dir: home.join(".local/state/ai-stack/lint"),
        })
    }

    pub fn rules(&self) -> Result<Rules> {
        Rules::load(&self.shipped_rules, Some(&self.local_rules))
    }

    pub fn lints(&self, file: &Path) -> bool {
        self.enabled
            && (self.projects.iter().all(|project| project.enabled != Some(false))
                || self.policy(Repo::discover(file.parent().unwrap_or(file)).as_ref()).enabled())
    }

    pub fn policy(&self, repo: Option<&Repo>) -> Policy<'_> {
        let project = repo.and_then(|repo| self.projects.iter().find(|project| project.key == repo.project_key));
        Policy { settings: self, project }
    }
}

pub struct Policy<'a> {
    settings: &'a Settings,
    project: Option<&'a Project>,
}

impl Policy<'_> {
    pub fn enabled(&self) -> bool {
        self.settings.enabled && self.project.and_then(|project| project.enabled).unwrap_or(true)
    }

    pub fn scope(&self) -> Scope {
        self.project.and_then(|project| project.scope).unwrap_or(self.settings.scope)
    }

    pub fn ignored(&self, rel: &str) -> bool {
        self.settings.ignore.is_match(rel) || self.project.is_some_and(|project| project.ignore.is_match(rel))
    }

    pub fn allows(&self, id: &str, rel: &str) -> bool {
        self.project.and_then(|project| project.paths.get(id)).is_none_or(|globs| globs.is_match(rel))
    }

    pub fn severity(&self, id: &str, base: Option<Severity>, default_off: bool) -> Option<Severity> {
        if self.settings.disable.contains(id) {
            return None;
        }
        match self.settings.severity.get(id) {
            Some(Level::Off) => None,
            Some(Level::Error) => Some(Severity::Error),
            Some(Level::Warning) => Some(Severity::Warning),
            None if default_off && !self.settings.enable.contains(id) => None,
            None => Some(base.unwrap_or(Severity::Warning)),
        }
    }
}
