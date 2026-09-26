import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { build, preview } from "vite";
import { chromium } from "playwright";
import type { WebDocument } from "@oeydesign/document";
import { buildWebSource } from "../src/web.ts";

const pixel = new Uint8Array(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jv2sAAAAASUVORK5CYII=", "base64"));

function browserFixture(): WebDocument {
  return {
    schemaVersion: 1, documentId: "browser-web", kind: "web", revision: 7, name: "Browser Demo",
    breakpoints: [{ id: "mobile", maxWidth: 600 }],
    assets: [{ id: "pixel", kind: "image", mimeType: "image/png", width: 1, height: 1 }],
    sourceModules: [{ id: "counter", path: "components/Counter.tsx", language: "tsx", exports: ["default"], source: `import {useState} from 'react';export default function Counter(){const [n,setN]=useState(0);return <button data-counter onClick={()=>setN(n+1)}>Count {n}</button>}` }],
    pages: [
      { id: "home", name: "Home", route: "/", rootId: "home-root" },
      { id: "about", name: "About", route: "/about", rootId: "about-root" },
    ],
    nodes: {
      "home-root": { id: "home-root", parentId: null, tag: "main", children: ["heading", "photo", "form", "counter", "link"], style: { width: 800 }, layout: { mode: "flex", flexDirection: "column", gap: 8 }, responsive: { mobile: { style: { width: 320 } } } },
      heading: { id: "heading", parentId: "home-root", tag: "h1", children: [], text: "中文 {brace} heading", style: {}, layout: { mode: "flow" } },
      photo: { id: "photo", parentId: "home-root", tag: "img", children: [], props: { assetId: "pixel", alt: "pixel image" }, style: { width: 24, height: 24 }, layout: { mode: "flow" } },
      form: { id: "form", parentId: "home-root", tag: "form", children: ["field", "submit"], style: {}, layout: { mode: "flow" } },
      field: { id: "field", parentId: "form", tag: "input", children: [], props: { name: "demo" }, style: {}, layout: { mode: "flow" } },
      submit: { id: "submit", parentId: "form", tag: "button", children: [], props: { type: "submit" }, text: "Submit demo", style: {}, layout: { mode: "flow" } },
      counter: { id: "counter", parentId: "home-root", tag: "div", children: [], component: { moduleId: "counter", exportName: "default" }, style: {}, layout: { mode: "flow" } },
      link: { id: "link", parentId: "home-root", tag: "a", children: [], props: { href: "/about" }, text: "About page", style: {}, layout: { mode: "flow" } },
      "about-root": { id: "about-root", parentId: null, tag: "main", children: ["about-heading"], style: {}, layout: { mode: "flow" } },
      "about-heading": { id: "about-heading", parentId: "about-root", tag: "h1", children: [], text: "About route", style: {}, layout: { mode: "flow" } },
    },
  };
}

test("built source project runs in Chrome with routes, assets, interactions and responsive layout", { timeout: 120_000 }, async t => {
  const root = await mkdtemp(join(resolve(".tmp"), "web-browser-"));
  let server: Awaited<ReturnType<typeof preview>> | undefined;
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  const browserErrors: string[] = [];
  const httpErrors: string[] = [];
  t.after(async () => {
    if (browser?.isConnected()) await browser.close();
    await server?.httpServer.close();
    await rm(root, { recursive: true, force: true });
  });

  const files = await buildWebSource(browserFixture(), async id => {
    assert.equal(id, "pixel");
    return pixel;
  });
  for (const [name, contents] of Object.entries(files)) {
    const target = join(root, name);
    await mkdir(join(target, ".."), { recursive: true });
    await writeFile(target, contents);
  }
  await build({ root, logLevel: "silent", build: { outDir: "dist", emptyOutDir: true } });
  server = await preview({ root, logLevel: "silent", preview: { host: "127.0.0.1", port: 0 } });
  const addr = server.httpServer.address();
  assert.ok(addr && typeof addr !== "string");
  browser = await chromium.launch({ channel: "chrome", headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on("pageerror", error => browserErrors.push(error.message));
  page.on("console", message => { if (message.type() === "error") browserErrors.push(`${message.location().url}: ${message.text()}`); });
  page.on("response", response => { if (response.status() >= 400) httpErrors.push(`${response.status()} ${response.url()}`); });
  await page.goto(`http://127.0.0.1:${addr.port}/`, { waitUntil: "networkidle" });
  assert.equal(await page.locator("h1").textContent(), "中文 {brace} heading");
  assert.equal(await page.locator("img").getAttribute("src"), "/assets/pixel");
  await page.locator("img").evaluate((image: HTMLImageElement) => image.decode());
  assert.equal(await page.locator("img").evaluate((image: HTMLImageElement) => image.naturalWidth), 1);
  await page.locator("form button[type=submit]").click();
  assert.equal(await page.locator("[data-oey-form-status]").isVisible(), true);
  await page.locator("[data-counter]").click();
  assert.equal(await page.locator("[data-counter]").textContent(), "Count 1");
  assert.equal(await page.locator("main").evaluate((node: HTMLElement) => getComputedStyle(node).width), "800px");
  assert.equal(await page.locator("main").evaluate((node: HTMLElement) => getComputedStyle(node).flexDirection), "column");

  await page.getByRole("link", { name: "About page" }).click();
  await page.waitForURL("**/about");
  await page.getByRole("heading", { name: "About route" }).waitFor();
  assert.equal(await page.locator("h1").textContent(), "About route");

  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto(`http://127.0.0.1:${addr.port}/`, { waitUntil: "networkidle" });
  assert.equal(await page.locator("main").evaluate((node: HTMLElement) => getComputedStyle(node).width), "320px");
  assert.deepEqual(browserErrors, [], `browser logged errors: ${browserErrors.join(" | ")}; HTTP errors: ${httpErrors.join(" | ")}`);
});
