/* ============================================================
   OEYdesign · 校对台 — mock 交互
   版本巨号 / 信纸对话 / 红钉批注 / 导出，全部本地跑通
   ============================================================ */

/* ---------- 工具 ---------- */
const $ = (s) => document.querySelector(s);

function now() {
  const d = new Date();
  return String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
}

function pinHTML(num, id) {
  return `<button type="button" class="pin" data-oey-pin="${id}" data-pin-num="${num}">${num}</button>`;
}

/* ---------- 校样模板 ---------- */
function proofHTML(v) {
  const feats = v.singleFeat
    ? `<section class="p-feats single annot" data-oey-object="feature-grid">
         <div class="p-feat"><p>${v.feats[0].desc}</p></div>
       </section>`
    : `<section class="p-feats annot" data-oey-object="feature-grid">
         ${v.feats.map(f => `
           <div class="p-feat">
             <h3>${f.name}</h3>
             <p>${f.desc}</p>
           </div>`).join("")}
       </section>`;

  const tiers = v.tiers.map(t => `
    <div class="p-tier">
      <div class="p-tier-name">${t.name}</div>
      <div class="p-tier-price">${t.price}</div>
      <div class="p-tier-unit">${t.unit}</div>
      <p class="p-tier-desc">${t.desc}</p>
    </div>`).join("");

  const subLine = v.priceNote
    ? `<p class="p-sub annot" data-oey-object="price-sub">${v.pins.includes("price-sub") ? pinHTML(2, "price-sub") : ""}${v.priceNote}</p>`
    : "";

  return `
    <nav class="p-nav annot" data-oey-object="nav-links">
      ${v.pins.includes("nav-links") ? pinHTML(1, "nav-links") : ""}
      <span class="p-brand">野蕨咖啡 <span class="p-brand-en">YEWU COFFEE</span></span>
      <span class="p-links">产地&nbsp;&nbsp;&nbsp;豆单&nbsp;&nbsp;&nbsp;订阅&nbsp;&nbsp;&nbsp;门店</span>
    </nav>

    <section class="p-hero annot" data-oey-object="hero-title">
      ${v.pins.includes("hero-title") ? pinHTML(v.pins.includes("nav-links") ? 2 : 1, "hero-title") : ""}
      <div class="p-eyebrow">云南保山 · 产地直烘 · 单一庄园</div>
      <h2 class="p-hero-title">${v.hero}</h2>
      <p class="p-hero-sub">${v.sub}</p>
      <div class="p-cta"><a>查看本季豆单</a><a>了解订阅</a></div>
    </section>

    ${feats}

    <section class="p-pricing ${v.tiers.length === 3 ? "three" : ""} annot" data-oey-object="pricing">
      ${tiers}
      ${subLine}
    </section>

    <footer class="p-foot">
      <span>野蕨咖啡 © 2025 · 落地页校样</span>
      <span class="p-rev">${v.revision}</span>
    </footer>`;
}

/* ---------- 版本库 ---------- */
const FEATS_FULL = [
  { name: "产地", desc: "保山潞江坝，海拔 1,400m，铁皮卡与卡蒂姆混种，单一庄园直采。" },
  { name: "处理", desc: "日晒与水洗双批次分开烘焙，风味走向一浓一净。" },
  { name: "烘焙", desc: "下单后 48 小时内直烘，烘焙日期印在每一袋封口上。" },
];

const TIERS_THREE = [
  { name: "尝鲜", price: "¥45", unit: "/ 100G", desc: "单批次随机一支，适合先试风味。" },
  { name: "单品豆", price: "¥88", unit: "/ 250G", desc: "指定批次，日晒水洗任选。" },
  { name: "礼盒", price: "¥168", unit: "/ 2×250G", desc: "双批次组合，附产地明信片。" },
];

const TIERS_TWO = [
  { name: "单品豆", price: "¥88", unit: "/ 250G · 单次", desc: "指定批次，日晒水洗任选，下单后 48 小时内烘焙。" },
  { name: "订阅", price: "¥79", unit: "/ 月 · 250G", desc: "每月烘焙日自动发出，批次轮换，风味不重样。" },
];

const versions = [
  {
    n: 1,
    title: "野蕨咖啡 — 落地页草稿",
    status: "已归档 · 被 v2 取代",
    pins: ["nav-links"],
    resolved: new Set(["nav-links"]),
    hero: "云南产地直烘咖啡",
    sub: "铁皮卡与卡蒂姆，海拔 1,400 米，下单后 48 小时内烘焙。",
    feats: FEATS_FULL,
    singleFeat: false,
    tiers: TIERS_THREE,
    priceNote: "",
    revision: "v1 初稿 · 直陈方向",
  },
  {
    n: 2,
    title: "野蕨咖啡 — 落地页二校",
    status: "已归档 · 被 v3 取代",
    pins: ["hero-title"],
    resolved: new Set(["hero-title"]),
    hero: "从保山的山坡，到你的杯子",
    sub: "一座庄园、两种处理法、四十八小时烘焙窗口——产地信息收成一句话。",
    feats: [{ name: "", desc: "保山潞江坝单一庄园，日晒水洗双批次，下单后 48 小时内直烘，烘焙日期印在封口。" }],
    singleFeat: true,
    tiers: TIERS_THREE,
    priceNote: "",
    revision: "v2 修订：标题情绪化 · 三栏并一句",
  },
  {
    n: 3,
    title: "野蕨咖啡 — 品牌落地页",
    status: "校对中 · 等待你的批注",
    pins: ["hero-title", "price-sub"],
    resolved: new Set(),
    hero: "把山里的火，烘进一杯里。",
    sub: "保山潞江坝，海拔 1,400 米。你下单，我们才开火——48 小时内，从烘豆机到你的门。",
    feats: FEATS_FULL,
    singleFeat: false,
    tiers: TIERS_TWO,
    priceNote: "订阅可随时跳过或取消；跳过一次，烘焙日顺延一周，豆子不将就。",
    revision: "v3 修订：定价三档砍两档 · 加订阅说明",
  },
];

/* 后续生成用的首屏候选 */
const HERO_POOL = [
  "山火直烘，杯杯有出处。",
  "一杯有来历的咖啡。",
  "从山里的火，到手里的杯。",
  "先下单，后开火。",
];

/* ---------- 初始对话 ---------- */
const seedMessages = [
  {
    who: "user", time: "10:18", ref: "",
    body: "帮「野蕨咖啡」做一个落地页。云南保山产地直烘，目标客户是城市里的手冲爱好者。首屏要一句有劲的话，别喊口号。",
  },
  {
    who: "agent", time: "10:19", ref: "关联 v1",
    body: "已产出 v1。首屏用了直陈句「云南产地直烘咖啡」，配三栏产地信息，整体走编辑排版方向：衬线标题、大量留白、无装饰色。校样铺在右侧台面，你可以直接点红钉对单个对象下批注。",
  },
  {
    who: "user", time: "10:24", ref: "",
    body: "首屏标题太温了，像说明书。另外三栏信息太散，收成一栏一句话试试。",
  },
  {
    who: "agent", time: "10:26", ref: "关联 v2",
    body: "v2 已出：标题改为「从保山的山坡，到你的杯子」，三栏并成一句产地说明。你对 NAV-LINKS 的批注已处理，红钉转为已决。",
  },
  {
    who: "user", time: "10:31", ref: "",
    body: "价格区三档砍成两档，留单品豆和订阅，加一行订阅说明。这版感觉对了。",
  },
  {
    who: "agent", time: "10:33", ref: "关联 v3 · 当前",
    body: "v3 已完成，即当前校样：定价两档 + 订阅说明已落。首屏我再推了一步——「把山里的火，烘进一杯里。」。还剩两枚未决红钉（HERO-TITLE、PRICE-SUB），点红钉继续校。",
  },
];

const AGENT_REPLY_POOL = [
  (text, n, hero) => `收到——「${text}」已落到 v${n}：首屏标题改写为「${hero}」，版式骨架不动，红钉保留在原对象上。请在校样上继续批注。`,
  (text, n, hero) => `v${n} 已出。按你的意见「${text}」调整了首屏措辞（现为「${hero}」），其余区块维持 v${n - 1} 的网格。有不对的地方，直接点红钉。`,
  (text, n, hero) => `已按「${text}」生成 v${n}。这一版首屏换成「${hero}」，定价与订阅区不变。版本栈左侧可随时回退对比。`,
];

/* ---------- 状态 ---------- */
let currentIdx = 2;
let generating = false;
let selectedPin = null; // { id, objEl, pinEl }

/* ---------- 渲染：对话 ---------- */
function msgEl(m) {
  const div = document.createElement("div");
  div.className = "msg";
  div.dataset.who = m.who;
  div.innerHTML = `
    <div class="msg-name">${m.who === "user" ? "你" : "OEY · 设计代理"}</div>
    <div class="msg-body"></div>
    <div class="msg-meta">${m.time}${m.ref ? " · " + m.ref : ""}</div>`;
  div.querySelector(".msg-body").textContent = m.body;
  return div;
}

function appendMsg(m) {
  const thread = $("#thread");
  thread.appendChild(msgEl(m));
  thread.scrollTop = thread.scrollHeight;
}

/* ---------- 渲染：版本头 + 校样 ---------- */
function renderVersionTabs() {
  const nav = $("#versionTabs");
  nav.innerHTML = "";
  versions.forEach((v, i) => {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = "V" + v.n;
    if (i === currentIdx) b.classList.add("active");
    b.addEventListener("click", () => {
      if (generating) return;
      currentIdx = i;
      clearSelection();
      renderVersion();
    });
    nav.appendChild(b);
  });
}

function renderVersion() {
  const v = versions[currentIdx];
  $("#versionGiant").textContent = "v" + v.n;
  $("#proofTitle").textContent = v.title;
  $("#statusText").textContent = generating ? $("#statusText").textContent : v.status;
  $("#proof").innerHTML = proofHTML(v);

  // 已决红钉
  v.resolved.forEach((id) => {
    const pin = $("#proof").querySelector(`[data-oey-pin="${id}"]`);
    if (pin) {
      pin.classList.add("resolved");
      pin.textContent = "✓";
    }
  });

  renderVersionTabs();
}

/* ---------- 状态：生成中 ---------- */
function setGenerating(on, nextN) {
  generating = on;
  $("#breathDot").hidden = !on;
  $("#sendBtn").disabled = on;
  $("#statusText").textContent = on
    ? `正在生成 · OEY 在校对 v${nextN}`
    : versions[currentIdx].status;
}

/* ---------- 红钉批注 ---------- */
function clearSelection() {
  if (selectedPin) {
    selectedPin.objEl.classList.remove("selected");
    selectedPin = null;
  }
  $("#feedback").hidden = true;
}

$("#proof").addEventListener("click", (e) => {
  const pin = e.target.closest(".pin");
  if (!pin || pin.classList.contains("resolved")) return;
  clearSelection();
  const objEl = pin.closest("[data-oey-object]");
  objEl.classList.add("selected");
  selectedPin = { id: pin.dataset.oeyPin, objEl, pinEl: pin };
  $("#feedbackTarget").textContent = selectedPin.id.toUpperCase() + " · V" + versions[currentIdx].n;
  $("#feedback").hidden = false;
  $("#feedbackInput").value = "";
  $("#feedbackInput").focus();
});

function submitFeedback() {
  const text = $("#feedbackInput").value.trim();
  if (!text || !selectedPin) return;
  const v = versions[currentIdx];
  const target = selectedPin.id.toUpperCase();

  appendMsg({ who: "user", time: now(), ref: "批注 · " + target + " · v" + v.n, body: text });

  // 红钉转已决
  selectedPin.pinEl.classList.add("resolved");
  selectedPin.pinEl.textContent = "✓";
  v.resolved.add(selectedPin.id);
  clearSelection();

  setTimeout(() => {
    appendMsg({
      who: "agent",
      time: now(),
      ref: "关联 v" + v.n,
      body: `已记下对 ${target} 的批注：「${text}」。这条会并入下一版修订，校样上该红钉已转为已决。继续。`,
    });
  }, 700);
}

$("#feedbackSend").addEventListener("click", submitFeedback);
$("#feedbackInput").addEventListener("keydown", (e) => {
  if (e.key === "Enter") submitFeedback();
});

/* ---------- 导出 ---------- */
$("#exportBtn").addEventListener("click", () => {
  const f = $("#exportFormats");
  f.hidden = !f.hidden;
});

$("#exportFormats").addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-ext]");
  if (!btn) return;
  const v = versions[currentIdx];
  const line = `已导出 · yewu-landing-v${v.n}.${btn.dataset.ext} · ${now()}`;
  const log = $("#exportLog");
  log.textContent = log.textContent ? line + "\n" + log.textContent : line;
  $("#exportFormats").hidden = true;
});

/* ---------- 发消息 → 生成新版本 ---------- */
$("#composer").addEventListener("submit", (e) => {
  e.preventDefault();
  if (generating) return;
  const input = $("#composerInput");
  const text = input.value.trim();
  if (!text) return;
  input.value = "";

  appendMsg({ who: "user", time: now(), ref: "", body: text });

  const nextN = versions.length + 1;
  setGenerating(true, nextN);
  clearSelection();

  setTimeout(() => {
    const hero = HERO_POOL[(nextN - 4 + HERO_POOL.length) % HERO_POOL.length];
    const short = text.length > 24 ? text.slice(0, 24) + "…" : text;

    versions.push({
      n: nextN,
      title: "野蕨咖啡 — 品牌落地页",
      status: "校对中 · 等待你的批注",
      pins: ["hero-title", "price-sub"],
      resolved: new Set(),
      hero: hero,
      sub: "保山潞江坝，海拔 1,400 米。你下单，我们才开火——48 小时内，从烘豆机到你的门。",
      feats: FEATS_FULL,
      singleFeat: false,
      tiers: TIERS_TWO,
      priceNote: "订阅可随时跳过或取消；跳过一次，烘焙日顺延一周，豆子不将就。",
      revision: `v${nextN} 修订：${short}`,
    });

    currentIdx = versions.length - 1;
    setGenerating(false);
    renderVersion();

    const reply = AGENT_REPLY_POOL[(nextN - 4) % AGENT_REPLY_POOL.length](short, nextN, hero);
    appendMsg({ who: "agent", time: now(), ref: "关联 v" + nextN + " · 当前", body: reply });
  }, 1800);
});

$("#composerInput").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    $("#composer").requestSubmit();
  }
});

/* ---------- 启动 ---------- */
seedMessages.forEach(appendMsg);
renderVersion();