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
}
