import { strict as assert } from "node:assert";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import test from "node:test";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const entry = resolve(root, "apps/cli/src/index.ts");
const nodeArgs = (...args: string[]) => ["--no-warnings", "--import", "tsx", entry, ...args];

test("CLI prints JSON help from a real child process", () => {
  const result = spawnSync(process.execPath, nodeArgs("--help"), {
    cwd: root,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.name, "oey");
  assert.ok(output.commands.project.includes("create <dir> [--name <name>]"));
  assert.equal(result.stderr, "");
});

test("CLI reports argument errors as JSON on stderr", () => {
  const result = spawnSync(process.execPath, nodeArgs("node", "move"), {
    cwd: root,
    encoding: "utf8",
  });
  assert.equal(result.status, 1);
  assert.equal(result.stdout, "");
  const error = JSON.parse(result.stderr);
  assert.equal(error.error.code, "invalid_args");
});

test("project create -> insert -> move -> text -> undo -> reopen", async () => {
  const dir = await mkdtemp(resolve(tmpdir(), "oey-cli-"));
  try {
    const run = (...args: string[]) => spawnSync(process.execPath, nodeArgs(...args), { cwd: root, encoding: "utf8" });
    const create = run("project", "create", dir, "--name", "CLI test");
    assert.equal(create.status, 0, create.stderr);
    assert.equal(JSON.parse(create.stdout).project.name, "CLI test");

    const createdDocument = run("document", "create", dir, "--name", "CLI deck");
    assert.equal(createdDocument.status, 0, createdDocument.stderr);
    const document = JSON.parse(createdDocument.stdout).document;
    const documentId = document.documentId;
    const pageId = document.pages[0].id;

    const inserted = run("node", "insert", dir, documentId, "--page", pageId, "--kind", "text", "--text", "Hello", "--x", "10", "--y", "20", "--width", "200", "--height", "40", "--id", "title");
    assert.equal(inserted.status, 0, inserted.stderr);
    assert.equal(JSON.parse(inserted.stdout).node.id, "title");

    const moved = run("node", "move", dir, documentId, "title", "--x", "30", "--y", "40");
    assert.equal(moved.status, 0, moved.stderr);

    const versionCreated = run("version", "create", dir, documentId, "--name", "Moved title");
    assert.equal(versionCreated.status, 0, versionCreated.stderr);
    const version = JSON.parse(versionCreated.stdout).version;
    const versionList = run("version", "list", dir, documentId);
    assert.equal(versionList.status, 0, versionList.stderr);
    assert.equal(JSON.parse(versionList.stdout).versions[0].versionId, version.versionId);

    const preview = resolve(dir, "preview.svg");
    const rendered = run("document", "render", dir, documentId, "--output", preview);
    assert.equal(rendered.status, 0, rendered.stderr);
    assert.equal(JSON.parse(rendered.stdout).format, "svg");
    assert.match(await readFile(preview, "utf8"), /data-document-id/);

    const edited = run("node", "text", dir, documentId, "title", "--text", "第一段\n第二段中文");
    assert.equal(edited.status, 0, edited.stderr);

    const afterEdit = run("document", "read", dir, documentId);
    assert.equal(afterEdit.status, 0, afterEdit.stderr);
    const editedContent = JSON.parse(afterEdit.stdout).document.nodes.title.content;
    assert.deepEqual(editedContent.content.map((paragraph: { content?: Array<{ text?: string }> }) => paragraph.content?.[0]?.text ?? ""), ["第一段", "第二段中文"]);

    const undone = run("undo", dir, documentId);
    assert.equal(undone.status, 0, undone.stderr);
    const restored = run("version", "restore", dir, version.versionId);
    assert.equal(restored.status, 0, restored.stderr);

    const reopened = run("document", "read", dir, documentId);
    assert.equal(reopened.status, 0, reopened.stderr);
    const reopenedDocument = JSON.parse(reopened.stdout).document;
    assert.equal(reopenedDocument.nodes.title.geometry.x, 30);
    assert.equal(reopenedDocument.nodes.title.geometry.y, 40);
    assert.equal(reopenedDocument.nodes.title.content.content[0].content[0].text, "Hello");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
