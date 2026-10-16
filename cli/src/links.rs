//! The skill folders: links from each harness's user skill folder to the global groups'
//! skills, the links and agent files older installs left behind, and the stray skills
//! `--clean` moves and `stray` reports.
//!
//! Every folder any of these touch is resolved once into a canonical index, so two spellings
//! of one directory (a symlinked `~/.codex/skills`, a shared `~/.claude/skills`) are one folder.
//! Every entry of every folder is classified once, and each action comes from that one
//! classification, so no two passes can disagree about an entry.

use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::io;
use std::os::unix::fs::MetadataExt as _;
use std::path::{Path, PathBuf};

use anyhow::{Context as _, Result};

use crate::config::Config;
use crate::install::Options;
use crate::ledger;
use crate::paths;
use crate::plan::{self, Action, Anchor, Displaced, Plan};
use crate::render;
use crate::stackfile::{self, SkillName, StackFile};

/// What counts as ai-stack's own: the stack and the legacy roots, resolved once, and the links
/// the ledger records.
pub struct Owner {
    stack: PathBuf,
    legacy: Vec<PathBuf>,
    recorded: BTreeMap<String, String>,
}

impl Owner {
    pub fn new(cfg: &Config) -> Owner {
        Owner {
            stack: paths::resolve(&cfg.stack.path),
            legacy: cfg.stack.legacy_paths.iter().map(|root| paths::resolve(root)).collect(),
            recorded: ledger::load(&ledger::path(&cfg.home)),
        }
    }

    /// Whether the symlink at `link` resolves into the stack or a legacy root.
    pub fn owns(&self, link: &Path) -> Result<bool> {
        let folder = paths::resolve(link.parent().unwrap_or(Path::new("/")));
        Ok(self.inside(&target_of(&folder, &read_link(link)?)))
    }

    /// The stack and every legacy root: ai-stack never links, unlinks or moves anything in them.
    fn roots(&self) -> impl Iterator<Item = &PathBuf> {
        std::iter::once(&self.stack).chain(&self.legacy)
    }

    fn inside(&self, real: &Path) -> bool {
        self.roots().any(|root| real.starts_with(root))
    }

    /// A link in a skill folder is ai-stack's when the ledger records it with this target, or
    /// when its target resolves into the stack or a legacy root.
    fn owns_skill_link(&self, folder: &Path, name: &str, target: &Path, real: &Path) -> bool {
        let recorded = self.recorded.get(&*folder.join(name).to_string_lossy());
        recorded.is_some_and(|recorded| *recorded == *target.to_string_lossy()) || self.inside(real)
    }
}

fn read_link(link: &Path) -> Result<PathBuf> {
    fs::read_link(link).with_context(|| format!("reading link {}", link.display()))
}

/// Where a link in the resolved `folder` with this target text points: the target's parent
/// resolved through the filesystem, its last component kept as written. A link to
/// `<stack>/skills/<name>` stays a link into the stack when that skill directory is itself a
/// symlink elsewhere, and `..` after a symlinked directory leaves through that directory's
/// target, dangling or not.
pub fn target_of(folder: &Path, target: &Path) -> PathBuf {
    let joined = folder.join(target);
    match (joined.parent(), joined.file_name()) {
        (Some(parent), Some(name)) if !target.ends_with("..") => paths::resolve(parent).join(name),
        _ => paths::resolve(&joined),
    }
}

/// One physical folder and every role it plays.
#[derive(Debug, Default)]
struct Folder {
    /// The first spelling seen; actions use it.
    path: PathBuf,
    real: PathBuf,
    /// A harness's user skill folder: the global groups' skills are linked here.
    links: bool,
    /// `<harness home>/skills` or `/agents`: ai-stack's links here are removed unless wanted.
    leftover: bool,
    /// `<harness home>/agents`: role agent files with the managed marker are removed.
    agents: bool,
    /// A `[clean] skill_roots` entry.
    clean: bool,
}

fn index(cfg: &Config) -> Vec<Folder> {
    let mut folders: Vec<Folder> = Vec::new();
    let mut add = |path: PathBuf, role: &dyn Fn(&mut Folder)| {
        let real = paths::resolve(&path);
        let at = folders.iter().position(|folder| folder.real == real).unwrap_or_else(|| {
            folders.push(Folder { path, real, ..Folder::default() });
            folders.len() - 1
        });
        role(&mut folders[at]);
    };
    for hc in &cfg.harnesses {
        add(hc.harness.skill_folder(&hc.home, &cfg.home), &|folder| folder.links = true);
    }
    for hc in &cfg.harnesses {
        add(hc.home.join("skills"), &|folder| folder.leftover = true);
        add(hc.home.join("agents"), &|folder| {
            folder.leftover = true;
            folder.agents = true;
        });
    }
    for root in &cfg.clean.skill_roots {
        add(root.clone(), &|folder| folder.clean = true);
    }
    folders
}

/// What one folder entry is, decided once.
enum Kind {
    /// A symlink ai-stack made: its target as written and as `target_of` resolves it.
    Ours { target: PathBuf, real: PathBuf },
    /// A role agent file an older ai-stack wrote.
    ManagedAgent { text: String },
    /// A directory or file that holds the stack or a legacy root.
    Protected { root: PathBuf },
    /// Anything else: a stray skill.
    Stray,
}

struct Entry {
    path: PathBuf,
    name: String,
    /// lstat device and inode, to find the entry a wanted name reaches on a case-insensitive disk.
    id: (u64, u64),
    kind: Kind,
}

/// Plans every skill folder: links for the global groups' skills, removal of ai-stack's
/// leftovers, and the stray skills (`Plan::stray`, and `--clean` moves).
pub fn plan(cfg: &Config, owner: &Owner, file: &StackFile, opts: Options, out: &mut Plan) -> Result<()> {
    let skills_dir = cfg.stack.path.join(stackfile::SKILLS_DIR);
    let mut wanted = BTreeSet::new();
    for name in file.global_skills() {
        if skills_dir.join(name.as_str()).is_dir() {
            wanted.insert(name);
        } else {
            out.warnings.push(format!("note: {name} is in a global group but {} is missing; run `ai-stack skills update {name}` to rebuild it", skills_dir.join(name.as_str()).display()));
        }
    }
    out.ledger = Some(ledger::path(&cfg.home));
    let skills = Skills { dir: &skills_dir, real: paths::resolve(&skills_dir) };
    let none = BTreeSet::new();
    for folder in index(cfg) {
        if let Some(root) = owner.roots().find(|root| folder.real.starts_with(root)) {
            out.conflicts.push(format!("{} resolves to {}, inside the stack checkout {}; ai-stack never links, unlinks or moves anything there. Make it a directory outside the stack", folder.path.display(), folder.real.display(), root.display()));
            continue;
        }
        let wanted = if folder.links { &wanted } else { &none };
        if !wanted.is_empty() {
            if let Some((link, target)) = dangling(&folder.path) {
                out.conflicts.push(format!("{} is a symlink to {}, which does not exist; mount or create it, or remove the link, then run again", link.display(), target.display()));
                continue;
            }
        }
        plan_folder(cfg, owner, &folder, wanted, &skills, opts, out)?;
    }
    Ok(())
}

/// The stack's skills directory as configured and resolved.
struct Skills<'a> {
    dir: &'a Path,
    real: PathBuf,
}

/// The first symlink among `path` and its ancestors whose target does not exist, when `path`
/// itself does not exist.
fn dangling(path: &Path) -> Option<(PathBuf, PathBuf)> {
    if fs::metadata(path).is_ok() {
        return None;
    }
    path.ancestors().find_map(|ancestor| {
        let link = fs::symlink_metadata(ancestor).ok()?.file_type().is_symlink();
        (link && fs::metadata(ancestor).is_err()).then(|| (ancestor.to_path_buf(), fs::read_link(ancestor).unwrap_or_default()))
    })
}

fn plan_folder(cfg: &Config, owner: &Owner, folder: &Folder, wanted: &BTreeSet<SkillName>, skills: &Skills, opts: Options, out: &mut Plan) -> Result<()> {
    let entries = read(owner, folder)?;
    let anchor = Anchor::of(&folder.real);
    let mut at: BTreeMap<&SkillName, usize> = BTreeMap::new();
    for name in wanted {
        if let Some(meta) = lstat(&folder.path.join(name.as_str()))? {
            let exact = entries.iter().position(|entry| entry.name == name.as_str());
            let same = || entries.iter().position(|entry| entry.id == (meta.dev(), meta.ino()));
            if let Some(index) = exact.or_else(same) {
                at.insert(name, index);
            }
        }
    }
    let occupied: BTreeSet<usize> = at.values().copied().collect();
    for (index, entry) in entries.iter().enumerate() {
        if let Kind::Protected { root } = &entry.kind {
            out.conflicts.push(format!("{} holds the stack checkout {}; ai-stack never moves it. Move the checkout out of {}", entry.path.display(), root.display(), folder.path.display()));
            continue;
        }
        if occupied.contains(&index) {
            continue;
        }
        match &entry.kind {
            Kind::Ours { target, .. } if folder.links || folder.leftover => out.actions.push(Action::Unlink { path: entry.path.clone(), target: target.clone(), anchor: anchor.clone() }),
            Kind::Ours { .. } | Kind::Protected { .. } => {}
            Kind::ManagedAgent { text } => out.actions.push(Action::Remove { path: entry.path.clone(), before: text.clone(), anchor: anchor.clone() }),
            Kind::Stray if folder.clean && !cfg.clean.keeps_skill(&entry.name) => {
                out.stray.push(entry.path.clone());
                if opts.clean && !opts.report {
                    out.actions.push(Action::MoveToBackup { fingerprint: plan::fingerprint(&entry.path)?, path: entry.path.clone(), clean: true, anchor: anchor.clone() });
                }
            }
            Kind::Stray => {}
        }
    }
    for name in wanted {
        let (path, target) = (folder.path.join(name.as_str()), skills.dir.join(name.as_str()));
        let displaces = match at.get(name).map(|&index| &entries[index]) {
            None => Displaced::Nothing,
            Some(Entry { kind: Kind::Protected { .. }, .. }) => continue,
            Some(Entry { path: entry, kind: Kind::Ours { target: was, real }, .. }) => {
                if *real == skills.real.join(name.as_str()) && *entry == path {
                    continue;
                }
                Displaced::OwnLink { entry: entry.clone(), target: was.clone() }
            }
            Some(entry) => {
                out.stray.push(entry.path.clone());
                let clean = folder.clean && opts.clean && !cfg.clean.keeps_skill(&entry.name);
                if !clean && !opts.force {
                    out.conflicts.push(format!("{} is a stray skill in the way of a skill the stack links there; move it, or run with --force to move it into the backup", entry.path.display()));
                    continue;
                }
                if opts.report {
                    continue;
                }
                Displaced::Stray { fingerprint: plan::fingerprint(&entry.path)?, entry: entry.path.clone(), clean }
            }
        };
        out.actions.push(Action::Link { path, target, displaces, anchor: anchor.clone() });
    }
    Ok(())
}

/// The folder's entries, sorted and classified, without dot entries (Codex's `.system`,
/// `.DS_Store`), which ai-stack never touches.
fn read(owner: &Owner, folder: &Folder) -> Result<Vec<Entry>> {
    let listing = match fs::read_dir(&folder.path) {
        Ok(listing) => listing,
        Err(err) if err.kind() == io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(err) => return Err(err).with_context(|| format!("reading {}", folder.path.display())),
    };
    let mut entries = Vec::new();
    for item in listing {
        let item = item.with_context(|| format!("reading {}", folder.path.display()))?;
        let name = item.file_name().to_string_lossy().into_owned();
        if name.starts_with('.') {
            continue;
        }
        let path = item.path();
        let meta = fs::symlink_metadata(&path).with_context(|| format!("inspecting {}", path.display()))?;
        let protected = || owner.roots().find(|root| root.starts_with(folder.real.join(&name))).cloned();
        let kind = if meta.file_type().is_symlink() {
            let target = read_link(&path)?;
            let real = target_of(&folder.real, &target);
            match owner.owns_skill_link(&folder.real, &name, &target, &real) {
                true => Kind::Ours { target, real },
                false => Kind::Stray,
            }
        } else if let Some(root) = protected() {
            Kind::Protected { root }
        } else if folder.agents && meta.is_file() {
            match fs::read_to_string(&path) {
                Ok(text) if text.contains(render::MANAGED_MD) || text.lines().next() == Some(render::MANAGED_TOML) => Kind::ManagedAgent { text },
                _ => Kind::Stray,
            }
        } else {
            Kind::Stray
        };
        entries.push(Entry { path, name, id: (meta.dev(), meta.ino()), kind });
    }
    entries.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(entries)
}

fn lstat(path: &Path) -> Result<Option<fs::Metadata>> {
    match fs::symlink_metadata(path) {
        Ok(meta) => Ok(Some(meta)),
        Err(err) if err.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(err) => Err(err).with_context(|| format!("inspecting {}", path.display())),
    }
}

#[cfg(test)]
mod tests {
    use std::os::unix::fs::symlink;

    use super::*;
    use crate::install::tests::{STACK_TOML, fixture, put};
    use crate::plan::tilde;

    fn clean() -> Options {
        Options { clean: true, ..Options::default() }
    }

    fn links(folder: &Path) -> Vec<(String, PathBuf)> {
        let mut found: Vec<(String, PathBuf)> = fs::read_dir(folder).unwrap().map(|entry| entry.unwrap().path())
            .filter(|path| fs::symlink_metadata(path).unwrap().file_type().is_symlink())
            .map(|path| (path.file_name().unwrap().to_string_lossy().into_owned(), fs::read_link(&path).unwrap()))
            .collect();
        found.sort();
        found
    }

    fn summary(plan: &Plan, home: &Path) -> Vec<String> {
        plan.actions.iter().map(|action| match action {
            Action::Link { path, displaces: Displaced::Nothing, .. } => format!("link {}", tilde(path, home)),
            Action::Link { path, displaces: Displaced::OwnLink { .. }, .. } => format!("repoint {}", tilde(path, home)),
            Action::Link { path, displaces: Displaced::Stray { clean, .. }, .. } => format!("move+link {} clean={clean}", tilde(path, home)),
            Action::Unlink { path, .. } => format!("unlink {}", tilde(path, home)),
            Action::MoveToBackup { path, clean, .. } => format!("move {} clean={clean}", tilde(path, home)),
            other => format!("{other:?}"),
        }).collect()
    }

    fn link_actions(plan: &Plan, home: &Path) -> Vec<String> {
        let mut only = plan.clone();
        only.actions.retain(|action| matches!(action, Action::Link { .. } | Action::Unlink { .. } | Action::MoveToBackup { .. }));
        summary(&only, home)
    }

    #[test]
    fn skill_links_follow_the_global_groups() {
        let f = fixture();
        let (claude, agents) = (f.home.join(".claude/skills"), f.home.join(".agents/skills"));
        let target = |name: &str| f.stack.join("skills").join(name);
        let first = f.plan();
        // (a) A missing link is a Link in each harness's user skill folder.
        assert_eq!(link_actions(&first, &f.home), ["link ~/.claude/skills/feedback", "link ~/.claude/skills/handoff", "link ~/.agents/skills/feedback", "link ~/.agents/skills/handoff"]);
        f.apply(&first);
        let tools = vec![("feedback".to_string(), target("feedback")), ("handoff".to_string(), target("handoff"))];
        assert_eq!(links(&claude), tools);
        assert_eq!(links(&agents), tools);
        // (b) Correct links are no action, and the leftover rule leaves them alone.
        assert!(f.plan().is_empty(), "{}", f.plan().render_text(&f.home));

        // (c) Turning a group off unlinks its skills; turning one on links its skills.
        put(&f.stack.join("stack.toml"), &STACK_TOML.replace("[groups.tools]\nglobal = true", "[groups.tools]\nglobal = false").replace("[groups.games]\n", "[groups.games]\nglobal = true\n"));
        let switched = f.plan();
        assert_eq!(summary(&switched, &f.home), [
            "unlink ~/.claude/skills/feedback", "unlink ~/.claude/skills/handoff", "link ~/.claude/skills/game-mvp",
            "unlink ~/.agents/skills/feedback", "unlink ~/.agents/skills/handoff", "link ~/.agents/skills/game-mvp",
        ]);
        f.apply(&switched);
        assert_eq!(links(&agents), [("game-mvp".to_string(), target("game-mvp"))]);

        // An ai-stack link to the wrong place (a legacy root) is repointed.
        fs::remove_file(agents.join("game-mvp")).unwrap();
        symlink(f.root.join("legacy/skills/game-mvp"), agents.join("game-mvp")).unwrap();
        let repoint = f.plan();
        assert_eq!(repoint.actions, [Action::Link {
            path: agents.join("game-mvp"),
            target: target("game-mvp"),
            displaces: Displaced::OwnLink { entry: agents.join("game-mvp"), target: f.root.join("legacy/skills/game-mvp") },
            anchor: Anchor::of(&agents),
        }]);
        f.apply(&repoint);
        assert!(f.plan().is_empty());
    }

    #[test]
    fn a_stray_skill_in_a_links_way_is_a_conflict_or_moves_to_backup_and_never_counts_our_links() {
        let f = fixture();
        f.apply(&f.plan());
        let agents = f.home.join(".agents/skills");
        fs::remove_file(agents.join("handoff")).unwrap();
        put(&agents.join("handoff/SKILL.md"), "mine\n");
        put(&agents.join("other/SKILL.md"), "other\n");
        // A link to somewhere else is not ours either, so it is in the way too.
        fs::remove_file(f.home.join(".claude/skills/feedback")).unwrap();
        symlink(f.root.join("elsewhere/feedback"), f.home.join(".claude/skills/feedback")).unwrap();

        // (d) Without --force: a conflict naming the path, and nothing linked over it.
        let refused = f.plan();
        assert_eq!(refused.conflicts.len(), 2, "{:?}", refused.conflicts);
        assert!(refused.conflicts.iter().any(|c| c.starts_with(&format!("{} is a stray skill in the way", agents.join("handoff").display()))), "{:?}", refused.conflicts);
        assert!(refused.actions.is_empty(), "{}", refused.render_text(&f.home));
        // stray reports what is in the way and what --clean moves, never our links.
        let strays = ["~/.agents/skills/handoff", "~/.agents/skills/other", "~/.claude/skills/feedback"];
        assert_eq!(refused.stray(&f.home).skill_names, strays);
        let cleaned = f.plan_with(clean());
        assert_eq!(cleaned.stray(&f.home).skill_names, strays);
        assert!(cleaned.conflicts.is_empty(), "{:?}", cleaned.conflicts);

        // With --force: each stray moves into the backup as part of its link.
        let forced = f.plan_with(Options { force: true, ..Options::default() });
        assert!(forced.conflicts.is_empty(), "{:?}", forced.conflicts);
        assert_eq!(link_actions(&forced, &f.home), ["move+link ~/.claude/skills/feedback clean=false", "move+link ~/.agents/skills/handoff clean=false"]);
        assert_eq!(forced.clean_count(), 0);
        let report = crate::plan::apply(&forced, &f.root.join("backups"), &f.runner).unwrap();
        let backup = report.backup_dir.unwrap().join("home");
        assert_eq!(fs::read_to_string(backup.join(".agents/skills/handoff/SKILL.md")).unwrap(), "mine\n");
        assert_eq!(fs::read_link(backup.join(".claude/skills/feedback")).unwrap(), f.root.join("elsewhere/feedback"));
        assert_eq!(fs::read_link(agents.join("handoff")).unwrap(), f.stack.join("skills/handoff"));
        assert!(agents.join("other/SKILL.md").exists());
        assert!(f.plan().is_empty(), "{}", f.plan().render_text(&f.home));
    }

    #[test]
    fn a_kept_stray_at_a_wanted_name_is_reported_by_stray_and_install_alike() {
        let mut f = fixture();
        f.cfg.clean.keep_skills.push("handoff".into());
        let agents = f.home.join(".agents/skills");
        put(&agents.join("handoff/SKILL.md"), "mine\n");
        let plan = f.plan_with(clean());
        assert_eq!(plan.conflicts, [format!("{} is a stray skill in the way of a skill the stack links there; move it, or run with --force to move it into the backup", agents.join("handoff").display())]);
        assert_eq!(plan.stray(&f.home).skill_names, ["~/.agents/skills/handoff"]);
        let forced = f.plan_with(Options { force: true, clean: true, ..Options::default() });
        assert!(link_actions(&forced, &f.home).contains(&"move+link ~/.agents/skills/handoff clean=false".to_string()));
    }

    #[test]
    fn a_codex_skills_alias_of_the_agents_folder_settles_in_both_directions() {
        // ~/.codex/skills -> ../.agents/skills after an install.
        let f = fixture();
        f.apply(&f.plan());
        symlink("../.agents/skills", f.home.join(".codex/skills")).unwrap();
        for opts in [Options::default(), clean(), Options { force: true, clean: true, ..Options::default() }] {
            let plan = f.plan_with(opts);
            assert!(plan.is_empty(), "{opts:?}: {}", plan.render_text(&f.home));
            assert!(plan.stray.is_empty());
        }
        assert_eq!(links(&f.home.join(".agents/skills")).len(), 2);

        // ~/.agents/skills -> ../.codex/skills before the first install.
        let g = fixture();
        fs::create_dir_all(g.home.join(".codex/skills")).unwrap();
        fs::create_dir_all(g.home.join(".agents")).unwrap();
        symlink("../.codex/skills", g.home.join(".agents/skills")).unwrap();
        let first = g.plan();
        assert_eq!(link_actions(&first, &g.home), ["link ~/.claude/skills/feedback", "link ~/.claude/skills/handoff", "link ~/.agents/skills/feedback", "link ~/.agents/skills/handoff"]);
        g.apply(&first);
        assert!(g.plan().is_empty(), "{}", g.plan().render_text(&g.home));
        assert_eq!(links(&g.home.join(".codex/skills")).len(), 2);
    }

    #[test]
    fn a_folder_two_harnesses_share_is_read_once_so_each_stray_moves_once() {
        let mut f = fixture();
        let (claude, agents) = (f.home.join(".claude/skills"), f.home.join(".agents/skills"));
        put(&agents.join("demo/SKILL.md"), "demo\n");
        put(&agents.join("handoff/SKILL.md"), "mine\n");
        fs::create_dir_all(f.home.join(".claude")).unwrap();
        symlink("../.agents/skills", &claude).unwrap();
        f.cfg.clean.skill_roots = vec![agents.clone(), claude.clone(), f.home.join(".codex/skills")];

        let refused = f.plan();
        assert_eq!(refused.conflicts.len(), 1, "{:?}", refused.conflicts);
        assert_eq!(refused.stray(&f.home).skill_names, ["~/.claude/skills/demo", "~/.claude/skills/handoff"]);

        let plan = f.plan_with(Options { force: true, clean: true, ..Options::default() });
        assert!(plan.conflicts.is_empty(), "{:?}", plan.conflicts);
        assert_eq!(link_actions(&plan, &f.home), ["move ~/.claude/skills/demo clean=true", "link ~/.claude/skills/feedback", "move+link ~/.claude/skills/handoff clean=true"]);
        let report = crate::plan::apply(&plan, &f.root.join("backups"), &f.runner).unwrap();
        let backup = report.backup_dir.unwrap().join("home/.claude/skills");
        assert_eq!(fs::read_to_string(backup.join("demo/SKILL.md")).unwrap(), "demo\n");
        assert_eq!(fs::read_to_string(backup.join("handoff/SKILL.md")).unwrap(), "mine\n");
        assert_eq!(links(&agents).len(), 2);
        assert!(f.plan_with(clean()).is_empty(), "{}", f.plan_with(clean()).render_text(&f.home));
    }

    #[test]
    fn links_stay_ours_through_a_stack_alias_and_into_another_checkout() {
        let mut f = fixture();
        f.apply(&f.plan());
        let real = f.stack.clone();

        // The same checkout through a symlink alias: nothing changes and nothing is stray.
        symlink(&real, f.root.join("alias")).unwrap();
        f.cfg.stack.path = f.root.join("alias");
        let aliased = f.plan_with(clean());
        assert!(aliased.is_empty(), "{}", aliased.render_text(&f.home));
        assert!(aliased.stray.is_empty());

        // An install with --stack <other checkout>, then a plain one.
        let other = f.root.join("other");
        for file in ["stack.toml", ".claude-plugin/marketplace.json", ".agents/plugins/marketplace.json", "plugins/pstack/.codex-plugin/plugin.json"] {
            put(&other.join(file), &fs::read_to_string(real.join(file)).unwrap());
        }
        for skill in ["handoff", "feedback", "game-mvp"] {
            put(&other.join("skills").join(skill).join("SKILL.md"), &format!("---\nname: {skill}\n---\n"));
        }
        let plain = (real.clone(), f.cfg.stack.legacy_paths.clone());
        f.cfg.stack.path = other.clone();
        f.cfg.stack.legacy_paths.push(real.clone());
        f.runner.claude.borrow_mut().marketplaces.insert("jm".into(), other.display().to_string());
        f.runner.codex.borrow_mut().marketplaces.insert("jm".into(), other.display().to_string());
        f.apply(&f.plan());
        assert_eq!(fs::read_link(f.home.join(".agents/skills/handoff")).unwrap(), other.join("skills/handoff"));

        (f.cfg.stack.path, f.cfg.stack.legacy_paths) = plain;
        f.runner.claude.borrow_mut().marketplaces.insert("jm".into(), real.display().to_string());
        f.runner.codex.borrow_mut().marketplaces.insert("jm".into(), real.display().to_string());
        let back = f.plan_with(clean());
        assert!(back.conflicts.is_empty() && back.stray.is_empty(), "{}", back.render_text(&f.home));
        assert_eq!(link_actions(&back, &f.home), ["repoint ~/.claude/skills/feedback", "repoint ~/.claude/skills/handoff", "repoint ~/.agents/skills/feedback", "repoint ~/.agents/skills/handoff"]);
        f.apply(&back);
        assert!(f.plan().is_empty(), "{}", f.plan().render_text(&f.home));
    }

    #[test]
    fn a_link_that_leaves_the_stack_through_an_outside_symlink_is_stray() {
        let f = fixture();
        put(&f.root.join("outside/handoff/SKILL.md"), "theirs\n");
        fs::create_dir_all(f.root.join("outside/nested")).unwrap();
        symlink(f.root.join("outside/nested"), f.stack.join("escape")).unwrap();
        // `dangling` points at a directory that does not exist.
        symlink(f.root.join("outside/missing/deeper"), f.stack.join("dangling")).unwrap();
        let agents = f.home.join(".agents/skills");
        fs::create_dir_all(&agents).unwrap();
        // Lexically these point into the stack; through `escape` and `dangling` they point outside it.
        symlink(f.stack.join("escape/../handoff"), agents.join("handoff")).unwrap();
        symlink(f.stack.join("escape/../gone"), agents.join("gone")).unwrap();
        symlink(f.stack.join("dangling/../mine"), agents.join("mine")).unwrap();
        // Through an outside alias of the stack, a link to a missing skill is still ours.
        symlink(&f.stack, f.root.join("alias")).unwrap();
        symlink(f.root.join("alias/skills/retired"), agents.join("retired")).unwrap();
        let plan = f.plan();
        assert_eq!(plan.conflicts.len(), 1, "{:?}", plan.conflicts);
        assert!(plan.conflicts[0].starts_with(&format!("{} is a stray skill", agents.join("handoff").display())));
        assert_eq!(plan.stray(&f.home).skill_names, ["~/.agents/skills/gone", "~/.agents/skills/handoff", "~/.agents/skills/mine"]);
        assert!(link_actions(&plan, &f.home).contains(&"unlink ~/.agents/skills/retired".to_string()), "{}", plan.render_text(&f.home));
        assert!(!link_actions(&plan, &f.home).iter().any(|action| action.contains("mine")));
    }

    #[test]
    fn a_link_into_an_unrelated_repo_with_a_stack_toml_is_stray() {
        let f = fixture();
        f.apply(&f.plan());
        let unrelated = f.root.join("code/unrelated");
        put(&unrelated.join("stack.toml"), "[run-image]\nimage = \"example/run\"\n");
        put(&unrelated.join("skills/my-skill/SKILL.md"), "mine\n");
        put(&unrelated.join("skills/handoff/SKILL.md"), "my fork\n");
        let (claude, agents) = (f.home.join(".claude/skills"), f.home.join(".agents/skills"));
        symlink(unrelated.join("skills/my-skill"), claude.join("my-skill")).unwrap();
        fs::remove_file(agents.join("handoff")).unwrap();
        symlink(unrelated.join("skills/handoff"), agents.join("handoff")).unwrap();
        let plan = f.plan();
        assert_eq!(plan.conflicts, [format!("{} is a stray skill in the way of a skill the stack links there; move it, or run with --force to move it into the backup", agents.join("handoff").display())]);
        assert!(plan.actions.iter().all(|action| !matches!(action, Action::Unlink { .. } | Action::Link { .. })), "{}", plan.render_text(&f.home));
        assert_eq!(plan.stray(&f.home).skill_names, ["~/.agents/skills/handoff", "~/.claude/skills/my-skill"]);
    }

    #[test]
    fn the_ledger_keeps_links_into_a_deleted_checkout_ours() {
        let mut f = fixture();
        let other = f.root.join("wt");
        for file in ["stack.toml", ".claude-plugin/marketplace.json", ".agents/plugins/marketplace.json", "plugins/pstack/.codex-plugin/plugin.json"] {
            put(&other.join(file), &fs::read_to_string(f.stack.join(file)).unwrap());
        }
        for skill in ["handoff", "feedback", "game-mvp"] {
            put(&other.join("skills").join(skill).join("SKILL.md"), &format!("---\nname: {skill}\n---\n"));
        }
        let plain = (f.cfg.stack.path.clone(), f.cfg.stack.legacy_paths.clone());
        f.cfg.stack.legacy_paths.push(f.stack.clone());
        f.cfg.stack.path = other.clone();
        for state in [&f.runner.claude, &f.runner.codex] {
            state.borrow_mut().marketplaces.insert("jm".into(), other.display().to_string());
        }
        f.apply(&f.plan());
        let agents = f.home.join(".agents/skills");
        let recorded = ledger::load(&ledger::path(&f.home));
        assert_eq!(recorded.get(&*agents.join("handoff").to_string_lossy()), Some(&other.join("skills/handoff").display().to_string()));
        assert_eq!(recorded.len(), 4, "{recorded:?}");

        fs::remove_dir_all(&other).unwrap();
        (f.cfg.stack.path, f.cfg.stack.legacy_paths) = plain;
        for state in [&f.runner.claude, &f.runner.codex] {
            state.borrow_mut().marketplaces.insert("jm".into(), f.stack.display().to_string());
        }
        let back = f.plan_with(clean());
        assert!(back.conflicts.is_empty() && back.stray.is_empty(), "{}", back.render_text(&f.home));
        assert_eq!(link_actions(&back, &f.home), ["repoint ~/.claude/skills/feedback", "repoint ~/.claude/skills/handoff", "repoint ~/.agents/skills/feedback", "repoint ~/.agents/skills/handoff"]);
        f.apply(&back);
        assert!(f.plan().is_empty(), "{}", f.plan().render_text(&f.home));
        let recorded = ledger::load(&ledger::path(&f.home));
        assert_eq!(recorded.get(&*agents.join("handoff").to_string_lossy()), Some(&f.stack.join("skills/handoff").display().to_string()));

        // A link the ledger records with another target is not ours.
        fs::remove_file(agents.join("handoff")).unwrap();
        symlink(f.root.join("mine/handoff"), agents.join("handoff")).unwrap();
        assert_eq!(f.plan().stray(&f.home).skill_names, ["~/.agents/skills/handoff"]);
        // An unlink drops its entry.
        fs::remove_file(agents.join("handoff")).unwrap();
        symlink(f.stack.join("skills/handoff"), agents.join("handoff")).unwrap();
        put(&f.stack.join("stack.toml"), &STACK_TOML.replace("global = true", "global = false"));
        f.apply(&f.plan());
        assert!(ledger::load(&ledger::path(&f.home)).is_empty());
    }

    #[test]
    fn a_stack_skill_that_is_itself_a_symlink_settles() {
        let f = fixture();
        let dev = f.root.join("code/handoff-dev");
        put(&dev.join("SKILL.md"), "---\nname: handoff\n---\n");
        fs::remove_dir_all(f.stack.join("skills/handoff")).unwrap();
        symlink(&dev, f.stack.join("skills/handoff")).unwrap();
        f.apply(&f.plan());
        assert_eq!(fs::read_link(f.home.join(".agents/skills/handoff")).unwrap(), f.stack.join("skills/handoff"));
        let again = f.plan_with(clean());
        assert!(again.is_empty() && again.stray.is_empty(), "{}", again.render_text(&f.home));
    }

    #[test]
    fn a_skill_folder_inside_the_stack_is_a_conflict_even_with_force() {
        let f = fixture();
        fs::create_dir_all(f.home.join(".claude")).unwrap();
        symlink(f.stack.join("skills"), f.home.join(".claude/skills")).unwrap();
        let plan = f.plan_with(Options { force: true, clean: true, ..Options::default() });
        assert_eq!(plan.conflicts, [format!(
            "{} resolves to {}, inside the stack checkout {}; ai-stack never links, unlinks or moves anything there. Make it a directory outside the stack",
            f.home.join(".claude/skills").display(),
            f.stack.join("skills").display(),
            f.stack.display()
        )]);
        assert!(plan.actions.iter().all(|action| !action.path().starts_with(f.home.join(".claude/skills"))), "{}", plan.render_text(&f.home));
        assert!(crate::plan::apply(&plan, &f.root.join("backups"), &f.runner).is_err());
        assert!(f.stack.join("skills/handoff/SKILL.md").is_file());
    }

    #[test]
    fn folders_holding_or_inside_a_checkout_are_conflicts() {
        // The configured checkout is a legacy root during `--stack <other>`.
        let mut f = fixture();
        let configured = f.stack.clone();
        fs::create_dir_all(f.home.join(".claude")).unwrap();
        symlink(configured.join("skills"), f.home.join(".claude/skills")).unwrap();
        let other = f.root.join("other");
        for file in ["stack.toml", ".claude-plugin/marketplace.json", ".agents/plugins/marketplace.json", "plugins/pstack/.codex-plugin/plugin.json"] {
            put(&other.join(file), &fs::read_to_string(configured.join(file)).unwrap());
        }
        for skill in ["handoff", "feedback", "game-mvp"] {
            put(&other.join("skills").join(skill).join("SKILL.md"), "x\n");
        }
        f.cfg.stack.path = other;
        f.cfg.stack.legacy_paths.push(configured.clone());
        let plan = f.plan_with(Options { force: true, clean: true, ..Options::default() });
        assert!(plan.conflicts.iter().any(|c| c.starts_with(&format!("{} resolves to {}, inside the stack checkout {}", f.home.join(".claude/skills").display(), configured.join("skills").display(), configured.display()))), "{:?}", plan.conflicts);
        assert!(plan.actions.iter().all(|action| !action.path().starts_with(f.home.join(".claude/skills"))), "{}", plan.render_text(&f.home));

        // A checkout sitting in a skill folder, and a clean root that holds the checkout.
        let mut g = fixture();
        let checkout = g.home.join(".claude/skills/source");
        fs::create_dir_all(checkout.parent().unwrap()).unwrap();
        fs::rename(&g.stack, &checkout).unwrap();
        g.cfg.stack.path = checkout.clone();
        g.cfg.clean.skill_roots.push(g.root.clone());
        let plan = g.plan_with(Options { force: true, clean: true, ..Options::default() });
        for (entry, folder) in [(&checkout, g.home.join(".claude/skills")), (&g.home, g.root.clone())] {
            let message = format!("{} holds the stack checkout {}; ai-stack never moves it. Move the checkout out of {}", entry.display(), checkout.display(), folder.display());
            assert!(plan.conflicts.contains(&message), "{message}\n{:?}", plan.conflicts);
        }
        assert!(!plan.stray.contains(&checkout));
        assert!(crate::plan::apply(&plan, &g.root.join("backups"), &g.runner).is_err());
        assert!(checkout.join("stack.toml").is_file());
    }

    #[test]
    fn a_user_skill_folder_that_is_a_dangling_symlink_is_a_conflict() {
        let f = fixture();
        fs::create_dir_all(f.home.join(".claude")).unwrap();
        symlink("/Volumes/ai-stack-not-mounted/skills", f.home.join(".claude/skills")).unwrap();
        let plan = f.plan();
        assert_eq!(plan.conflicts, [format!("{} is a symlink to /Volumes/ai-stack-not-mounted/skills, which does not exist; mount or create it, or remove the link, then run again", f.home.join(".claude/skills").display())]);
        assert!(plan.actions.iter().all(|action| !action.path().starts_with(f.home.join(".claude/skills"))));
    }

    #[test]
    fn apply_refuses_when_the_folder_was_swapped_after_planning() {
        let f = fixture();
        let agents = f.home.join(".agents/skills");
        let (first, second) = (f.root.join("ext1"), f.root.join("ext2"));
        put(&first.join("handoff/SKILL.md"), "mine\n");
        fs::create_dir_all(&second).unwrap();
        fs::create_dir_all(agents.parent().unwrap()).unwrap();
        symlink(&first, &agents).unwrap();
        let plan = f.plan_with(Options { force: true, ..Options::default() });
        assert!(link_actions(&plan, &f.home).contains(&"move+link ~/.agents/skills/handoff clean=false".to_string()));
        // The same entry (same fingerprint) in another folder, reached through the same spelling.
        fs::rename(first.join("handoff"), second.join("handoff")).unwrap();
        fs::remove_file(&agents).unwrap();
        symlink(&second, &agents).unwrap();
        let err = crate::plan::apply(&plan, &f.root.join("backups"), &f.runner).unwrap_err();
        assert!(err.to_string().contains("is no longer the folder the plan was made for"), "{err}");
        assert!(second.join("handoff/SKILL.md").is_file());

        // The same path, but another directory.
        fs::remove_file(&agents).unwrap();
        fs::create_dir_all(&agents).unwrap();
        put(&agents.join("handoff/SKILL.md"), "mine\n");
        let plan = f.plan_with(Options { force: true, ..Options::default() });
        fs::rename(&agents, f.root.join("moved")).unwrap();
        fs::create_dir_all(&agents).unwrap();
        fs::rename(f.root.join("moved/handoff"), agents.join("handoff")).unwrap();
        let err = crate::plan::apply(&plan, &f.root.join("backups"), &f.runner).unwrap_err();
        assert!(err.to_string().contains("is no longer the folder the plan was made for"), "{err}");
    }

    #[test]
    fn a_stray_found_by_inode_keeps_its_on_disk_name() {
        let f = fixture();
        let agents = f.home.join(".agents/skills");
        put(&agents.join("HANDOFF/SKILL.md"), "mine\n");
        if fs::symlink_metadata(agents.join("handoff")).is_err() {
            return; // A case-sensitive disk: the names are two entries.
        }
        let plan = f.plan_with(Options { force: true, ..Options::default() });
        let index = plan.actions.iter().position(|action| matches!(action, Action::Link { displaces: Displaced::Stray { .. }, .. })).unwrap();
        assert!(plan.diff(index).starts_with(&format!("Move the stray skill {} (directory)", agents.join("HANDOFF").display())), "{}", plan.diff(index));
        let report = crate::plan::apply(&plan, &f.root.join("backups"), &f.runner).unwrap();
        let backup = report.backup_dir.unwrap().join("home/.agents/skills");
        let names: Vec<_> = fs::read_dir(&backup).unwrap().map(|entry| entry.unwrap().file_name()).collect();
        assert_eq!(names, ["HANDOFF"]);
        let names: Vec<_> = fs::read_dir(&agents).unwrap().map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned()).collect::<BTreeSet<_>>().into_iter().collect();
        assert_eq!(names, ["feedback", "handoff"]);
        assert!(f.plan().is_empty(), "{}", f.plan().render_text(&f.home));
    }
}
