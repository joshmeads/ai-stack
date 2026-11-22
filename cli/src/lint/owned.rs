use std::ops::RangeInclusive;

use similar::{Algorithm, DiffOp};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Baseline {
    Absent,
    Text(String),
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Owned(Vec<RangeInclusive<u32>>);

impl Owned {
    pub fn between(baseline: &Baseline, current: &str) -> Owned {
        let new = lines(current);
        let Baseline::Text(before) = baseline else { return Owned::whole(current) };
        let old = lines(before);
        let mut owned = Owned::default();
        for op in similar::capture_diff_slices(Algorithm::Patience, &old, &new) {
            if let DiffOp::Insert { new_index, new_len, .. } | DiffOp::Replace { new_index, new_len, .. } = op
                && new_len > 0
            {
                owned.add(line_number(new_index)..=line_number(new_index + new_len - 1));
            }
        }
        owned
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
