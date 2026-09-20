import { Fragment, Schema, Slice, type Node as PMNode } from "prosemirror-model";
import { ReplaceStep, Step } from "prosemirror-transform";
import type { JSONValue, PMNodeJSON } from "./model.ts";
import { KernelError } from "./errors.ts";

const nodes = {
  doc: { content: "block+" },
  paragraph: { content: "inline*", group: "block" },
  heading: { attrs: { level: { default: 1 } }, content: "inline*", group: "block" },
  blockquote: { content: "block+", group: "block" },
  bullet_list: { content: "list_item+", group: "block" },
  ordered_list: { attrs: { order: { default: 1 } }, content: "list_item+", group: "block" },
  list_item: { content: "paragraph block*" },
  hard_break: { inline: true, group: "inline" },
  text: { group: "inline" }
};
const marks = { strong: {}, em: {}, link: { attrs: { href: {} } } };
export const textSchema = new Schema({ nodes, marks });

export function textFromString(value: string): PMNodeJSON {
  const paragraphs = value.split(/\r?\n/).map((line) => ({ type: "paragraph", ...(line ? { content: [{ type: "text", text: line }] } : {}) }));
  return { type: "doc", content: paragraphs.length ? paragraphs : [{ type: "paragraph" }] };
}

export function textToString(value: PMNodeJSON | PMNode): string {
  const candidate = value as PMNode & { toJSON?: () => unknown };
  const json = typeof candidate.toJSON === "function" ? candidate.toJSON() as PMNodeJSON : value as PMNodeJSON;
  const walk = (node: PMNodeJSON): string => {
    if (node.type === "text") return node.text ?? "";
    const children = (node.content ?? []).map(walk);
    return node.type === "doc" ? children.join("\n") : node.type === "paragraph" || node.type === "heading" ? children.join("") : children.join("");
  };
  return walk(json);
}

export function createTextReplaceStep(from: number, to: number, text: string): Record<string, JSONValue> {
  const content = text ? Fragment.from(textSchema.text(text)) : Fragment.empty;
  return new ReplaceStep(from, to, new Slice(content, 0, 0)).toJSON() as Record<string, JSONValue>;
}

export function applyTextSteps(content: PMNodeJSON, steps: unknown[]): PMNodeJSON {
  try {
    let node = textSchema.nodeFromJSON(content);
    node.check();
    for (const raw of steps) {
      if (!raw || typeof raw !== "object") throw new Error("step must be an object");
      const step = Step.fromJSON(textSchema, raw as Record<string, unknown>);
      const result = step.apply(node);
      if (result.failed) throw new Error(result.failed);
      if (!result.doc) throw new Error("step produced no document");
      node = result.doc;
      node.check();
    }
    return node.toJSON() as PMNodeJSON;
  } catch (error) {
    throw new KernelError("invalid", `text.apply failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}
