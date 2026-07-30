const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const chatScroll = $('#chatScroll');
const composer = $('#composer');
const prompt = $('#prompt');
const sendBtn = $('#sendBtn');
const roundCount = $('#roundCount');
const topStatus = $('#topStatus');
const artifactStatus = $('#artifactStatus');
const saveTime = $('#saveTime');
const toast = $('#toast');
const lighttable = $('#lighttable');
const inspectorToggle = $('#inspectorToggle');

let rounds = 7;
let editIndex = 0;
let toastTimer;

const variants = [
  {
    version: 'v1.0.0',
    title: '把山谷里的第一杯热咖啡带到城市',
    subtitle: '北屿秋季豆单上线，果香、坚果与黑糖层次完整保留。',
    cta: '立即购买',
    note: '限时首发 · 买二赠一',
    price1: '¥138', price2: '¥146', price3: '¥118'
  },
  {
    version: 'v1.1.0',
    title: '城市边缘，热咖啡先到。',
    subtitle: '浅烘果香压低半度，留出烤坚果与黑糖的尾声。',
    cta: '查看豆单',
    note: '9 月 18 日起发货',
    price1: '¥128', price2: '¥136', price3: '¥108'
  },
  {
    version: 'v1.2.0',
    title: '城市边缘，热咖啡先到。',
    subtitle: '北屿把浅烘果香压低半度，留出烤坚果与黑糖的尾声。',
    cta: '查看秋季豆单',
    note: '48 小时内烘焙',
    price1: '¥118', price2: '¥126', price3: '¥98'
  },
  {
    version: 'v1.3.2',
    title: '城市边缘，热咖啡先到。',
    subtitle: '北屿把浅烘果香压低半度，留出烤坚果与黑糖的尾声。适合清晨通勤，也适合雨后慢慢喝完。',
    cta: '查看秋季豆单',
    note: '9 月 18 日起发货 · 48 小时内烘焙',
    price1: '¥118', price2: '¥126', price3: '¥98'
  }
];

const mockEdits = [
  {
    intent: '压缩首屏信息',
    summary: '已把 obj-hero-subtitle 再缩短 12 字，首屏按钮区上移 8px；obj-hero-title 仍保持两行锁定。',
    changes: ['副标题 -12 字', '按钮区 +8px', '标题仍两行'],
    apply() { setBind('subtitle', '北屿把浅烘果香压低半度，留出烤坚果与黑糖尾声。'); }
  },
  {
    intent: '收窄产品卡节奏',
    summary: '已把三支产品卡间距从 16px 收到 12px，价格行统一基线；obj-card-price-* 不改字号，避免菜单感丢失。',
    changes: ['卡片间距 16 → 12', '价格基线统一', '字号保留'],
    apply() { $$('.p-cards').forEach(el => { el.style.gap = '12px'; }); }
  },
  {
    intent: '强化交付边界',
    summary: '已复核 1440×900 画板：白页四周留白一致，页脚订阅框不越界；导出 Web/PPT/DOCX 使用同一裁切线。',
    changes: ['四周留白一致', '订阅框不越界', '三端同裁切'],
    apply() { setBind('note', '9 月 18 日起发货 · 三端同版导出'); }
  },
  {
    intent: '通用修改',
    summary: '已按这条意见重排相关对象，并同步更新版本时间戳；具体锚点已写入检查器，可在右侧逐项定位。',
    changes: ['对象已重排', '检查器已同步', '版本已记录'],
    apply() { setBind('cta', '查看秋季豆单'); }
  }
];

function now() {
  const d = new Date();
  return [d.getHours(), d.getMinutes(), d.getSeconds()].map(n => String(n).padStart(2, '0')).join(':');
}

function setBind(key, value) {
  const node = $(`[data-bind="${key}"]`);
  if (node) node.textContent = value;
}

function applyVariant(index) {
  const v = variants[index] || variants[variants.length - 1];
  setBind('title', v.title);
  setBind('subtitle', v.subtitle);
  setBind('cta', v.cta);
  setBind('note', v.note);
  setBind('price1', v.price1);
  setBind('price2', v.price2);
  setBind('price3', v.price3);
  artifactStatus.textContent = index === variants.length - 1 ? '可交付校样' : '历史版本';
  topStatus.textContent = index === variants.length - 1 ? '校样中' : '查看历史';
  $$('.version-chip').forEach(chip => {
    const active = Number(chip.dataset.version) === index;
    chip.classList.toggle('is-active', active);
    chip.setAttribute('aria-selected', active ? 'true' : 'false');
  });
}

function addMessage(role, text, changes = []) {
  const article = document.createElement('article');
  article.className = `msg ${role}`;

  const meta = document.createElement('div');
  meta.className = 'msg-meta';
  const who = document.createElement('span');
  who.className = 'who';
  who.textContent = role === 'user' ? '林乔' : 'OEY';
  const time = document.createElement('span');
  time.className = 'mono time';
  time.textContent = now();
  meta.append(who, time);

  const p = document.createElement('p');
  p.className = 'msg-text';
  p.textContent = text;

  article.append(meta, p);

  if (changes.length) {
    const list = document.createElement('div');
    list.className = 'change-list';
    changes.forEach(change => {
      const chip = document.createElement('span');
      chip.textContent = change;
      list.appendChild(chip);
    });
    article.appendChild(list);
  }

  chatScroll.appendChild(article);
  chatScroll.scrollTop = chatScroll.scrollHeight;
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 2200);
}

function setWorking(isWorking) {
  sendBtn.disabled = isWorking;
  topStatus.textContent = isWorking ? '生成中' : '校样中';
  artifactStatus.textContent = isWorking ? '正在落版' : '可交付校样';
  saveTime.textContent = now();
}

composer.addEventListener('submit', event => {
  event.preventDefault();
  const text = prompt.value.trim();
  if (!text) {
    showToast('先写一条具体修改意见，再发送生成。');
    prompt.focus();
    return;
  }

  rounds += 1;
  roundCount.textContent = String(rounds);
  addMessage('user', text);
  prompt.value = '';
  setWorking(true);

  const edit = mockEdits[Math.min(editIndex, mockEdits.length - 1)];
  editIndex += 1;

  setTimeout(() => {
    edit.apply();
    addMessage('agent', `${edit.summary} 本轮意图：${edit.intent}。`, edit.changes);
    setWorking(false);
    showToast('新版本已落到右侧白页，检查器可逐对象核对。');
  }, 720);
});

prompt.addEventListener('keydown', event => {
  if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
    composer.requestSubmit();
  }
});

$$('.version-chip').forEach(chip => {
  chip.addEventListener('click', () => {
    applyVariant(Number(chip.dataset.version));
    showToast(`已切换到 ${chip.textContent}，白页内容随版本回滚。`);
  });
});

$$('[data-export]').forEach(button => {
  button.addEventListener('click', () => {
    const kind = button.dataset.export;
    const size = kind === 'web' ? '1.8 MB' : kind === 'ppt' ? '6.4 MB' : '812 KB';
    showToast(`已生成 ${button.textContent.replace('导出 ', '')} 导出包（${size}），使用 1440×900 裁切线。`);
  });
});

inspectorToggle.addEventListener('click', () => {
  const open = lighttable.classList.toggle('inspector-open');
  inspectorToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
});

$$('.object-row').forEach(row => {
  row.addEventListener('click', () => {
    const id = row.dataset.target;
    const target = $(`[data-oey-object="${id}"]`);
    if (!target) return;
    $$('.artifact-page .is-focused').forEach(el => el.classList.remove('is-focused'));
    target.classList.add('is-focused');
    target.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
    showToast(`${id} 已在白页内高亮。`);
    setTimeout(() => target.classList.remove('is-focused'), 1600);
  });
});

applyVariant(3);
saveTime.textContent = now();
chatScroll.scrollTop = chatScroll.scrollHeight;