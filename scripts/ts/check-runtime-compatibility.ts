/**
 * R1 host compatibility probes. The Node and Konva checks are local and
 * deterministic. Electron is probed only when ELECTRON_BIN is supplied.
 *
 *   npx tsx scripts/ts/check-runtime-compatibility.ts
 *   $env:ELECTRON_BIN='...\\electron.exe'; npx tsx scripts/ts/check-runtime-compatibility.ts
 */

import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

type ProbeResult = Record<string, unknown>;

async function checkNodeSqlite(): Promise<ProbeResult> {
  try {
    const sqlite = await import("node:sqlite");
    const db = new sqlite.DatabaseSync(":memory:");
    db.exec("CREATE TABLE probe (value TEXT NOT NULL)");
    db.prepare("INSERT INTO probe (value) VALUES (?)").run("node-r1");
    const row = db.prepare("SELECT value FROM probe").get() as { value?: string };
    db.close();
    return { status: row.value === "node-r1" ? "pass" : "fail", module: "node:sqlite" };
  } catch (error) {
    return {
      status: "unavailable",
      module: "node:sqlite",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function checkKonvaNormalize(): Promise<ProbeResult> {
  try {
    const { Transform } = await import("konva/lib/Util.js");
    const transform = new Transform();
    transform.translate(20, 30);
    transform.rotate(Math.PI / 2);
    const local = { x: 3, y: 4 };
    const absolute = transform.point(local);
    const normalized = transform.copy().invert().point(absolute);
    const error = Math.hypot(normalized.x - local.x, normalized.y - local.y);
    return {
      status: error < 1e-9 ? "pass" : "fail",
      local,
      absolute,
      normalized,
      maxError: error,
    };
  } catch (error) {
    return {
      status: "unavailable",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function checkElectronSqlite(): ProbeResult {
  const electron = process.env.ELECTRON_BIN;
  if (!electron) return { status: "not-run", reason: "set ELECTRON_BIN to the Electron executable" };

  // ELECTRON_RUN_AS_NODE makes Electron use its bundled Node CLI. The probe
  // is intentionally inline so this check leaves no generated source file.
  const probe = [
    "try {",
    "const { DatabaseSync } = require('node:sqlite');",
    "const db = new DatabaseSync(':memory:');",
    "db.exec(\"CREATE TABLE probe (value TEXT)\");",
    "db.prepare(\"INSERT INTO probe VALUES (?)\").run('electron-r1');",
    "const row = db.prepare(\"SELECT value FROM probe\").get();",
    "db.close();",
    "console.log(JSON.stringify({ status: row.value === 'electron-r1' ? 'pass' : 'fail', node: process.versions.node }));",
    "} catch (error) {",
    "console.log(JSON.stringify({ status: 'unavailable', node: process.versions.node, error: String(error && error.message || error) }));",
    "process.exitCode = 2;",
    "}",
  ].join("\n");

  try {
    const stdout = execFileSync(electron, ["-e", probe], {
      encoding: "utf8",
      windowsHide: true,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
      timeout: 30_000,
    });
    const line = stdout.trim().split(/\r?\n/).filter(Boolean).pop();
    return line ? JSON.parse(line) as ProbeResult : {
      status: "unavailable",
      error: "Electron produced no JSON result",
    };
  } catch (error) {
    return { status: "unavailable", error: error instanceof Error ? error.message : String(error) };
  }
}

async function checkElectronUtilityProcess(): Promise<ProbeResult> {
  const electron = process.env.ELECTRON_BIN;
  if (!electron) return { status: "not-run", reason: "set ELECTRON_BIN to the Electron executable" };

  const directory = await mkdtemp(join(tmpdir(), "oey-r1-electron-utility-"));
  const marker = "OEY_R1_UTILITY_RESULT=";
  const worker = `
try {
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE probe (value TEXT NOT NULL)');
  db.prepare('INSERT INTO probe VALUES (?)').run('electron-utility-r1');
  const value = db.prepare('SELECT value FROM probe').get().value;
  db.close();
  process.parentPort.postMessage({ status: value === 'electron-utility-r1' ? 'pass' : 'fail', node: process.versions.node, sqlite: process.versions.sqlite });
} catch (error) {
  process.parentPort.postMessage({ status: 'unavailable', node: process.versions.node, error: String(error && error.message || error) });
}
`;
  const main = `
const path = require('node:path');
const { app, utilityProcess } = require('electron');

app.whenReady().then(() => {
  const child = utilityProcess.fork(path.join(__dirname, 'worker.cjs'), [], { serviceName: 'OEY R1 SQLite probe' });
  let finished = false;
  const finish = (result, code) => {
    if (finished) return;
    finished = true;
    clearTimeout(timeout);
    console.log(${JSON.stringify(marker)} + JSON.stringify(result));
    child.kill();
    app.exit(code);
  };
  const timeout = setTimeout(() => finish({ status: 'timeout', node: process.versions.node }, 2), 20000);
  child.on('message', (message) => finish(message, message.status === 'pass' ? 0 : 1));
  child.on('exit', (code) => {
    if (!finished) finish({ status: 'utility-exit', node: process.versions.node, code }, 1);
  });
}).catch((error) => {
  console.log(${JSON.stringify(marker)} + JSON.stringify({ status: 'unavailable', error: String(error && error.message || error) }));
  app.exit(1);
});
`;

  try {
    await writeFile(join(directory, "package.json"), JSON.stringify({ name: "oey-r1-electron-probe", main: "main.cjs" }));
    await writeFile(join(directory, "main.cjs"), main);
    await writeFile(join(directory, "worker.cjs"), worker);
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    const stdout = execFileSync(electron, ["--no-sandbox", "--disable-gpu", directory], {
      encoding: "utf8",
      windowsHide: true,
      timeout: 60_000,
      env,
    });
    const line = stdout.trim().split(/\r?\n/).find((item) => item.startsWith(marker));
    return line ? JSON.parse(line.slice(marker.length)) as ProbeResult : {
      status: "unavailable",
      error: "Electron utility process produced no result marker",
    };
  } catch (error) {
    return { status: "unavailable", error: error instanceof Error ? error.message : String(error) };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function main(): Promise<void> {
  const sqlite = await checkNodeSqlite();
  const electronSqlite = checkElectronSqlite();
  const electronUtilityProcess = await checkElectronUtilityProcess();
  const konvaNormalize = await checkKonvaNormalize();
  console.log(JSON.stringify({
    node: process.versions,
    sqlite,
    electronSqlite,
    electronUtilityProcess,
    konvaNormalize,
  }, null, 2));

  const required = [sqlite, konvaNormalize];
  if (required.some((result) => result.status !== "pass")) {
    process.exitCode = 1;
  }
  if (electronSqlite.status !== "pass" && electronSqlite.status !== "not-run") {
    process.exitCode = 1;
  }
  if (electronUtilityProcess.status !== "pass" && electronUtilityProcess.status !== "not-run") {
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
