// What `cdt next build` lets Next change in the project, and how cdt undoes
// it. Shared by the preloaded hook (which records) and cdt (which restores).
//
// Next rewrites two files it manages, tsconfig (or typescript.tsconfigPath)
// and next-env.d.ts, to point at the build's distDir. For each, the hook
// records the bytes before the build (at Next's first loadConfig, before any
// write) and the exact bytes Next wrote. cdt restores a file only when it
// still holds exactly what Next wrote, so an edit made after Next's write is
// never overwritten. Records live in a directory per project under the temp
// dir and are written as the build runs, so a cdt that was killed mid-build
// can be finished by the next run.

const { createHash } = require("node:crypto");
const fs = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");

const MARK = "cdt-profile";

const key = (s) => createHash("sha256").update(s).digest("hex").slice(0, 16);
const readOrNull = (f) => { try { return fs.readFileSync(f); } catch (e) { if (e.code === "ENOENT") return null; throw e; } };
const same = (a, b) => (a === null || b === null ? a === b : a.equals(b));
const enc = (buf) => (buf === null ? null : buf.toString("base64"));
const dec = (s) => (s === null ? null : Buffer.from(s, "base64"));
const readJson = (f) => JSON.parse(fs.readFileSync(f, "utf8"));

// projectDir must be a real path.
const guardDir = (projectDir) => join(tmpdir(), "cdt-next-guard", key(projectDir));

// First caller wins: the state before any build write.
function recordBefore(dir, file, bytes) {
  try {
    fs.writeFileSync(join(dir, `before-${key(file)}.json`), JSON.stringify({ file, before: enc(bytes) }), { flag: "wx" });
    return true;
  } catch (e) {
    if (e.code === "EEXIST") return false;
    throw e;
  }
}

const hasBefore = (dir, file) => fs.existsSync(join(dir, `before-${key(file)}.json`));

// Last write wins; rename so a reader never sees half a record.
function recordWrite(dir, file, bytes) {
  const f = join(dir, `written-${key(file)}.json`);
  fs.writeFileSync(`${f}.${process.pid}.tmp`, JSON.stringify({ file, written: enc(bytes) }));
  fs.renameSync(`${f}.${process.pid}.tmp`, f);
}

function managedFiles(dir) {
  let names;
  try { names = fs.readdirSync(dir); } catch { return new Set(); }
  return new Set(names.filter((n) => n.startsWith("before-")).map((n) => readJson(join(dir, n)).file));
}

function records(dir) {
  const out = [];
  for (const n of fs.readdirSync(dir)) {
    if (!n.startsWith("before-") || !n.endsWith(".json")) continue;
    const { file, before } = readJson(join(dir, n));
    const w = join(dir, `written-${n.slice("before-".length)}`);
    out.push({ file, before: dec(before), written: fs.existsSync(w) ? dec(readJson(w).written) : undefined });
  }
  return out;
}

const alive = (pid) => {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === "EPERM"; }
};

// The run that owns dir, if one of its processes is still going.
function liveRun(dir) {
  let run;
  try { run = readJson(join(dir, "run.json")); } catch { return null; }
  const pid = [run.childPid, run.cdtPid].find(alive);
  return pid ? { pid, run } : null;
}

function startRun(dir, run) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(join(dir, "run.json"), JSON.stringify(run));
}

// Undo Next's writes where the file still holds exactly them; report the
// rest. Removes the records when done.
function settle(dir) {
  const report = { restored: [], removed: [], left: [] };
  for (const r of records(dir)) {
    const now = readOrNull(r.file);
    if (same(now, r.before)) continue;
    if (r.written === undefined) {
      report.left.push({ file: r.file, why: "changed during the build, but not by a Next write cdt saw" });
    } else if (same(now, r.written)) {
      if (r.before === null) { fs.unlinkSync(r.file); report.removed.push(r.file); }
      else { fs.writeFileSync(r.file, r.before); report.restored.push(r.file); }
    } else {
      const still = now?.includes(MARK) ? `; it still mentions ${MARK}, so remove those entries by hand` : "";
      report.left.push({ file: r.file, why: `changed again after Next wrote it, so cdt left it as is${still}` });
    }
  }
  fs.rmSync(dir, { recursive: true, force: true });
  return report;
}

module.exports = { MARK, guardDir, recordBefore, hasBefore, recordWrite, managedFiles, liveRun, startRun, settle, readOrNull };
