use std::fs;
use std::sync::Arc;
use std::thread;

use super::*;

struct Choose(Option<String>);

impl Worker for Choose {
    fn decide(&self, _: &Value) -> Result<Decision, Code> {
        Ok(match &self.0 {
            Some(id) => Decision::Duplicate { incident_id: id.clone() },
            None => Decision::New {},
        })
    }
}

struct Unavailable;

impl Worker for Unavailable {
    fn decide(&self, _: &Value) -> Result<Decision, Code> { Err(Code::WorkerUnavailable) }
}

fn submission(id: &str) -> Submission {
    Submission {
        occurrence_id: id.into(), kind: Kind::DeliveredBug, problem: "missing-input-validation".into(),
        project_root: std::env::current_dir().unwrap(),
        summary: "Shipped CLI accepted an invalid endpoint.".into(), responsible_model: "gpt-6.1-sol".into(),
        harness: "Codex".into(), evidence: vec!["src/config.rs:42; reproduced a non-string endpoint being accepted".into()],
    }
}

#[test]
fn counts_replays_conflicts_and_order_preserve_every_occurrence() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("incidents.md");
    let first = submission("first");
    assert_eq!(record(&path, &first, &Choose(None)), Ok("recorded"));
    assert_eq!(record(&path, &submission("neighbor"), &Choose(None)), Ok("recorded"));
    let before = fs::read(&path).unwrap();
    assert_eq!(record(&path, &first, &Unavailable), Ok("already_recorded"));
    assert_eq!(fs::read(&path).unwrap(), before);
    let mut conflict = first.clone();
    conflict.summary = "Another incident".into();
    assert_eq!(record(&path, &conflict, &Choose(None)), Err(Code::IdentityConflict));
    assert_eq!(fs::read(&path).unwrap(), before);
    let path = Arc::new(path);
    let writers: Vec<_> = (0..8).map(|index| {
        let path = path.clone();
        thread::spawn(move || {
            let input = submission(&format!("occurrence-{index}"));
            let result = record(&path, &input, &Choose(Some("i-first".into())));
            assert!(matches!(result, Ok("recorded") | Err(Code::Busy)));
            (input, result)
        })
    }).collect();
    let results: Vec<_> = writers.into_iter().map(|writer| writer.join().unwrap()).collect();
    for (input, result) in results {
        if result == Err(Code::Busy) {
            assert_eq!(record(&path, &input, &Choose(Some("i-first".into()))), Ok("recorded"));
        }
        assert_eq!(record(&path, &input, &Unavailable), Ok("already_recorded"));
    }
    let (log, _) = store::Store::lock(&path).unwrap().load().unwrap();
    assert_eq!(log.entries.len(), 2);
    assert_eq!(log.entries[0].id, "i-first");
    assert_eq!(log.entries[0].occurrences.len(), 9);
    assert_eq!(log.entries[1].occurrences[0].submission.occurrence_id, "neighbor");
    let text = fs::read_to_string(&*path).unwrap();
    assert!(text.contains("Count: 9"));
    for index in 0..8 {
        assert!(log.entries[0].occurrences.iter().any(|o| o.submission.occurrence_id == format!("occurrence-{index}")));
    }
}

#[test]
fn failed_classification_invalid_targets_and_human_edits_do_not_write() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("incidents.md");
    assert_eq!(record(&path, &submission("first"), &Unavailable), Err(Code::WorkerUnavailable));
    assert!(!path.exists());
    record(&path, &submission("first"), &Choose(None)).unwrap();
    let before = fs::read(&path).unwrap();
    assert_eq!(record(&path, &submission("next"), &Choose(Some("missing".into()))), Err(Code::InvalidDecision));
    assert_eq!(fs::read(&path).unwrap(), before);
    let edited = fs::read_to_string(&path).unwrap().replace("Count: 1", "Count: 99");
    fs::write(&path, &edited).unwrap();
    assert_eq!(record(&path, &submission("next"), &Choose(None)), Err(Code::MalformedLog));
    assert_eq!(fs::read_to_string(&path).unwrap(), edited);
}

#[test]
fn untrusted_markdown_remains_data_and_unknown_fields_are_rejected() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("incidents.md");
    let mut input = submission("markup");
    input.summary = "</details> <!-- injected --> [link](javascript:alert)".into();
    record(&path, &input, &Choose(None)).unwrap();
    let (log, _) = store::Store::lock(&path).unwrap().load().unwrap();
    assert_eq!(log.entries[0].occurrences[0].submission, input);
    let mut value = serde_json::to_value(&input).unwrap();
    value["commit"] = json!("forged");
    assert!(serde_json::from_value::<Submission>(value).is_err());
    assert!(serde_json::from_str::<Decision>(r#"{"action":"new","old_history":"private"}"#).is_err());
    let link = dir.path().join("alias.md");
    std::os::unix::fs::symlink(&path, &link).unwrap();
    assert_eq!(record(&link, &submission("other"), &Choose(None)), Err(Code::UnsafeDestination));
    let fifo = dir.path().join("pipe.md");
    let name = std::ffi::CString::new(fifo.as_os_str().as_encoded_bytes()).unwrap();
    assert_eq!(unsafe { libc::mkfifo(name.as_ptr(), 0o600) }, 0);
    assert_eq!(record(&fifo, &submission("pipe"), &Choose(None)), Err(Code::UnsafeDestination));
}

#[test]
fn bounded_classifier_pages_scan_every_eligible_entry_and_bind_duplicate_ids() {
    struct Scan(std::cell::RefCell<Vec<Vec<String>>>);
    impl Worker for Scan {
        fn decide(&self, request: &Value) -> Result<Decision, Code> {
            assert!(serde_json::to_vec(request).unwrap().len() <= MAX_REQUEST);
            let ids: Vec<String> = request["existing"].as_array().unwrap().iter()
                .map(|item| item["id"].as_str().unwrap().into()).collect();
            let matched = ids.iter().any(|id| id == "i-299");
            self.0.borrow_mut().push(ids);
            Ok(if matched { Decision::Duplicate { incident_id: "i-299".into() } } else { Decision::New {} })
        }
    }
    let entries: Vec<Value> = (0..300).map(|index| json!({"id": format!("i-{index}"), "summary": "x".repeat(590)})).collect();
    let worker = Scan(std::cell::RefCell::new(Vec::new()));
    assert!(matches!(classify(&json!({"summary": "another occurrence"}), &entries, &worker), Ok(Decision::Duplicate { incident_id }) if incident_id == "i-299"));
    let pages = worker.0.borrow();
    assert!(pages.len() > 1);
    let seen: Vec<_> = pages.iter().flatten().cloned().collect();
    assert_eq!(seen, (0..300).map(|index| format!("i-{index}")).collect::<Vec<_>>());
    assert!(matches!(classify(&json!({}), &entries, &Choose(Some("i-299".into()))), Err(Code::InvalidDecision)));
}
