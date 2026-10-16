use std::collections::{BTreeMap, BTreeSet};

use serde::Serialize;
use serde_json::Value;

pub type Flat = BTreeMap<String, Value>;
pub type Pattern = String;

#[derive(Debug, PartialEq, Serialize)]
pub struct KeyDiff {
    pub key: String,
    pub local: Option<Value>,
    pub remote: Option<Value>,
}

#[derive(Debug, PartialEq, Serialize)]
pub struct Drift {
    pub keys: Vec<KeyDiff>,
    pub ignored: usize,
}

pub fn drift(local: &Flat, remote: &Flat, ignore: &[Pattern]) -> Drift {
    let mut result = Drift { keys: Vec::new(), ignored: 0 };
    let keys: BTreeSet<_> = local.keys().chain(remote.keys()).collect();
    for key in keys {
        if local.get(key) == remote.get(key) { continue; }
        if ignore.iter().any(|pattern| crate::config::glob(pattern, key)) {
            result.ignored += 1;
        } else {
            result.keys.push(KeyDiff { key: key.clone(), local: local.get(key).cloned(), remote: remote.get(key).cloned() });
        }
    }
    result
}

pub fn value(value: Option<&Value>) -> String {
    match value {
        None => "(absent)".into(),
        Some(Value::String(text)) => text.clone(),
        Some(value) => value.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn flat(value: Value) -> Flat { serde_json::from_value(value).unwrap() }

    #[test]
    fn compares_values_and_absence_in_key_order() {
        let local = flat(json!({"same":true,"changed":[1],"local":2}));
        assert_eq!(drift(&local, &local, &[]), Drift { keys: vec![], ignored: 0 });
        let remote = flat(json!({"same":true,"changed":[2],"remote":3}));
        assert_eq!(drift(&local, &remote, &[]).keys, vec![
            KeyDiff { key: "changed".into(), local: Some(json!([1])), remote: Some(json!([2])) },
            KeyDiff { key: "local".into(), local: Some(json!(2)), remote: None },
            KeyDiff { key: "remote".into(), local: None, remote: Some(json!(3)) },
        ]);
    }

    #[test]
    fn ignores_differing_keys_once_with_existing_globs() {
        let local = flat(json!({"harness.codex.home":"~/.codex","stack.path":"~/stack","same":1}));
        let remote = flat(json!({"harness.codex.home":"~/.other","stack.path":"~/other","same":1}));
        assert_eq!(drift(&local, &remote, &["harness.*.hom?".into(), "stack.*".into(), "*.path".into(), "same".into(), "missing".into()]), Drift { keys: vec![], ignored: 2 });
    }
}
