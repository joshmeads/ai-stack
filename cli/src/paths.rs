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

/// `path` resolved through the filesystem as far as it exists: the longest existing ancestor
/// goes through `fs::canonicalize` (so symlinks and `..` behave as the kernel resolves them),
/// and the missing rest is appended and normalized lexically. Two spellings of one place, such
/// as `/tmp/x` and `/private/tmp/x` or a symlinked directory and its target, resolve alike.
pub fn resolve(path: &Path) -> PathBuf {
    for ancestor in path.ancestors() {
        if let Ok(real) = std::fs::canonicalize(ancestor) {
            let rest = path.strip_prefix(ancestor).expect("an ancestor is a prefix");
            return normalize(&real.join(rest));
        }
    }
    normalize(path)
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
}
