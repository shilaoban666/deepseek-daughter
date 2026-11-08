// 界面入口：导航、聊天、思考记忆页的面板。生命状态页见 life-view.js，链接页见 links.js。

import { createBrain } from './brain.js';
import { renderLife } from './life-view.js';
import { renderLinks } from './links.js';
import { $, esc, fmtTime, fmtClock } from './util.js';

const fish = window.fish;
const S = {
  name: '小鲸鱼',
  settings: {},
  vitals: null,
  history: [],
  memory: { records: [], stats: {}, conflicts: [], layers: [], layerNames: {}, sourceNames: {} },
  profile: null,
  diary: [],
  meta: { regions: [], transmitters: [], drives: [], layers: [], layerNames: {}, sourceNames: {}, big5: [] },
  view: 'brain',
  memTab: 'layers',
  streaming: null, // { id, el, text }
  backups: null,
};

// ---------- 导航 ----------
let brain = null;
function setView(v) {
  S.view = v;
  document.querySelectorAll('.navbtn').forEach((b) => b.classList.toggle('active', b.dataset.view === v));
  document.querySelectorAll('.view').forEach((el) => el.classList.toggle('active', el.id === `view-${v}`));
  if (brain) (v === 'brain' ? brain.resume() : brain.pause());
  if (v === 'life') renderLife($('#dash'), S);
  if (v === 'links') renderLinks($('#links'), S, linkActions);
}
document.querySelectorAll('.navbtn').forEach((b) => b.addEventListener('click', () => setView(b.dataset.view)));

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
const scrollChat = () => (msgs.scrollTop = msgs.scrollHeight);

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
$('#goLinks').addEventListener('click', () => setView('links'));

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

function toast(text) {
  const t = $('#toast');
  t.textContent = text;
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (t.hidden = true), 4000);
}

// ---------- 状态更新 ----------
function statusLine(v) {
  if (!v) return '—';
  const s = v.state;
  if (s.asleep) return '睡着了 · 呼吸很慢';
  const urge = v.mind.topUrge;
  const name = urge ? S.meta.drives.find((d) => d.id === urge.id)?.name : '';
  return `${s.activity} · ${v.mind.pad.label}${name ? ` · 最想${name}` : ''}`;
}
function applyVitals(v, events = []) {
  S.vitals = v;
  $('#chatStatus').textContent = statusLine(v);
  $('#railPulse').classList.toggle('sleep', v.state.asleep);
  $('#railStatus').textContent = v.immune?.fever ? '发烧中' : v.state.asleep ? '睡觉' : '在线';
  $('#thinkState').textContent = v.mind.thinking;
  const p = v.mind.pad;
  $('#padText').textContent = `${p.label}  P ${p.P.toFixed(2)}  A ${p.A.toFixed(2)}  D ${p.D.toFixed(2)}`;
  const thoughts = v.body.thoughts || [];
  $('#thoughtList').innerHTML =
    thoughts
      .slice(-1)
      .reverse()
      .map((t) => `<li>${esc(t.text)}<small>${fmtClock(t.at)} · ${esc(driveName(t.drive))}驱力${t.value ? ` ${t.value}` : ''}</small></li>`)
      .join('') || '<li class="faint">脑子里空空的</li>';
  const urges = Object.values(v.mind.urges || {}).sort((a, b) => b.value - a.value).slice(0, 1);
  $('#urgeList').innerHTML =
    urges
      .map((u) => `<li>${esc(u.name)}<small>${u.value} · 缺口 ${Math.round((u.gap || 0) * 100)}% × 权重 ${u.weight} × 情绪 ${u.mod}</small></li>`)
      .join('') || '<li class="faint">—</li>';
  brain?.setActivity(v.body.regions);
  if (events.some((e) => e.type === 'reply')) brain?.firePath(['prefrontal', 'motor']);
  if (S.view === 'life') renderLife($('#dash'), S);
  if (S.view === 'brain' && S.memTab === 'regions') renderMem();
}
const driveName = (id) => S.meta.drives.find((d) => d.id === id)?.name || id;
fish.onVitals((v, events) => applyVitals(v, events));
fish.onMemory((payload) => {
  S.memory = payload;
  if (S.memTab === 'layers') renderMem();
  pushMemories();
});
fish.onProfile((profile) => {
  S.profile = profile;
  if (S.memTab === 'persona') renderMem();
});
fish.onDiary((diary) => {
  S.diary = diary;
  if (S.memTab === 'diary') renderMem();
  pushMemories();
});

// ---------- 思考记忆：右侧面板 ----------
const MODES = [
  ['专注', '前额叶、丘脑高；默认模式网络低。认真和你聊天、看书。'],
  ['走神', '默认模式网络高；前额叶低。发呆、自由联想。'],
  ['兴奋', '杏仁核、多巴胺高。发现喜欢的东西，话变多。'],
  ['压力', '杏仁核、皮质醇高；血清素低。烦躁、容易委屈。'],
  ['犯困', '脑干觉醒低、褪黑素高。反应慢，想睡觉。'],
  ['深睡', '海马体高，其余低。重放和巩固当天的记忆。'],
  ['做梦', '海马体、默认模式网络高。把记忆碎片拼成梦。'],
];
const bar = (name, val, color, max = 100) =>
  `<div class="bar"><span>${esc(name)}</span><div class="track"><div class="fill" style="width:${Math.max(0, Math.min(100, (val / max) * 100))}%;background:${color};box-shadow:0 0 8px ${color}"></div></div><span class="num">${Math.round(val)}</span></div>`;

function renderMem() {
  const box = $('#memBody');
  if (S.memTab === 'layers') return renderLayers(box);
  if (S.memTab === 'persona') return renderPersona(box);
  if (S.memTab === 'regions') return renderRegions(box);
  return renderDiary(box);
}

// —— 记忆分层 ——
const SOURCE_ORDER = ['owner', 'self', 'content', 'platform', 'stranger', 'system'];

function conflictBlock() {
  const list = (S.memory.conflicts || []).filter((c) => !c.resolved);
  if (!list.length) return '';
  return `<div class="conflict"><b>有两段记忆对不上，等你确认</b>${list
    .slice(0, 3)
    .map((c) => {
      const a = S.memory.records.find((r) => r.id === c.id);
      const b = S.memory.records.find((r) => r.id === c.with);
      return `<div class="conflict-row"><span>「${esc(a?.text || c.texts?.[0] || '')}」</span><span>和</span><span>「${esc(b?.text || c.texts?.[1] || '')}」</span>
        <button data-keep="${esc(c.id)}" data-vs="${esc(c.with)}">留前一条</button><button data-keep="${esc(c.with)}" data-vs="${esc(c.id)}">留后一条</button></div>`;
    })
    .join('')}</div>`;
}

function memRow(r, { archived = false } = {}) {
  const src = S.memory.sourceNames?.[r.source?.kind] || r.source?.kind || '';
  const strength = Math.round((r.strength || 0) * 100);
  return `<div class="mem ${r.provisional ? 'provisional' : ''} ${r.conflict ? 'conflicted' : ''}">
    <div class="mem-head">
      <span class="src s-${esc(r.source?.kind || 'self')}">${esc(src)}</span>
      <span class="mem-at">${fmtTime(r.at)}</span>
      <span class="mem-str">强度 ${strength}% · 想起 ${r.recallCount || 0} 次${r.validUntil ? ` · 到 ${new Date(r.validUntil).toLocaleDateString('zh-CN')} 为止` : ''}</span>
    </div>
    <div class="mem-text">${esc(r.text)}</div>
    <div class="mem-actions">
      <button data-edit="${esc(r.id)}">改</button>
      ${archived ? `<button data-restore="${esc(r.id)}">恢复</button>` : `<button data-forget="${esc(r.id)}">忘掉</button>`}
      <button class="danger" data-delete="${esc(r.id)}">删除</button>
    </div>
  </div>`;
}

function layerBlock(layer, records) {
  const name = S.memory.layerNames?.[layer] || layer;
  const hint = {
    episodic: '事件：时间、地点、人物、原话、当时的情绪。',
    semantic: '事实和概念，从对话和睡眠巩固里来。',
    procedural: '技能和惯例：怎么用某个工具、每天要做什么。',
    reflection: '从经历里总结出来的观点和道理。',
    self: '“我是谁、我怎么讲自己”，由反思不断整合而成。',
  }[layer];
  return `<div class="layer">
    <div class="layer-head"><b>${esc(name)}</b><small>${esc(hint || '')}</small><span class="count">${records.length}</span></div>
    ${records.length ? records.map((r) => memRow(r)).join('') : '<p class="dim">还没有。</p>'}
  </div>`;
}

function renderLayers(box) {
  const mem = S.memory;
  const stats = mem.stats || {};
  const active = (mem.records || []).filter((r) => !r.archived);
  const archived = (mem.records || []).filter((r) => r.archived);
  const byLayer = {};
  for (const r of active) (byLayer[r.layer] ||= []).push(r);
  for (const k of Object.keys(byLayer)) byLayer[k].sort((a, b) => b.importance - a.importance || b.at - a.at);
  const working = Math.min(24, S.history.length);

  box.innerHTML = `
    <div class="stat-row">
      <div><b>${stats.active ?? active.length}</b><span>在记着</span></div>
      <div><b>${stats.archived ?? archived.length}</b><span>已归档</span></div>
      <div><b>${stats.conflicts ?? 0}</b><span>待求证</span></div>
      <div><b>${Math.round((stats.avgStrength || 0) * 100)}%</b><span>平均强度</span></div>
    </div>
    ${conflictBlock()}
    <div class="layer"><div class="layer-head"><b>工作记忆</b><small>前额叶</small><span class="count">${working}</span></div>
      <p>此刻放在“脑子里”的最近 ${working} 条对话，加上身体、情绪和当前的冲动。</p></div>
    ${(mem.layers || ['episodic', 'semantic', 'procedural', 'reflection', 'self']).map((l) => layerBlock(l, byLayer[l] || [])).join('')}
    ${archived.length ? `<div class="layer"><div class="layer-head"><b>归档</b><small>只降强度、不删除；重要性高的记忆不会被忘掉</small><span class="count">${archived.length}</span></div>${archived.slice(0, 30).map((r) => memRow(r, { archived: true })).join('')}</div>` : ''}
    <div class="faint small">来自大模型的记忆整理只写“对话里确实出现过”的信息；陌生人的话可信度最低，不会覆盖你说过的话。</div>`;

  box.querySelectorAll('[data-forget]').forEach((b) =>
    b.addEventListener('click', () => {
      fish.forget(b.dataset.forget);
      toast('已移进归档，可以再恢复');
    }),
  );
  box.querySelectorAll('[data-restore]').forEach((b) => b.addEventListener('click', () => fish.restoreMemory(b.dataset.restore)));
  box.querySelectorAll('[data-delete]').forEach((b) =>
    b.addEventListener('click', () => {
      if (confirm('彻底删掉这条记忆？删了就找不回来了。')) fish.deleteMemory(b.dataset.delete);
    }),
  );
  box.querySelectorAll('[data-edit]').forEach((b) =>
    b.addEventListener('click', () => {
      const rec = S.memory.records.find((r) => r.id === b.dataset.edit);
      const text = prompt('改一下她记着的内容：', rec?.text || '');
      if (text && text.trim() && text.trim() !== rec?.text) fish.editMemory(b.dataset.edit, text.trim());
    }),
  );
  box.querySelectorAll('[data-keep]').forEach((b) =>
    b.addEventListener('click', () => {
      fish.resolveConflict(b.dataset.keep, b.dataset.keep);
      toast('已经按你选的留下来');
    }),
  );
}

// —— 人格 ——
function renderPersona(box) {
  const p = S.profile;
  if (!p) {
    box.innerHTML = '<div class="empty">人格档案还没建好。</div>';
    return;
  }
  const traits = p.traits || p.temperament;
  const defs = S.meta.big5 || [];
  const growth = (p.growth || []).slice(-12).reverse();
  const deltas = {};
  for (const t of defs) deltas[t.id] = (traits[t.id] || 50) - (p.temperament?.[t.id] || 50);

  box.innerHTML = `
    <div class="layer"><div class="layer-head"><b>${esc(S.name)}</b><small>${esc(p.stage || '萌芽')}期 · 第 ${S.vitals?.days || 1} 天</small></div>
      <p>天性只读；后天层由睡眠巩固每天偏移一点点，每天最多 2 分，每次都有原因，可以撤销。</p></div>
    <div class="layer"><div class="layer-head"><b>天性 · 大五人格</b><small>只读，不会被成长改写</small></div>
      ${defs.map((t) => bar(t.name, p.temperament?.[t.id] ?? 50, '#4fd6ff')).join('')}</div>
    <div class="layer"><div class="layer-head"><b>现在的性格</b><small>会慢慢变</small></div>
      ${defs
        .map((t) => bar(`${t.name}${deltas[t.id] ? ` (${deltas[t.id] > 0 ? '+' : ''}${deltas[t.id].toFixed(1)})` : ''}`, traits[t.id] ?? 50, '#f5c242'))
        .join('')}</div>
    <div class="layer"><div class="layer-head"><b>成长记录</b><small>可以撤销</small><span class="count">${(p.growth || []).length}</span></div>
      ${growth.length
        ? growth
            .map(
              (g) => `<div class="growth ${g.undone ? 'undone' : ''}">
                <b>${esc(g.traitName)} ${g.delta > 0 ? '+' : ''}${g.delta}</b>
                <span>${esc(g.reason)}</span>
                <small>${fmtTime(g.at)}${g.evidence ? ` · “${esc(g.evidence)}”` : ''}</small>
                ${g.undone ? '<em>已撤销</em>' : `<button data-undo="${esc(g.id)}">撤销</button>`}
              </div>`,
            )
            .join('')
        : '<p class="dim">还没有偏移记录。和她相处一段时间后，这里会记下她因为什么变了一点点。</p>'}</div>
    <div class="layer"><div class="layer-head"><b>兴趣图谱</b><small>读得越多越强，久不碰会变弱</small></div>
      <div class="interests">${(p.interests || [])
        .slice()
        .sort((a, b) => b.strength - a.strength)
        .map((i) => `<span class="chip">${esc(i.topic)}<i style="width:${Math.round(i.strength)}%"></i><b>${Math.round(i.strength)}</b></span>`)
        .join('')}</div></div>
    ${p.values?.length ? `<div class="layer"><div class="layer-head"><b>她自己的想法</b></div>${p.values.map((v) => `<p class="value">“${esc(v.text)}”</p>`).join('')}</div>` : ''}
    ${p.experiences?.length ? `<div class="layer"><div class="layer-head"><b>只发生过一次的事</b></div>${p.experiences.map((e) => `<p class="value">${esc(e.text)}</p>`).join('')}</div>` : ''}
    <div class="layer"><div class="layer-head"><b>边界</b><small>主人设定，成长不会改写</small></div>
      <div class="chips">${(p.bounds || []).map((x) => `<span class="chip">${esc(x)}</span>`).join('')}</div></div>
    <div class="layer"><div class="layer-head"><b>惯例</b></div>
      <div class="chips">${(p.routines || []).map((x) => `<span class="chip">${esc(x)}</span>`).join('')}</div></div>`;

  box.querySelectorAll('[data-undo]').forEach((b) =>
    b.addEventListener('click', async () => {
      await fish.undoGrowth(b.dataset.undo);
      toast('已撤销这次偏移');
    }),
  );
}

// —— 脑区 ——
const GROUP_ORDER = ['input', 'emotion', 'memory', 'decide', 'action', 'homeo', 'imagine'];

const regionById = (id) => S.meta.regions.find((r) => r.id === id) || null;

function renderRegions(box) {
  const v = S.vitals;
  const cur = v?.mind.thinking;
  const conns = S.meta.connections || [];
  const signals = (v?.mind.neuro?.signals || []).slice(-8).reverse();
  const nameOf = (rid) => regionById(rid)?.name || rid;
  const groups = S.meta.regionGroups || {};
  box.innerHTML = `
    <div class="modes-row">${MODES.map(([n]) => `<span class="mode-chip ${n === cur ? 'on' : ''}">${n}</span>`).join('')}</div>
    <p class="faint small">14 个脑区按功能分成七组。鼠标移到 3D 里的发光点或下面的名字上，可以看到它负责什么。</p>
    ${GROUP_ORDER.filter((gid) => groups[gid])
      .map((gid) => {
        const g = groups[gid];
        const list = S.meta.regions.filter((r) => r.group === gid);
        if (!list.length) return '';
        return `<div class="layer">
          <div class="layer-head"><b style="color:${g.color}">${esc(g.name)}</b><small>${esc(g.hint || '')}</small></div>
          ${list
            .map((r) => {
              const act = Math.round((v?.body.regions?.[r.id] ?? 0) * 100);
              return `<div class="region-row" title="${esc(r.desc || r.role)}">
                <i style="background:${g.color}"></i>
                <span><b>${esc(r.name)}</b><small>${esc(r.role)}</small></span>
                <em>${act}%</em>
                <u>${conns.filter(([a, b]) => a === r.id || b === r.id).length} 条连接</u>
              </div>`;
            })
            .join('')}
        </div>`;
      })
      .join('')}
    <div class="layer"><div class="layer-head"><b>最近的脑区交流</b><small>来源 → 目标 · 强度</small></div>
      ${signals.length
        ? `<div class="signals">${signals.map((s) => `<div><i class="${esc(s.payload?.kind || '')}"></i>${esc(nameOf(s.from))} → ${esc(nameOf(s.to))}<span>${Math.round((s.strength || 0) * 100)}%</span></div>`).join('')}</div>`
        : '<p class="dim">还没有信号。和她说句话，就能看到一条消息从感觉皮层走到语言区。</p>'}
      <div class="faint small">已经学到的连接：${v?.mind.neuro?.learned ?? 0} 条</div>
    </div>`;
}

// —— 日记 ——
function renderDiary(box) {
  const diary = S.diary || [];
  box.innerHTML = diary.length
    ? [...diary].reverse().map((d) => `<div class="diary-item"><small>${esc(d.date)}</small><p>${esc(d.text)}</p></div>`).join('')
    : '<div class="empty">还没有日记。她每晚睡觉时会回放这一天，写成一篇。</div>';
}

document.querySelectorAll('#memTabs button').forEach((b) =>
  b.addEventListener('click', () => {
    S.memTab = b.dataset.tab;
    document.querySelectorAll('#memTabs button').forEach((x) => x.classList.toggle('on', x === b));
    renderMem();
  }),
);

function pushMemories() {
  if (!brain) return;
  const items = (S.memory.records || [])
    .filter((r) => !r.archived)
    .sort((a, b) => b.importance - a.importance || b.at - a.at)
    .slice(0, 140)
    .map((r) => ({ id: r.id, kind: r.layer, text: r.text, at: r.at, importance: r.importance, entities: r.entities, links: r.links }));
  brain.setMemories(items);
}

// ---------- 3D 大脑 ----------
const KIND = { semantic: '语义记忆', episodic: '情景记忆', reflection: '反思', procedural: '程序记忆', self: '自我叙事', diary: '日记' };
async function initBrain() {
  const tip = $('#brainTip');
  try {
    brain = createBrain($('#brainCanvas'), await fish.cortex(), {
      // 点脑区看它负责什么；点记忆节点改内容，留空则删除；点空白取消聚焦
      onPick(hit) {
        if (!hit || hit.type !== 'memory') return;
        const text = prompt('修改这条记忆（留空则删除）：', hit.item.text);
        if (text === null) return;
        if (!text.trim()) {
          if (confirm('彻底删掉这条记忆？删了就找不回来了。')) fish.deleteMemory(hit.item.id);
          return;
        }
        if (text.trim() !== hit.item.text) fish.editMemory(hit.item.id, text.trim());
      },
      onHover(hit) {
        if (!hit) return (tip.hidden = true);
        if (hit.type === 'entity') {
          tip.innerHTML = `<b>${esc(hit.label)}</b><small>${esc(hit.detail)}</small>`;
        } else if (hit.type === 'region') {
          const r = S.meta.regions.find((x) => x.id === hit.id);
          const g = S.meta.regionGroups?.[r?.group];
          const act = S.vitals?.body.regions[hit.id] ?? 0;
          tip.innerHTML = `<b style="color:${g?.color || '#9fe8ff'}">${esc(r?.name || hit.id)}</b> · ${esc(g?.name || '')}<small>${esc(r?.desc || r?.role || '')}</small><small>激活 ${Math.round(act * 100)}% · 点击看它和谁通信</small>`;
        } else {
          const it = hit.item;
          const text = it.text.length > 90 ? it.text.slice(0, 90) + '…' : it.text;
          tip.innerHTML = `<b>记忆 · ${KIND[it.kind] || it.kind}</b>：${esc(text)}${it.at ? `<small>${fmtTime(it.at)}</small>` : ''}`;
        }
        tip.hidden = false;
        const stage = tip.parentElement.getBoundingClientRect();
        tip.style.left = Math.min(hit.x + 14, stage.width - 290) + 'px';
        tip.style.top = Math.max(hit.y - 10, 60) + 'px';
      },
    });
  } catch (err) {
    console.error(err);
    $('#brainCanvas').replaceWith(Object.assign(document.createElement('div'), { className: 'empty', textContent: '这台电脑的显卡不支持 WebGL，3D 大脑显示不了。' }));
  }
}
let labelsOn = false;
document.querySelectorAll('[data-brainact]').forEach((b) =>
  b.addEventListener('click', () => {
    const act = b.dataset.brainact;
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
      document.querySelector('[data-brainact="spin"]').classList.add('on');
    } else if (act === 'labels') {
      labelsOn = !labelsOn;
      setLabels(labelsOn);
    } else if (act === 'immersive') {
      const on = $('#view-brain').classList.toggle('immersive');
      b.classList.toggle('on', on);
    }
  }),
);
let brainMode = 'holo';
function updateBrainSeg() {
  document.querySelectorAll('[data-brainmode]').forEach((x) => x.classList.toggle('on', x.dataset.brainmode === brainMode));
}
function setLabels(on) {
  labelsOn = on;
  document.querySelector('[data-brainact="labels"]').classList.toggle('on', on);
  if (brainMode === 'ocean') return brain?.setOceanLabels(on);
  brainMode = on ? 'regions' : 'holo';
  updateBrainSeg();
  const names = Object.fromEntries(S.meta.regions.map((r) => [r.id, r.name]));
  brain?.showLabels($('.brain-stage'), on ? names : null);
}
function setBrainMode(m) {
  brainMode = m;
  updateBrainSeg();
  brain?.setMode(m === 'ocean' ? 'ocean' : 'brain');
  if (m === 'ocean') {
    brain?.showLabels($('.brain-stage'), null);
    setLabels(true);
  } else {
    setLabels(m === 'regions');
  }
}
document.querySelectorAll('[data-brainmode]').forEach((b) => b.addEventListener('click', () => setBrainMode(b.dataset.brainmode)));

// ---------- 链接页的动作 ----------
const linkActions = {
  async save(patch) {
    S.settings = await fish.saveSettings(patch);
    setName(S.settings.daughterName);
    refreshSetup();
    toast('已保存');
    renderLinks($('#links'), S, linkActions);
  },
  async refreshBalance() {
    const b = await fish.refreshBalance();
    if (S.vitals) S.vitals.balance = b;
    renderLinks($('#links'), S, linkActions);
  },
  async consolidate() {
    toast('她睡着了，正在整理今天的记忆…');
    const r = await fish.consolidate();
    if (r && r.ok) {
      toast(r.skipped ? r.reason : `整理完了：事实 ${r.semantic || 0} 条、反思 ${r.reflections || 0} 条、成长 ${r.growth || 0} 处`);
    } else {
      toast('没整理成，看看设置里有没有填 API Key');
    }
    renderLinks($('#links'), S, linkActions);
  },
  async backup() {
    const r = await fish.backup();
    toast(r ? `已备份 ${r.copied} 个文件到 backups/${r.day}` : '备份没跑成');
    S.backups = await fish.backups();
    renderLinks($('#links'), S, linkActions);
  },
  async loadBackups() {
    S.backups = await fish.backups();
    renderLinks($('#links'), S, linkActions);
  },
  openExternal: (url) => fish.openExternal(url),
};
function setName(name) {
  if (!name) return;
  S.name = name;
  $('#chatName').textContent = name;
  document.querySelectorAll('[data-name]').forEach((el) => (el.textContent = name));
  if (S.memTab === 'layers' || S.memTab === 'persona') renderMem();
}
function refreshSetup() {
  $('#setup').hidden = !!S.settings.hasKey;
  $('#composer').hidden = !S.settings.hasKey;
}

// ---------- 启动 ----------
(async () => {
  const data = await fish.init();
  Object.assign(S, {
    name: data.name,
    settings: data.settings,
    history: data.history,
    memory: data.memory,
    profile: data.profile,
    diary: data.diary,
    meta: data.meta,
  });
  setName(data.name);
  refreshSetup();
  renderHistory();
  await initBrain();
  applyVitals(data);
  pushMemories();
  renderMem();
  window.__fishReady = true;
})();

window.__setView = setView; // 调试与截图用
