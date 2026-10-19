use std::path::{Component, Path, PathBuf};

/// Expand `~` and resolve relative paths against the invocation directory.
pub fn absolute(path: &str, home: &Path) -> std::io::Result<PathBuf> {
    Ok(normalize(&std::path::absolute(expand(path, home))?))
}

/// Resolves `.` and `..` lexically, without following links.
pub fn normalize(path: &Path) -> PathBuf {
    let mut normalized = PathBuf::new();
    for part in path.components() {
        match part {
            Component::ParentDir => { normalized.pop(); }
            Component::CurDir => {}
            other => normalized.push(other.as_os_str()),
        }
    }
    normalized
}

/// Symlinks followed in one `resolve` before the rest is taken as written, as the kernel's
/// `ELOOP` limit does.
const MAX_LINKS: usize = 40;

/// `path` resolved through the filesystem with lstat semantics: every existing component that
/// is a symlink is replaced by its target, even when that target is missing, and `..` after it
/// leaves through the target. Components that do not exist are kept as written and `.` and `..`
/// among them are resolved lexically. The existing prefix finally goes through
/// `fs::canonicalize`, which also gives a case-insensitive disk's own spelling. Two spellings of
/// one place, such as `/tmp/x` and `/private/tmp/x`, resolve alike.
pub fn resolve(path: &Path) -> PathBuf {
    resolve_inner(path, None)
}

/// The full path at each symlink traversed during resolution, followed by the resolved path.
pub fn routes(path: &Path) -> Vec<PathBuf> {
    let mut routes = Vec::new();
    let real = resolve_inner(path, Some(&mut routes));
    routes.push(real);
    routes
}

fn resolve_inner(path: &Path, mut routes: Option<&mut Vec<PathBuf>>) -> PathBuf {
    let path = std::path::absolute(path).unwrap_or_else(|_| path.to_path_buf());
    let mut pending: Vec<std::ffi::OsString> = Vec::new();
    push_components(&mut pending, &path);
    let mut resolved = PathBuf::from("/");
    let mut followed = 0;
    while let Some(part) = pending.pop() {
        match part.to_str() {
            Some(".") => continue,
            Some("..") => {
                resolved.pop();
                continue;
            }
            _ => {}
        }
        let next = resolved.join(&part);
        let target = match std::fs::symlink_metadata(&next) {
            Ok(meta) if meta.file_type().is_symlink() && followed < MAX_LINKS => std::fs::read_link(&next).ok(),
            _ => None,
        };
        match target {
            Some(target) => {
                if let Some(routes) = routes.as_mut() {
                    let parent = std::fs::canonicalize(&resolved).unwrap_or_else(|_| resolved.clone());
                    routes.push(parent.join(&part).join(pending.iter().rev().collect::<PathBuf>()));
                }
                followed += 1;
                if target.is_absolute() {
                    resolved = PathBuf::from("/");
                }
                push_components(&mut pending, &target);
            }
            None => resolved = next,
        }
    }
    for ancestor in resolved.ancestors() {
        if let Ok(real) = std::fs::canonicalize(ancestor) {
            let rest = resolved.strip_prefix(ancestor).expect("an ancestor is a prefix");
            return if rest.as_os_str().is_empty() { real } else { real.join(rest) };
        }
    }
    resolved
}

/// Pushes `path`'s components onto `pending` so that popping yields them in order.
fn push_components(pending: &mut Vec<std::ffi::OsString>, path: &Path) {
    let parts: Vec<std::ffi::OsString> = path.components().filter_map(|part| match part {
        Component::RootDir | Component::Prefix(_) => None,
        other => Some(other.as_os_str().to_os_string()),
    }).collect();
    pending.extend(parts.into_iter().rev());
}

/// The file a shared path writes to: the link's target when `path` is a symlink (resolved even
/// when the target is missing), so the link stays.
pub fn write_through(path: &Path) -> std::io::Result<PathBuf> {
    match std::fs::symlink_metadata(path) {
        Ok(meta) if meta.file_type().is_symlink() => Ok(resolve(path)),
        Ok(_) => Ok(path.to_path_buf()),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(path.to_path_buf()),
        Err(err) => Err(err),
    }
}

/// Expands a leading `~` or `~/` against `home`. Other paths are returned unchanged.
pub fn expand(path: &str, home: &Path) -> PathBuf {
    if path == "~" {
        home.to_path_buf()
    } else if let Some(rest) = path.strip_prefix("~/") {
        home.join(rest)
    } else {
        PathBuf::from(path)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn expands_only_leading_tilde() {
        let home = Path::new("/h");
        assert_eq!(expand("~", home), PathBuf::from("/h"));
        assert_eq!(expand("~/a/b", home), PathBuf::from("/h/a/b"));
        assert_eq!(expand("/abs/~x", home), PathBuf::from("/abs/~x"));
    }

    #[test]
    fn resolve_follows_existing_links_and_appends_the_missing_rest() {
        let tmp = tempfile::tempdir().unwrap();
        let root = std::fs::canonicalize(tmp.path()).unwrap();
        std::fs::create_dir_all(root.join("outside/nested")).unwrap();
        std::fs::create_dir_all(root.join("stack")).unwrap();
        std::os::unix::fs::symlink(root.join("outside/nested"), root.join("stack/escape")).unwrap();
        // `..` after a symlink leaves through the link's target, as the kernel resolves it.
        assert_eq!(resolve(&root.join("stack/escape/../gone/x")), root.join("outside/gone/x"));
        assert_eq!(resolve(&root.join("stack/new/../y")), root.join("stack/y"));
    }

    #[test]
    fn resolve_follows_dangling_links_and_stops_on_a_loop() {
        let tmp = tempfile::tempdir().unwrap();
        let root = std::fs::canonicalize(tmp.path()).unwrap();
        std::fs::create_dir_all(root.join("stack")).unwrap();
        // A dangling link is still followed, so `..` after it leaves through its target.
        std::os::unix::fs::symlink(root.join("outside/missing"), root.join("stack/escape")).unwrap();
        assert_eq!(resolve(&root.join("stack/escape/../mine")), root.join("outside/mine"));
        assert_eq!(resolve(&root.join("stack/escape")), root.join("outside/missing"));
        // A relative dangling link resolves against its own directory.
        std::os::unix::fs::symlink("../elsewhere/x", root.join("stack/rel")).unwrap();
        assert_eq!(resolve(&root.join("stack/rel")), root.join("elsewhere/x"));
        std::os::unix::fs::symlink("loop", root.join("loop")).unwrap();
        assert_eq!(resolve(&root.join("loop/x")), root.join("loop/x"));
        // `/tmp` is a symlink on macOS; both spellings resolve alike.
        let tmp_spelling = PathBuf::from("/tmp");
        assert_eq!(resolve(&tmp_spelling.join("ai-stack-missing/x")), std::fs::canonicalize("/tmp").unwrap().join("ai-stack-missing/x"));
    }
}
