# Setup and model configuration

## Sub-features

Installed setup invocation, harness-to-provider mapping, generated routing/model preferences, unavailable-provider handling, and changed configuration references.

## How to get to it (user POV)

Invoke `/pstack:setup-pstack` in the isolated Claude session, or `$setup-pstack` in the isolated Codex session. The installed instructions are the authority for the setup inputs.

## Driving it with verify-open-pstack

Use only the run-owned fixture workspace and isolated harness home. Exercise each changed setup branch with explicit requested model/provider inputs. Retain the native invocation transcript and generated configuration file (redacted), then invoke a consuming installed skill and observe it use the configured route. Check that all paths written remain in run-owned state. Record requested versus observed provider/model and changed failure branches. Capture separate local CLI output only as supplemental evidence.

## Gotchas

Do not copy a daily configuration to make setup pass. Stop if required provider authentication is unavailable. Generated configuration by itself does not prove the consuming surface. Credentials stay outside repository-controlled scripts; authenticate the isolated harness explicitly and redact secrets before selecting artifacts.
