# The Swift app drives the CLI through its JSON output

The TUI and a later Swift app share one backend, the Rust core. The TUI runs it in-process. The Swift app runs the `ai-stack` binary and reads each command's `--json` output, with long operations (fleet update, skills update) streaming JSON lines of progress. We chose this over compiling the core into the app with UniFFI, and over a local daemon with an HTTP API, so that the app, scripts and agents all use one tested contract and the app needs no Rust build step or background process.
