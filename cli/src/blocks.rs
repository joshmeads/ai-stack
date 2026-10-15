//! Marker-bounded blocks in text files.
//!
//! A block is `begin\nbody\nend`. `upsert` replaces an existing block in place or
//! appends a new one after one blank line. Duplicate, reversed or unbalanced
//! markers are errors, so a file never gains a second copy of a block.

use anyhow::{bail, ensure, Result};

const BLOCK_PREFIX: &str = "<!-- ai-stack:";
const BEGIN_SUFFIX: &str = ":begin -->";

pub fn begin_marker(name: &str) -> String {
    format!("<!-- ai-stack:{name}:begin -->")
}

pub fn end_marker(name: &str) -> String {
    format!("<!-- ai-stack:{name}:end -->")
}

/// Inserts or replaces the `ai-stack:<name>` block. `body` is trimmed.
pub fn upsert(text: &str, name: &str, body: &str) -> Result<String> {
    let begin = begin_marker(name);
    let end = end_marker(name);
    upsert_marked(text, &begin, &end, body)
}

pub const PSTACK_BEGIN: &str = "<!-- pstack:models:begin -->";
pub const PSTACK_END: &str = "<!-- pstack:models:end -->";

pub fn upsert_marked(text: &str, begin: &str, end: &str, body: &str) -> Result<String> {
    let block = format!("{begin}\n{}\n{end}", body.trim());
    match locate(text, &begin, &end)? {
        Some((start, stop)) => Ok(format!("{}{block}{}", &text[..start], &text[stop..])),
        None if text.trim().is_empty() => Ok(format!("{block}\n")),
        None => Ok(format!("{}\n\n{block}\n", text.trim_end())),
    }
}

/// Validates every managed marker: each `ai-stack:` block and the Codex model
/// mirror appears at most once, balanced, in order, and without overlap.
pub fn validate(text: &str) -> Result<()> {
    let mut names = std::collections::BTreeSet::new();
    for prefix in [BLOCK_PREFIX, "<!-- pstack:models:"] {
        for (index, _) in text.match_indices(prefix) {
            let tail = &text[index + prefix.len()..];
            let end = tail.find(" -->").ok_or_else(|| anyhow::anyhow!("unfinished managed marker"))?;
            let token = &tail[..end];
            if prefix == BLOCK_PREFIX {
                let (name, side) = token.rsplit_once(':').ok_or_else(|| anyhow::anyhow!("invalid managed marker"))?;
                if !is_block_name(name) || !matches!(side, "begin" | "end") { bail!("invalid managed marker"); }
                names.insert((begin_marker(name), end_marker(name)));
            } else {
                if !matches!(token, "begin" | "end") { bail!("invalid model mirror marker"); }
                names.insert((PSTACK_BEGIN.to_string(), PSTACK_END.to_string()));
            }
        }
    }
    let mut spans = Vec::new();
    for (begin, end) in names {
        if let Some(span) = locate(text, &begin, &end)? { spans.push(span); }
    }
    spans.sort();
    ensure!(spans.windows(2).all(|pair| pair[0].1 <= pair[1].0), "overlapping managed blocks");
    Ok(())
}

/// The first ai-stack, pstack or open-pstack marker prefix in `text`, if any.
pub fn find_marker(text: &str) -> Option<&'static str> {
    [BLOCK_PREFIX, "<!-- pstack:", "<!-- open-pstack:"].into_iter().find(|prefix| text.contains(prefix))
}

/// Removes the `ai-stack:<name>` block and the blank line that separated it. No-op when absent.
pub fn remove(text: &str, name: &str) -> Result<String> {
    remove_marked(text, &begin_marker(name), &end_marker(name))
}

/// Removes a block bounded by arbitrary markers (used for legacy `open-pstack:` blocks).
pub fn remove_marked(text: &str, begin: &str, end: &str) -> Result<String> {
    let Some((start, stop)) = locate(text, begin, end)? else {
        return Ok(text.to_string());
    };
    let head = text[..start].trim_end();
    let rest = &text[stop..];
    let tail_start = rest.trim_start_matches(['\n', '\r']);
    let tail = tail_start.trim_end();

    // Keep a blank line only where the removed block had one on either side.
    let gap_before = text[head.len()..start].matches('\n').count();
    let gap_after = rest[..rest.len() - tail_start.len()].matches('\n').count();
    let sep = if gap_before >= 2 || gap_after >= 2 {
        "\n\n"
    } else {
        "\n"
    };

    let joined = match (head.is_empty(), tail.is_empty()) {
        (true, _) => tail.to_string(),
        (false, true) => head.to_string(),
        (false, false) => format!("{head}{sep}{tail}"),
    };
    if joined.is_empty() {
        Ok(String::new())
    } else {
        Ok(format!("{joined}\n"))
    }
}

/// Names of all `ai-stack:` blocks in order of appearance.
pub fn block_names(text: &str) -> Vec<String> {
    let mut names = Vec::new();
    let mut rest = text;
    while let Some(index) = rest.find(BLOCK_PREFIX) {
        let after = &rest[index + BLOCK_PREFIX.len()..];
        match after.find(BEGIN_SUFFIX) {
            Some(end) if is_block_name(&after[..end]) => {
                names.push(after[..end].to_string());
                rest = &after[end + BEGIN_SUFFIX.len()..];
            }
            _ => rest = after,
        }
    }
    names
}

fn is_block_name(candidate: &str) -> bool {
    !candidate.is_empty()
        && candidate
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

/// Byte range `[start, stop)` of the block from its begin marker through its end marker.
/// `None` when neither marker is present. Errors on duplicate, reversed or unbalanced markers.
fn locate(text: &str, begin: &str, end: &str) -> Result<Option<(usize, usize)>> {
    let begins: Vec<usize> = text.match_indices(begin).map(|(i, _)| i).collect();
    let ends: Vec<usize> = text.match_indices(end).map(|(i, _)| i).collect();
    match (begins.as_slice(), ends.as_slice()) {
        ([], []) => Ok(None),
        ([start], [end_at]) => {
            if end_at < start {
                bail!("end marker {end} appears before begin marker {begin}");
            }
            Ok(Some((*start, end_at + end.len())))
        }
        (many, _) if many.len() > 1 => bail!("begin marker {begin} appears {} times", many.len()),
        (_, many) if many.len() > 1 => bail!("end marker {end} appears {} times", many.len()),
        _ => bail!("unbalanced markers: {begin} and {end} must both be present"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const BODY: &str = "Rule one.\nRule two.";

    #[test]
    fn upsert_into_empty_text_writes_block_and_newline() {
        let out = upsert("", "local", BODY).unwrap();
        assert_eq!(out, format!("{}\n", block("local", BODY)));
        let out = upsert("  \n\n", "local", BODY).unwrap();
        assert_eq!(out, format!("{}\n", block("local", BODY)));
    }

    #[test]
    fn upsert_appends_after_one_blank_line() {
        let out = upsert("# Notes\n\n\n", "local", BODY).unwrap();
        assert_eq!(out, format!("# Notes\n\n{}\n", block("local", BODY)));
    }

    #[test]
    fn upsert_replaces_in_place_and_is_idempotent() {
        let text = format!("before\n\n{}\n\nafter\n", block("local", "old"));
        let once = upsert(&text, "local", BODY).unwrap();
        assert_eq!(once, format!("before\n\n{}\n\nafter\n", block("local", BODY)));
        let twice = upsert(&once, "local", BODY).unwrap();
        assert_eq!(twice, once);
    }

    #[test]
    fn remove_leaves_no_double_blank_line() {
        let text = format!("top\n\n{}\n\nbottom\n", block("local", BODY));
        let out = remove(&text, "local").unwrap();
        assert_eq!(out, "top\n\nbottom\n");
        let only = format!("{}\n", block("local", BODY));
        assert_eq!(remove(&only, "local").unwrap(), "");
    }

    #[test]
    fn remove_marked_handles_legacy_block() {
        let legacy = "<!-- open-pstack:local:begin -->\nold\n<!-- open-pstack:local:end -->";
        let text = format!("keep\n\n{legacy}\n");
        let out = remove_marked(
            &text,
            "<!-- open-pstack:local:begin -->",
            "<!-- open-pstack:local:end -->",
        )
        .unwrap();
        assert_eq!(out, "keep\n");
    }

    #[test]
    fn marker_errors_name_the_marker() {
        let begin = begin_marker("local");
        let end = end_marker("local");
        let twice = format!("{begin}\na\n{end}\n{begin}\nb\n{end}\n");
        let err = upsert(&twice, "local", BODY).unwrap_err().to_string();
        assert!(err.contains(&begin), "{err}");
        let reversed = format!("{end}\nx\n{begin}\n");
        let err = remove(&reversed, "local").unwrap_err().to_string();
        assert!(err.contains(&end), "{err}");
        let unbalanced = format!("{begin}\nx\n");
        assert!(upsert(&unbalanced, "local", BODY).is_err());
        assert!(remove(&format!("{end}\n"), "local").is_err());
    }

    #[test]
    fn block_names_follow_file_order() {
        let text = format!(
            "{}\n\n{}\n\n{}\n",
            block("routing", "a"),
            block("local", "b"),
            "<!-- open-pstack:old:begin -->"
        );
        assert_eq!(block_names(&text), vec!["routing", "local"]);
    }

    fn block(name: &str, body: &str) -> String {
        format!("{}\n{body}\n{}", begin_marker(name), end_marker(name))
    }
}
