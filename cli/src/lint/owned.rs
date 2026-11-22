use std::ops::RangeInclusive;

use serde::{Deserialize, Serialize};
use similar::{Algorithm, DiffOp};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Baseline {
    Absent,
    Text(String),
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Owned(Vec<RangeInclusive<u32>>);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Author {
    Agent,
    Other,
}

impl Owned {
    pub fn carried(&self, before: Option<&str>, after: Option<&str>, author: Author) -> Owned {
        let Some(after) = after else { return Owned::default() };
        let Some(before) = before else {
            return match author {
                Author::Agent => Owned::whole(after),
                Author::Other => Owned::default(),
            };
        };
        let old = lines(before);
        let new = lines(after);
        let mut held = vec![false; old.len()];
        for range in &self.0 {
            for line in range.clone() {
                if let Some(slot) = held.get_mut(line as usize - 1) {
                    *slot = true;
                }
            }
        }
        let mut owned = Owned::default();
        let mut mark = |from: usize, to: usize| owned.0.push(line_number(from)..=line_number(to));
        for op in similar::capture_diff_slices(Algorithm::Patience, &old, &new) {
            match op {
                DiffOp::Equal { old_index, new_index, len } => {
                    let mut run: Option<usize> = None;
                    for offset in 0..len {
                        match (held[old_index + offset], run) {
                            (true, None) => run = Some(new_index + offset),
                            (false, Some(start)) => {
                                mark(start, new_index + offset - 1);
                                run = None;
                            }
                            _ => {}
                        }
                    }
                    if let Some(start) = run {
                        mark(start, new_index + len - 1);
                    }
                }
                DiffOp::Insert { new_index, new_len, .. } | DiffOp::Replace { new_index, new_len, .. } if author == Author::Agent && new_len > 0 => {
                    mark(new_index, new_index + new_len - 1);
                }
                _ => {}
            }
        }
        owned.normalize();
        owned
    }

    pub fn between(baseline: &Baseline, current: &str) -> Owned {
        let before = match baseline {
            Baseline::Absent => None,
            Baseline::Text(text) => Some(text.as_str()),
        };
        Owned::default().carried(before, Some(current), Author::Agent)
    }

    pub fn whole(current: &str) -> Owned {
        let count = lines(current).len();
        let mut owned = Owned::default();
        if count > 0 {
            owned.add(1..=line_number(count - 1));
        }
        owned
    }

    pub fn is_empty(&self) -> bool {
        self.0.is_empty()
    }

    #[cfg(test)]
    pub fn ranges(&self) -> &[RangeInclusive<u32>] {
        &self.0
    }

    pub fn intersects(&self, lines: RangeInclusive<u32>) -> bool {
        self.0.iter().any(|owned| owned.start() <= lines.end() && lines.start() <= owned.end())
    }

    pub fn widen(&self, spans: &[RangeInclusive<u32>]) -> Owned {
        let mut widened = self.clone();
        for range in &self.0 {
            for line in range.clone() {
                let innermost = spans.iter().filter(|span| span.contains(&line)).min_by_key(|span| span.end() - span.start());
                if let Some(span) = innermost {
                    widened.add(span.clone());
                }
            }
        }
        widened
    }

    fn add(&mut self, range: RangeInclusive<u32>) {
        self.0.push(range);
        self.normalize();
    }

    fn normalize(&mut self) {
        self.0.sort_by_key(|range| *range.start());
        let mut merged: Vec<RangeInclusive<u32>> = Vec::with_capacity(self.0.len());
        for range in self.0.drain(..) {
            match merged.last_mut() {
                Some(last) if *range.start() <= last.end().saturating_add(1) => {
                    *last = *last.start()..=(*last.end()).max(*range.end());
                }
                _ => merged.push(range),
            }
        }
        self.0 = merged;
    }
}

fn line_number(index: usize) -> u32 {
    u32::try_from(index + 1).unwrap_or(u32::MAX)
}

fn lines(text: &str) -> Vec<&str> {
    if text.is_empty() {
        return Vec::new();
    }
    text.strip_suffix('\n').unwrap_or(text).split('\n').map(|line| line.strip_suffix('\r').unwrap_or(line)).collect()
}

pub struct LineIndex {
    starts: Vec<usize>,
}

impl LineIndex {
    pub fn new(source: &str) -> LineIndex {
        let starts = std::iter::once(0).chain(source.match_indices('\n').map(|(at, _)| at + 1)).collect();
        LineIndex { starts }
    }

    pub fn line(&self, byte: usize) -> u32 {
        line_number(self.starts.partition_point(|&start| start <= byte) - 1)
    }

    pub fn start(&self, line: u32) -> usize {
        self.starts[line as usize - 1]
    }

    pub fn span(&self, bytes: std::ops::Range<usize>) -> RangeInclusive<u32> {
        let last = if bytes.end > bytes.start { bytes.end - 1 } else { bytes.start };
        self.line(bytes.start)..=self.line(last)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn owned(before: Option<&str>, after: &str) -> Vec<RangeInclusive<u32>> {
        let baseline = before.map_or(Baseline::Absent, |text| Baseline::Text(text.to_string()));
        Owned::between(&baseline, after).ranges().to_vec()
    }

    #[test]
    fn owned_lines_are_the_inserted_and_replaced_lines_of_the_current_text() {
        assert_eq!(owned(Some("a\nb\nc\n"), "a\nB\nc\nd\n"), [2..=2, 4..=4]);
        assert_eq!(owned(Some("a\nb\nc\n"), "a\nc\n"), []);
        assert_eq!(owned(Some("a\nb"), "a\nb\nc"), [3..=3], "appending after a missing final newline does not own the old last line");
        assert_eq!(owned(Some("a\r\nb\r\n"), "a\nb\nc\n"), [3..=3], "a CRLF to LF change owns nothing by itself");
        assert_eq!(owned(Some("a\nb\n"), "a\r\nb\r\nx\r\n"), [3..=3]);
        assert_eq!(owned(None, "x\ny\n"), [1..=2]);
        assert_eq!(owned(None, ""), []);
        assert_eq!(owned(Some(""), "x"), [1..=1]);
        assert_eq!(owned(Some("same\n"), "same\n"), []);
    }

    #[test]
    fn kept_lines_keep_their_owner_and_only_the_agents_edits_add_lines() {
        let held = Owned(vec![2..=3]);
        let cases = [
            (Some("a\nB\nC\nd\n"), Some("x\na\nB\nC\nd\n"), Author::Other, vec![3..=4]),
            (Some("a\nB\nC\nd\n"), Some("x\na\nB\nC\nd\n"), Author::Agent, vec![1..=1, 3..=4]),
            (Some("a\nB\nC\nd\n"), Some("a\nB\ny\nd\n"), Author::Other, vec![2..=2]),
            (Some("a\nB\nC\nd\n"), Some("a\nB\nC\nd\ne\n"), Author::Other, vec![2..=3]),
            (Some("a\nB\nC\nd\n"), None, Author::Agent, vec![]),
            (None, Some("n\nm\n"), Author::Agent, vec![1..=2]),
            (None, Some("n\nm\n"), Author::Other, vec![]),
        ];
        for (before, after, author, expected) in cases {
            assert_eq!(held.carried(before, after, author).ranges(), expected, "{before:?} -> {after:?} by {author:?}");
        }
    }

    #[test]
    fn widening_adds_the_innermost_enclosing_span_of_each_owned_line() {
        let base = Owned::between(&Baseline::Text("1\n2\n3\n4\n5\n6\n7\n8\n9\n".into()), "1\n2\n3\n4\nX\n6\n7\n8\n9\n");
        assert_eq!(base.ranges(), [5..=5]);
        let spans = [1..=9, 3..=7, 4..=6];
        assert_eq!(base.widen(&spans).ranges(), [4..=6]);
        assert_eq!(base.widen(&[8..=9]).ranges(), [5..=5]);
        assert!(base.widen(&spans).intersects(6..=8));
        assert!(!base.widen(&spans).intersects(7..=9));
    }

    #[test]
    fn match_spans_end_on_the_line_of_their_last_byte() {
        let source = "/// doc\nfn f() {}\n";
        let index = LineIndex::new(source);
        assert_eq!(index.span(0..8), 1..=1, "a node that includes its newline ends on its own line");
        assert_eq!(index.span(8..17), 2..=2);
        assert_eq!(index.start(2), 8);
    }
}
