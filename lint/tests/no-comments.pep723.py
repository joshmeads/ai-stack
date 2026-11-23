# /// script
# requires-python = ">=3.11"
# dependencies = ["tomli-w"]
# ///
import tomli_w

# prose after the script block @hit
print(tomli_w.dumps({"ok": True}))
