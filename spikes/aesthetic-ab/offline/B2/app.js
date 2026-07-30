const state = {
  version: 3,
  pending: 2,
  unread: 1,
  exported: false,
  marked: new Set(["hero-image", "spec-grid"]),
  flags: new Map(),
};

const thread = document.querySelector("#thread");
const composer = document.querySelector("#composer");
const prompt = document.querySelector("#prompt");
const pendingCount = document.querySelector("#pendingCount");
const markCountInline = document.querySelector("#markCountInline");
const marksList = document.querySelector("#marksList");
const toggleMarks = document.querySelector("#toggleMarks");
const exportBar = document.querySelector("#exportBar");
const exportBtn = document.querySelector("#exportBtn");
const confirmExport = document.querySelector("#confirmExport");
const exportCopy = document.querySelector("#exportCopy");
const artifact = document.querySelector("#artifact");

const objects = Array.from(artifact.querySelectorAll("[data-oey-object]"));

function now() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function syncCounts() {
  state.pending = state.marked.size;
  pendingCount.textContent = `${state.pending} PENDING MARKS`;
  markCountInline.textContent = String(state.pending);
  exportCopy.textContent = state.pending
    ? `${state.pending} 个批改标记未清。确认导出会把当前稿记为 PDF 交付物。`
    : `批改标记已清。确认导出会把 v${state.version} 记为 PDF 交付物。`;
  toggleMarks.innerHTML = `PENDING MARKS · <span id="markCountInline" class="accent">${state.pending}</span>`;
}

function addTurn(role, html, stamp) {
  const turn = document.createElement("section");
  turn.className = `turn ${role}`;
  turn.dataset.oeyObject = `turn-${role}-${Date.now()}`;
  const label = role === "user" ? "USER" : "AGENT";
  const kind = role === "user" ? "INSTRUCTION" : "DELIVERED";
  const stampHtml = stamp ? ` <span class="stamp ${stamp === `v${state.version}` ? "accent" : ""}">${stamp}</span>` : "";
  turn.innerHTML = `<div class="meta">${label} · ${now()} · ${kind}${stampHtml}</div><p>${html}</p>`;
  thread.appendChild(turn);
  thread.scrollTop = thread.scrollHeight;
}

function placeFlag(el, index) {
  removeFlag(el.dataset.oeyObject);
  const flag = document.createElement("span");
  flag.className = "flag";
  flag.textContent = `M${index}`;
  flag.style.top = "var(--s-8)";
  flag.style.right = "var(--s-8)";
  el.appendChild(flag);
  state.flags.set(el.dataset.oeyObject, flag);
}

function removeFlag(name) {
  const old = state.flags.get(name);
  if (old) old.remove();
  state.flags.delete(name);
}

function refreshObjectMarks() {
  let n = 1;
  objects.forEach((el) => {
    const name = el.dataset.oeyObject;
    if (state.marked.has(name)) {
      el.classList.add("is-marked");
      placeFlag(el, n);
      n += 1;
    } else {
      el.classList.remove("is-marked");
      removeFlag(name);
    }
  });
  document.querySelectorAll("[data-mark-row]").forEach((row) => {
    row.classList.toggle("is-done", !state.marked.has(row.dataset.markRow));
  });
  syncCounts();
}

function toggleMark(el) {
  const name = el.dataset.oeyObject;
  if (state.marked.has(name)) {
    state.marked.delete(name);
    addTurn("agent", `已移除 ${name} 上的红笔标记。pending marks 回到 ${state.marked.size}。`);
  } else {
    state.marked.add(name);
    state.unread = 0;
    addTurn("agent", `收到对象级批改：${name}。我把它记为 pending mark，导出会继续挂起，直到你 resolve 或确认。`);
  }
  refreshObjectMarks();
}

objects.forEach((el) => {
  el.addEventListener("click", () => toggleMark(el));
  el.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      toggleMark(el);
    }
  });
});

document.querySelectorAll("[data-resolve]").forEach((btn) => {
  btn.addEventListener("click", () => {
    const name = btn.dataset.resolve;
    state.marked.delete(name);
    refreshObjectMarks();
    addTurn("agent", `${name} 的批改已 resolve。红笔痕迹保留在版本记录里，但不再阻塞导出。`);
  });
});

toggleMarks.addEventListener("click", () => {
  const open = marksList.hidden;
  marksList.hidden = !open;
  toggleMarks.setAttribute("aria-expanded", String(open));
});

function respondTo(text) {
  const lower = text.toLowerCase();
  if (lower.includes("导出") || lower.includes("export")) {
    exportBar.hidden = false;
    return "导出入口已打开。右侧底部是确认条；朱红只在这一步出现，表示这是交付前最后一次人工确认。";
  }
  if (lower.includes("ppt") || lower.includes("幻灯")) {
    return "已记录 PPT 交付意图。当前画布仍是 Web v3；清完 pending marks 后我会把同一批文案重排成 16:9 页序，不新建第三栏。";
  }
  if (lower.includes("docx") || lower.includes("文档")) {
    return "DOCX 已排入交付队列：标题、参数、脚注会映射成样式表；当前先保持 Web 稿为唯一可批改画布。";
  }
  if (lower.includes("短") || lower.includes("标题")) {
    const h1 = artifact.querySelector("[data-oey-object='headline']");
    h1.innerHTML = "热风循环，<br />±1.5°C。";
    return "标题已压短。这个改动会先进入 v4 草稿；v3 保持可回看，避免你误把过程稿当成交付稿。";
  }
  if (lower.includes("圈") || lower.includes("mark")) {
    const target = artifact.querySelector("[data-oey-object='cta']");
    state.marked.add("cta");
    refreshObjectMarks();
    return target
      ? "我已替你圈住 CTA：文案确认前不导出。你可以继续点预览对象增删批改标记。"
      : "已记录批改请求，但没有找到可挂标记的对象。";
  }
  return "收到。按校对台规则处理：我先在对话里登记指令，右侧产物不立刻覆盖；涉及交付的改动会等 marks 清零后进入下一版。";
}

composer.addEventListener("submit", (event) => {
  event.preventDefault();
  const text = prompt.value.trim();
  if (!text) return;
  addTurn("user", text.replace(/</g, "&lt;"));
  prompt.value = "";
  state.unread = 1;
  window.setTimeout(() => {
    addTurn("agent", respondTo(text), `v${state.version}`);
    state.unread = 0;
  }, 420);
});

prompt.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    composer.requestSubmit();
  }
});

exportBtn.addEventListener("click", () => {
  exportBar.hidden = !exportBar.hidden;
  if (!exportBar.hidden) syncCounts();
});

confirmExport.addEventListener("click", () => {
  state.exported = true;
  exportBar.hidden = true;
  addTurn("agent", `已确认导出 v${state.version} / PDF。朱红确认动作已完成；若继续批改，将自动生成 v${state.version + 1}，不覆盖这次交付。`);
  state.version += 1;
  document.querySelector(".version").textContent = `v${state.version}`;
  document.querySelector(".version").setAttribute("aria-label", `当前版本 v${state.version}`);
  confirmExport.textContent = `CONFIRM EXPORT v${state.version}`;
  document.querySelector(".export-title").textContent = `EXPORT CHECK / v${state.version}`;
  syncCounts();
});

document.querySelectorAll("[data-action]").forEach((btn) => {
  btn.addEventListener("click", () => {
    const action = btn.dataset.action;
    if (action === "prev") addTurn("agent", "已对照 v2：标题更短、主图更黑；v3 仍是当前 proof。版本号保持骑缝章尺度，避免误读。");
    if (action === "next") addTurn("agent", "v4 未开放：还有 pending marks。清完红笔标记后，下一版才会进入预览。");
    if (action === "current") artifact.scrollIntoView({ block: "start", behavior: "smooth" });
  });
});

document.querySelectorAll("[data-version]").forEach((btn) => {
  btn.addEventListener("click", () => {
    if (btn.disabled) {
      addTurn("agent", "v4 被锁住：pending marks 未清。导出与开新版都必须经过人工确认。");
      return;
    }
    document.querySelectorAll("[data-version]").forEach((b) => b.removeAttribute("aria-current"));
    btn.setAttribute("aria-current", "true");
    addTurn("agent", `已切到 ${btn.dataset.version} 的交付记录。画布仍停留在 v3 proof，避免历史回看污染当前批改。`);
  });
});

refreshObjectMarks();
syncCounts();