import { readFile, rename, unlink, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { basename, dirname, extname, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { Fragment, Slice } from "prosemirror-model";
import { ReplaceStep } from "prosemirror-transform";
import { textFromString, textSchema } from "@oeydesign/document";
import { exportDocumentArtifact, renderDeckSvg, renderWebHtml } from "@oeydesign/media";
import type { ArtifactFormat } from "@oeydesign/media";
import { ProjectAssets, ProjectRuntime } from "@oeydesign/runtime";
import { executeAgent } from './agent-cli.ts';

type AnyRecord = Record<string, any>;

const HELP = {
  name: "oey",
  usage: "oey <command> [options]",
  commands: {
    project: ["create <dir> [--name <name>]", "show <dir>"],
    agent: ["run <dir> --text <prompt> [--session <id>] [--document <id>] [--asset <id>]", "create|list|status|config <dir> [--session <id>] [--file <config.json>]", "send|steer|follow-up|answer|cancel --host <local-url> --session <id> [--text <text>] [--question <id>] [--wait]"],
    asset: ["import <dir> <file>", "list <dir>"],
    document: [
      "create <dir> [--kind deck|web] [--name <name>]",
      "read <dir> [documentId]",
      "apply <dir> <command.json>",
      "render <dir> <documentId> --output <file.svg|file.html> [--page <id>]",
      "export <dir> <documentId> --output <file.pptx|file.pdf|file.png|file.html|file.zip|file.source.zip> [--page <id>]",
    ],
    node: [
      "insert <dir> <documentId> --page <id> --kind text|shape --text <text> --x <n> --y <n> --width <n> --height <n> [--id <id>]",
      "move <dir> <documentId> <nodeId> --x <n> --y <n>",
      "text <dir> <documentId> <nodeId> --text <text>",
    ],
    undo: ["<dir> <documentId>"],
    redo: ["<dir> <documentId>"],
    events: ["<dir> [--after <seq>]"],
    version: [
      "create <dir> <documentId> --name <name>",
      "list <dir> <documentId>",
      "restore <dir> <versionId>",
    ],
  },
};

class CliError extends Error {
  readonly code: string;
  readonly details?: unknown;

  constructor(code: string, message: string, details?: unknown) {
    super(message);
    this.name = "CliError";
    this.code = code;
    this.details = details;
  }
}

function usage(message: string): never {
  throw new CliError("invalid_args", message);
}

function expectPositionals(actual: string[], expected: number, command: string) {
  if (actual.length !== expected) {
    usage(`${command} expects ${expected} positional argument${expected === 1 ? "" : "s"}`);
  }
}

function parseFlags(tokens: string[], allowed: readonly string[]) {
  const values: AnyRecord = {};
  const positional: string[] = [];
  const known = new Set(allowed);

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]!;
    if (!token.startsWith("--")) {
      positional.push(token);
      continue;
    }
    const flag = token.slice(2);
    if (!known.has(flag)) usage(`unknown option --${flag}`);
    const value = tokens[index + 1];
    if (value === undefined || value.startsWith("--")) usage(`option --${flag} requires a value`);
    values[flag] = value;
    index += 1;
  }

  return { values, positional };
}

function requiredFlag(flags: AnyRecord, name: string): string {
  const value = flags[name];
  if (typeof value !== "string" || value.length === 0) usage(`missing required option --${name}`);
  return value;
}

function optionalFlag(flags: AnyRecord, name: string): string | undefined {
  const value = flags[name];
  return typeof value === "string" ? value : undefined;
}

function numberFlag(flags: AnyRecord, name: string): number {
  const raw = requiredFlag(flags, name);
  const value = Number(raw);
  if (!Number.isFinite(value)) usage(`option --${name} must be a finite number`);
  return value;
}

function integerFlag(flags: AnyRecord, name: string): number {
  const value = numberFlag(flags, name);
  if (!Number.isInteger(value) || value < 0) usage(`option --${name} must be a non-negative integer`);
  return value;
}

function projectPath(dir: string) {
  if (!dir) usage("project directory is required");
  return resolve(dir);
}

function makeCommand(runtime: AnyRecord, documentId: string, operations: AnyRecord[], label: string) {
  return runtime.makeCommand(documentId, operations, { label, actorId: "cli", actorKind: "human", clientId: "cli" });
}

function submitOperations(runtime: AnyRecord, documentId: string, operations: AnyRecord[], label: string) {
  return runtime.submit(makeCommand(runtime, documentId, operations, label));
}

function withRuntime<T>(dir: string, action: (runtime: AnyRecord) => T): T {
  const runtime = ProjectRuntime.open(projectPath(dir)) as AnyRecord;
  try {
    return action(runtime);
  } finally {
    runtime.close();
  }
}

function withCreatedRuntime<T>(dir: string, name: string | undefined, action: (runtime: AnyRecord) => T): T {
  const runtime = ProjectRuntime.create(projectPath(dir), name === undefined ? {} : { name }) as AnyRecord;
  try {
    return action(runtime);
  } finally {
    runtime.close();
  }
}

async function readJsonFile(filename: string): Promise<AnyRecord> {
  let contents: string;
  try {
    contents = await readFile(resolve(filename), "utf8");
  } catch (error) {
    throw new CliError("io_error", `cannot read command file ${filename}`, { cause: String(error) });
  }
  try {
    return JSON.parse(contents) as AnyRecord;
  } catch (error) {
    throw new CliError("invalid_json", `command file ${filename} is not valid JSON`, { cause: String(error) });
  }
}

async function writeFileAtomically(output: string, data: Uint8Array): Promise<void> {
  const temporary = resolve(dirname(output), `.${basename(output)}.${process.pid}.${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, data, { flag: "wx" });
    await rename(temporary, output);
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
}

export async function execute(argv: string[]): Promise<unknown> {
  if (argv.length === 0 || argv.includes("--help") || argv.includes("-h") || argv[0] === "help") return HELP;

  const [area, action, ...rest] = argv;
  if (area === 'agent') return executeAgent(argv.slice(1));
  if (area === 'asset') {
    const { positional } = parseFlags(rest, []);
    expectPositionals(positional, action === 'import' ? 2 : 1, `asset ${action}`);
    const runtime = ProjectRuntime.open(positional[0]!);
    try {
      const assets = new ProjectAssets(runtime);
      if (action === 'list') return { assets: assets.list() };
      if (action !== 'import') usage('Unknown asset action');
      const file = positional[1]!;
      const bytes = await readFile(file);
      return { asset: /\.(png|jpe?g|webp)$/i.test(file) ? await assets.importImage(bytes, basename(file)) : await assets.importReference(bytes, basename(file)) };
    } finally { runtime.close(); }
  }
  if (area === "project" && action === "create") {
    const { values, positional } = parseFlags(rest, ["name"]);
    expectPositionals(positional, 1, "project create");
    return withCreatedRuntime(positional[0]!, optionalFlag(values, "name"), (runtime) => ({ project: runtime.project }));
  }

  if (area === "project" && action === "show") {
    const { positional } = parseFlags(rest, []);
    expectPositionals(positional, 1, "project show");
    return withRuntime(positional[0]!, (runtime) => ({ project: runtime.project, documents: runtime.listDocuments() }));
  }

  if (area === "document" && action === "create") {
    const { values, positional } = parseFlags(rest, ["name", "kind"]);
    expectPositionals(positional, 1, "document create");
    const kind = optionalFlag(values, "kind") ?? 'deck';
    if (kind !== 'deck' && kind !== 'web') usage('option --kind must be deck or web');
    return withRuntime(positional[0]!, (runtime) => ({ document: runtime.createDocument({ name: optionalFlag(values, 'name'), kind }) }));
  }

  if (area === "document" && action === "read") {
    const { positional } = parseFlags(rest, []);
    if (positional.length !== 1 && positional.length !== 2) usage("document read expects <dir> and optional <documentId>");
    return withRuntime(positional[0]!, (runtime) => {
      if (positional[1] === undefined) return { documents: runtime.listDocuments() };
      return { document: runtime.readDocument(positional[1]) };
    });
  }

  if (area === "document" && action === "apply") {
    const { positional } = parseFlags(rest, []);
    expectPositionals(positional, 2, "document apply");
    const payload = await readJsonFile(positional[1]!);
    const command = payload.command ?? payload;
    if (!command || typeof command !== "object" || typeof command.documentId !== "string" || !Array.isArray(command.operations)) {
      throw new CliError("invalid_command", "command JSON must contain documentId and operations");
    }
    return withRuntime(positional[0]!, (runtime) => ({ result: runtime.submit(command) }));
  }

  if (area === "document" && action === "render") {
    const { values, positional } = parseFlags(rest, ["output", "page"]);
    expectPositionals(positional, 2, "document render");
    const output = resolve(requiredFlag(values, "output"));
    const page = optionalFlag(values, "page");
    const runtime = ProjectRuntime.open(positional[0]!);
    try {
      const document = runtime.readDocument(positional[1]!);
      const format = document.kind === 'web' ? 'html' : 'svg';
      if (extname(output).toLowerCase() !== `.${format}`) usage(`this document renders as .${format}`);
      const resolver = new ProjectAssets(runtime).resolve;
      const content = document.kind === 'web' ? await renderWebHtml(document, page, resolver) : await renderDeckSvg(document, page, resolver);
      await writeFileAtomically(output, new TextEncoder().encode(content));
      return { documentId: document.documentId, revision: document.revision, format, output };
    } finally { runtime.close(); }
  }

  if (area === "document" && action === "export") {
    const { values, positional } = parseFlags(rest, ["output", "page"]);
    expectPositionals(positional, 2, "document export");
    const output = resolve(requiredFlag(values, "output"));
    const format = output.toLowerCase().endsWith('.source.zip') ? 'source.zip' : extname(output).toLowerCase().slice(1);
    if (!['pptx', 'pdf', 'png', 'html', 'zip', 'source.zip'].includes(format)) usage('option --output must have a .pptx, .pdf, .png, .html, .zip or .source.zip extension');
    const runtime = ProjectRuntime.open(positional[0]!);
    try {
      const document = runtime.readDocument(positional[1]!);
      const resolver = new ProjectAssets(runtime).resolve;
      const data = await exportDocumentArtifact(document, resolver, format as ArtifactFormat, { pageId: optionalFlag(values, 'page') });
      await writeFileAtomically(output, data);
      return { documentId: document.documentId, revision: document.revision, format, output };
    } finally { runtime.close(); }
  }

  if (area === "node" && action === "insert") {
    const { values, positional } = parseFlags(rest, ["page", "kind", "text", "x", "y", "width", "height", "id"]);
    expectPositionals(positional, 2, "node insert");
    const kind = requiredFlag(values, "kind");
    if (kind !== "text" && kind !== "shape") usage("option --kind must be text or shape");
    const text = requiredFlag(values, "text");
    const id = optionalFlag(values, "id") ?? randomUUID();
    const node = {
      id,
      kind,
      parentId: requiredFlag(values, "page"),
      geometry: {
        x: numberFlag(values, "x"),
        y: numberFlag(values, "y"),
        width: numberFlag(values, "width"),
        height: numberFlag(values, "height"),
        rotation: 0,
      },
      style: {},
      locked: false,
      hidden: false,
      ...(kind === "text" ? { content: textFromString(text) } : {}),
    };
    return withRuntime(positional[0]!, (runtime) => ({ result: submitOperations(runtime, positional[1]!, [{ type: "node.insert", node }], "Insert node"), node }));
  }

  if (area === "node" && action === "move") {
    const { values, positional } = parseFlags(rest, ["x", "y"]);
    expectPositionals(positional, 3, "node move");
    return withRuntime(positional[0]!, (runtime) => ({ result: submitOperations(runtime, positional[1]!, [{ type: "geometry.update", nodeId: positional[2], geometry: { x: numberFlag(values, "x"), y: numberFlag(values, "y") } }], "Move node") }));
  }

  if (area === "node" && action === "text") {
    const { values, positional } = parseFlags(rest, ["text"]);
    expectPositionals(positional, 3, "node text");
    const documentId = positional[1]!;
    const nodeId = positional[2]!;
    const text = requiredFlag(values, "text");
    return withRuntime(positional[0]!, (runtime) => {
      const document = runtime.readDocument(documentId);
      if (document.kind === 'web') {
        return { result: submitOperations(runtime, documentId, [{ type: 'web.node.update', nodeId, text }], 'Edit Web text') };
      }
      const node = document.nodes[nodeId];
      if (!node?.content) throw new CliError("invalid", `node ${nodeId} has no editable text content`);
      const current = textSchema.nodeFromJSON(node.content);
      const replacement = textSchema.nodeFromJSON(textFromString(text));
      const steps = [new ReplaceStep(0, current.content.size, new Slice(Fragment.from(replacement.content), 0, 0)).toJSON()];
      return { result: submitOperations(runtime, documentId, [{ type: "text.apply", nodeId, steps }], "Edit node text") };
    });
  }

  if (area === "undo" || area === "redo") {
    const { positional } = parseFlags([action!, ...rest], []);
    expectPositionals(positional, 2, area);
    return withRuntime(positional[0]!, (runtime) => ({ result: runtime[area](positional[1]) }));
  }

  if (area === "events") {
    const { values, positional } = parseFlags(rest, ["after"]);
    expectPositionals(positional, 1, "events");
    const after = optionalFlag(values, "after");
    if (after !== undefined && (!/^\d+$/.test(after))) usage("option --after must be a non-negative integer");
    return withRuntime(positional[0]!, (runtime) => ({ events: runtime.events(after === undefined ? undefined : Number(after)) }));
  }

  if (area === "version" && action === "create") {
    const { values, positional } = parseFlags(rest, ["name"]);
    expectPositionals(positional, 2, "version create");
    return withRuntime(positional[0]!, (runtime) => ({ version: runtime.createVersion(positional[1], requiredFlag(values, "name")) }));
  }

  if (area === "version" && action === "list") {
    const { positional } = parseFlags(rest, []);
    expectPositionals(positional, 2, "version list");
    return withRuntime(positional[0]!, (runtime) => ({ versions: runtime.listVersions(positional[1]) }));
  }

  if (area === "version" && action === "restore") {
    const { positional } = parseFlags(rest, []);
    expectPositionals(positional, 2, "version restore");
    return withRuntime(positional[0]!, (runtime) => ({ result: runtime.restoreVersion(positional[1]) }));
  }

  usage(`unknown command ${argv.slice(0, 2).join(" ")}`);
}

function jsonReplacer(_key: string, value: unknown) {
  return typeof value === "bigint" ? value.toString() : value;
}

export function writeJson(value: unknown) {
  process.stdout.write(`${JSON.stringify(value, jsonReplacer)}\n`);
}

export function writeError(error: unknown) {
  const details = (error as AnyRecord)?.details;
  const value = error instanceof CliError
    ? { code: error.code, message: error.message, ...(error.details === undefined ? {} : { details: error.details }) }
    : { code: (error as AnyRecord)?.code ?? "internal_error", message: error instanceof Error ? error.message : String(error), ...(details === undefined ? {} : { details }) };
  process.stderr.write(`${JSON.stringify({ error: value }, jsonReplacer)}\n`);
}

export async function main(argv = process.argv.slice(2)): Promise<number> {
  try {
    writeJson(await execute(argv));
    return 0;
  } catch (error) {
    writeError(error);
    return 1;
  }
}

const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(entry).href) {
  if (existsSync(resolve('.env'))) process.loadEnvFile(resolve('.env'));
  const exitCode = await main();
  if (exitCode !== 0) process.exitCode = exitCode;
}
