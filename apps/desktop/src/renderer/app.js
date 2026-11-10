// 界面入口：两级导航、聊天、3D 画布的调度。各板块的内容在 views/ 里。

import { createBrain } from './brain.js';
import { createWhale } from './whale3d.js';
import { NAV, DEFAULT_ROUTE, parseRoute, routes } from './nav-data.mjs';
import { $, esc, fmtTime, fmtClock } from './util.js';
import * as overview from './views/overview.js';
import * as mind from './views/mind.js';
import * as us from './views/us.js';
import * as neuro from './views/neuro.js';
import * as metabolism from './views/metabolism.js';
import * as immunity from './views/immunity.js';
import * as explore from './views/explore.js';
import * as settings from './views/settings.js';

const VIEWS = { overview, mind, us, neuro, metabolism, immunity, explore, settings };
const ROUTE_KEY = 'dfy.route';

const fish = window.fish;
const S = {
  name: '小鲸鱼',
  settings: {},
  vitals: null,
  history: [],
  memory: { records: [], stats: {}, conflicts: [], layers: [], layerNames: {}, sourceNames: {} },
  us: null,
  profile: null,
  diary: [],
  meta: { regions: [], transmitters: [], drives: [], layers: [], layerNames: {}, sourceNames: {}, big5: [] },
  streaming: null, // { id, el, text }
  backups: null,
};

function toast(text) {
  const t = $('#toast');
  t.textContent = text;
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (t.hidden = true), 4000);
}

// ---------- 3D 画布：只创建一次，在需要它的 Tab 之间移动 ----------
const glPark = $('#glPark');
const stage3d = $('#stage3d');
const canvas = $('#brainCanvas');
const whaleCanvas = $('#whaleCanvas');
let brain = null, brainLoading = null, stageMode = null, labelsOn = false, whale = null;

const KIND = { semantic: '语义记忆', episodic: '情景记忆', reflection: '反思', procedural: '程序记忆', self: '自我叙事', diary: '日记' };

function pushMemories() {
  if (!brain) return;
  const items = (S.memory.records || [])
    .filter((r) => !r.archived)
    .sort((a, b) => b.importance - a.importance || b.at - a.at)
    .slice(0, 140)
    .map((r) => ({ id: r.id, kind: r.layer, text: r.text, at: r.at, importance: r.importance, entities: r.entities, links: r.links }));
  brain.setMemories(items);
}

function onHover(hit) {
  const tip = $('#brainTip');
  if (!hit) return (tip.hidden = true);
  if (hit.type === 'entity') {
    tip.innerHTML = `<b>${esc(hit.label)}</b><small>${esc(hit.detail)}</small>`;
  } else if (hit.type === 'region') {
    const r = S.meta.regions.find((x) => x.id === hit.id);
    const g = S.meta.regionGroups?.[r?.group];
    const act = S.vitals?.body.regions[hit.id] ?? 0;
    tip.innerHTML = `<b style="color:${g?.color || '#9fe8ff'}">${esc(r?.name || hit.id)}</b> · ${esc(g?.name || '')}<small>${esc(r?.desc || r?.role || '')}</small><small>激活 ${Math.round(act * 100)}%</small>`;
  } else {
    const it = hit.item;
    const text = it.text.length > 90 ? it.text.slice(0, 90) + '…' : it.text;
    tip.innerHTML = `<b>记忆 · ${KIND[it.kind] || it.kind}</b>：${esc(text)}${it.at ? `<small>${fmtTime(it.at)}</small>` : ''}`;
  }
  tip.hidden = false;
  const box = tip.parentElement.getBoundingClientRect();
  tip.style.left = Math.min(hit.x + 14, box.width - 290) + 'px';
  tip.style.top = Math.max(hit.y - 10, 10) + 'px';
}

function onPick(hit) {
  if (!hit) return;
  if (hit.type === 'region') {
    neuro.selectRegion(hit.id);
    renderPage();
    return;
  }
  if (hit.type !== 'memory') return;
  const text = prompt('修改这条记忆（留空则删除）：', hit.item.text);
  if (text === null) return;
  if (!text.trim()) {
    if (confirm('彻底删掉这条记忆？删了就找不回来了。')) fish.deleteMemory(hit.item.id);
    return;
  }
  if (text.trim() !== hit.item.text) fish.editMemory(hit.item.id, text.trim());
}

function ensureBrain() {
  brainLoading ||= (async () => {
    try {
      const cortex = await fish.cortex();
      brain = createBrain(canvas, cortex, { onHover, onPick });
      if (S.vitals) brain.setActivity(S.vitals.body.regions);
      pushMemories();
    } catch (err) {
      console.error(err);
      stage3d.innerHTML = '<div class="empty">这台电脑的显卡不支持 WebGL，3D 大脑显示不了。</div>';
    }
  })();
  return brainLoading;
}

function activateBrain() {
  if (!brain || !stageMode) return;
  brain.setMode(stageMode);
  syncLabels();
  brain.resume();
}

function syncLabels() {
  if (!brain) return;
  $('[data-brainact="labels"]')?.classList.toggle('on', labelsOn);
  if (stageMode === 'ocean') {
    brain.showLabels(stage3d, null);
    brain.setOceanLabels(labelsOn);
  } else {
    brain.showLabels(stage3d, labelsOn ? Object.fromEntries(S.meta.regions.map((r) => [r.id, r.name])) : null);
  }
}

const gl = {
  attachStage(host, mode) {
    host.appendChild(stage3d);
    stageMode = mode;
    if (brain) activateBrain();
    else ensureBrain().then(activateBrain);
  },
  attachWhale(host) {
    host.appendChild(whaleCanvas);
    if (whale) { whale.resume(); return; }
    try {
      whale = createWhale(whaleCanvas);
      whale.setState({ asleep: S.vitals?.state.asleep });
    } catch (err) {
      console.error(err);
      host.innerHTML = '<svg viewBox="0 0 40 40"><use href="#whale"/></svg>';
    }
  },
  whaleAct: (name) => whale?.act(name),
  focusRegions: (ids) => brain?.focusRegions(ids),
  park() {
    stageMode = null;
    glPark.append(stage3d, whaleCanvas);
    brain?.pause();
    whale?.pause();
    onHover(null);
  },
};

stage3d.querySelectorAll('[data-brainact]').forEach((b) =>
  b.addEventListener('click', () => {
    const act = b.dataset.brainact;
    if (act === 'immersive') {
      b.classList.toggle('on', document.body.classList.toggle('immersive'));
      return;
    }
    if (!brain) return;
    if (act === 'flow') {
      const paused = b.textContent === '暂停流动';
      brain.setFlow(!paused);
      b.textContent = paused ? '继续流动' : '暂停流动';
      b.classList.toggle('on', paused);
    } else if (act === 'spin') {
      const on = !b.classList.contains('on');
      brain.setSpin(on);
      b.classList.toggle('on', on);
    } else if (act === 'reset') {
      brain.reset();
      $('[data-brainact="spin"]').classList.add('on');
    } else if (act === 'labels') {
      labelsOn = !labelsOn;
      syncLabels();
    }
  }),
);

// ---------- 导航 ----------
let route = parseRoute(localStorage.getItem(ROUTE_KEY) || DEFAULT_ROUTE);

$('#navList').innerHTML = NAV.map((n) => `<button class="navbtn" data-go="${n.id}"><i>${n.icon}</i><span>${n.label}</span></button>`).join('');

function renderNav() {
  const n = NAV.find((x) => x.id === route.view);
  document.querySelectorAll('#navList .navbtn').forEach((b) => b.classList.toggle('active', b.dataset.go === route.view));
  $('#viewTitle').textContent = n.label;
  $('#subtabs').innerHTML = n.tabs.length > 1 ? n.tabs.map((t) => `<button class="tab ${t.id === route.tab ? 'on' : ''}" data-go="${n.id}/${t.id}">${t.label}</button>`).join('') : '';
}

const ctx = { S, fish, toast, gl, rerender: () => renderPage(), linkActions: null };

function renderPage() {
  if (!S.vitals) return;
  const page = $('#page');
  const top = page.scrollTop;
  const open = new Set([...page.querySelectorAll('details[open]')].map((d) => d.dataset.k));
  gl.park();
  try {
    VIEWS[route.view].render(page, route.tab, ctx);
  } catch (err) {
    console.error(err);
    page.innerHTML = `<div class="empty">这个页面出错了：${esc(err.message)}</div>`;
  }
  page.querySelectorAll('details').forEach((d) => { if (open.has(d.dataset.k)) d.open = true; });
  page.scrollTop = top;
}

function go(r) {
  const next = parseRoute(r);
  const changed = next.view !== route.view || next.tab !== route.tab;
  route = next;
  localStorage.setItem(ROUTE_KEY, `${route.view}/${route.tab}`);
  renderNav();
  if (changed) $('#page').scrollTop = 0;
  renderPage();
}

document.addEventListener('click', (e) => {
  const b = e.target.closest?.('[data-go]');
  if (b) go(b.dataset.go);
});

// ---------- 聊天 ----------
const msgs = $('#msgs');
let lastStamp = 0;
function stamp(at) {
  if (at - lastStamp > 5 * 60000) {
    const d = document.createElement('div');
    d.className = 'time';
    d.textContent = fmtTime(at);
    msgs.appendChild(d);
  }
  lastStamp = at;
}
function bubble(role, text, cls = '') {
  const el = document.createElement('div');
  el.className = `msg ${role === 'user' ? 'me' : 'her'} ${cls}`;
  el.textContent = text;
  msgs.appendChild(el);
  return el;
}
/** 她的一条回复按换行拆成几条气泡，像 QQ 上连发几句 */
function herLines(text, at, proactive) {
  stamp(at || Date.now());
  if (proactive) {
    const t = document.createElement('div');
    t.className = 'proactive-tag';
    t.textContent = '她主动找你';
    msgs.appendChild(t);
  }
  for (const line of String(text).split(/\n+/).map((l) => l.trim()).filter(Boolean)) bubble('assistant', line);
}
const scrollChat = () => (msgs.scrollTop = msgs.scrollHeight);
function renderHistory() {
  msgs.innerHTML = '';
  lastStamp = 0;
  for (const m of S.history) {
    if (m.role === 'user') {
      stamp(m.at);
      bubble('user', m.content);
    } else herLines(m.content, m.at, m.proactive);
  }
  scrollChat();
}

$('#composer').addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = $('#input');
  const text = input.value.trim();
  if (!text || !S.settings.hasKey) return;
  input.value = '';
  stamp(Date.now());
  bubble('user', text);
  scrollChat();
  S.history.push({ role: 'user', content: text, at: Date.now() });
  brain?.firePath();
  const r = await fish.send(text);
  if (!r.ok && r.error && !S.streaming) {
    bubble('assistant', r.error, 'err');
    scrollChat();
  }
});
$('#input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    $('#composer').requestSubmit();
  }
});
$('#chatFold').addEventListener('click', () => {
  $('#chat').classList.add('folded');
  $('#chatOpen').hidden = false;
});
$('#chatOpen').addEventListener('click', () => {
  $('#chat').classList.remove('folded');
  $('#chatOpen').hidden = true;
});
$('#goLinks').addEventListener('click', () => go('settings/general'));

fish.onReplyStart((id) => {
  const el = bubble('assistant', '…', 'typing');
  S.streaming = { id, el, text: '' };
  $('#sendBtn').disabled = true;
  scrollChat();
});
fish.onReplyDelta((id, d) => {
  if (!S.streaming || S.streaming.id !== id) return;
  S.streaming.text += d;
  S.streaming.el.classList.remove('typing');
  S.streaming.el.textContent = S.streaming.text;
  scrollChat();
});
fish.onReplyEnd((id, msg, err) => {
  const st = S.streaming;
  S.streaming = null;
  $('#sendBtn').disabled = false;
  if (st) st.el.remove();
  if (err) bubble('assistant', err, 'err');
  if (msg) {
    S.history.push(msg);
    herLines(msg.content, msg.at, msg.proactive);
  }
  scrollChat();
});
fish.onProactive((msg) => {
  S.history.push(msg);
  herLines(msg.content, msg.at, true);
  scrollChat();
});
fish.onNotice((text) => toast(text));
fish.onThought((t) => toast(`${t.name}：${t.text}`));

// ---------- 状态更新 ----------
function statusLine(v) {
  if (!v) return '—';
  const s = v.state;
  if (s.asleep) return '睡着了 · 呼吸很慢';
  const urge = v.mind.topUrge;
  const name = urge ? S.meta.drives.find((d) => d.id === urge.id)?.name : '';
  return `${s.activity} · ${v.mind.pad.label}${name ? ` · 最想${name}` : ''}`;
}

/** 有输入框在用时不重画，免得打字被打断 */
const typingInPage = () => {
  const a = document.activeElement;
  return a && $('#page').contains(a) && /INPUT|TEXTAREA|SELECT/.test(a.tagName);
};
const refreshPage = () => { if (!typingInPage()) renderPage(); };

function applyVitals(v, events = []) {
  S.vitals = v;
  $('#chatStatus').textContent = statusLine(v);
  $('#railPulse').classList.toggle('sleep', v.state.asleep);
  $('#railStatus').textContent = v.immune?.fever ? '发烧中' : v.state.asleep ? '睡觉' : '在线';
  brain?.setActivity(v.body.regions);
  whale?.setState({ asleep: v.state.asleep });
  if (events.some((e) => e.type === 'reply')) brain?.firePath(['prefrontal', 'motor']);
  refreshPage();
}
fish.onVitals((v, events) => applyVitals(v, events));
fish.onMemory((payload) => {
  S.memory = payload;
  pushMemories();
  refreshPage();
});
fish.onProfile((profile) => {
  S.profile = profile;
  refreshPage();
});
fish.onDiary((diary) => {
  S.diary = diary;
  refreshPage();
});
fish.onUs((payload) => {
  S.us = payload;
  refreshPage();
});

// ---------- 设置页的动作 ----------
ctx.linkActions = {
  async save(patch) {
    S.settings = await fish.saveSettings(patch);
    setName(S.settings.daughterName);
    refreshSetup();
    toast('已保存');
    renderPage();
  },
  async refreshBalance() {
    const b = await fish.refreshBalance();
    if (S.vitals) S.vitals.balance = b;
    renderPage();
  },
  async consolidate() {
    toast('她睡着了，正在整理今天的记忆…');
    const r = await fish.consolidate();
    if (r && r.ok) toast(r.skipped ? r.reason : `整理完了：事实 ${r.semantic || 0} 条、反思 ${r.reflections || 0} 条`);
    else toast('没整理成，看看设置里有没有填 API Key');
    renderPage();
  },
  async backup() {
    const r = await fish.backup();
    toast(r ? `已备份 ${r.copied} 个文件到 backups/${r.day}` : '备份没跑成');
    S.backups = await fish.backups();
    renderPage();
  },
  async loadBackups() {
    S.backups = await fish.backups();
    renderPage();
  },
  openExternal: (url) => fish.openExternal(url),
};
function setName(name) {
  if (!name) return;
  S.name = name;
  $('#chatName').textContent = name;
}
function refreshSetup() {
  $('#setup').hidden = !!S.settings.hasKey;
  $('#composer').hidden = !S.settings.hasKey;
}

// ---------- 启动 ----------
(async () => {
  const data = await fish.init();
  Object.assign(S, { name: data.name, versions: data.versions, settings: data.settings, history: data.history, memory: data.memory, us: data.us, profile: data.profile, diary: data.diary, meta: data.meta });
  setName(data.name);
  refreshSetup();
  renderHistory();
  renderNav();
  applyVitals(data);
  window.__fishReady = true;
})();

// 调试、截图和 e2e 用
window.__go = go;
window.__routes = routes;
export { fmtClock };
