mod owned;

use serde::{Deserialize, Serialize};

pub use owned::{Baseline, Owned};

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, clap::ValueEnum)]
#[serde(rename_all = "lowercase")]
pub enum Scope {
    #[default]
    Lines,
    Function,
    File,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Severity {
    Warning,
    Error,
}

impl Severity {
    pub fn as_str(self) -> &'static str {
        match self {
            Severity::Warning => "warning",
            Severity::Error => "error",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Level {
    Error,
    Warning,
    Off,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Finding {
    pub path: String,
    pub rule: String,
    pub severity: Severity,
    pub line: u32,
    pub column: u32,
    pub end_line: u32,
    pub message: String,
    pub snippet: String,
}

impl Finding {
    pub fn fingerprint(&self) -> String {
        format!("{}\u{0}{}\u{0}{}", self.rule, self.path, self.snippet.trim())
    }
}
