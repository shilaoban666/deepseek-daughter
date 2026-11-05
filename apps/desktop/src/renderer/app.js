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
  facts: [],
  diary: [],
  meta: { regions: [], transmitters: [], drives: [] },
  view: 'brain',
  memTab: 'layers',
  streaming: null, // { id, el, text }
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
    herLines(msg.content, msg.at);
  }
  scrollChat();
});
fish.onProactive((msg) => {
  S.history.push(msg);
  herLines(msg.content, msg.at, true);
  scrollChat();
});
fish.onNotice((text) => toast(text));

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
  return `${s.activity} · ${v.mind.pad.label}`;
}
function applyVitals(v, events = []) {
  S.vitals = v;
  $('#chatStatus').textContent = statusLine(v);
  $('#railPulse').classList.toggle('sleep', v.state.asleep);
  $('#railStatus').textContent = v.state.asleep ? '睡觉' : '在线';
  $('#thinkState').textContent = v.mind.thinking;
  const p = v.mind.pad;
  $('#padText').textContent = `${p.label}  P ${p.P.toFixed(2)}  A ${p.A.toFixed(2)}  D ${p.D.toFixed(2)}`;
  $('#thoughtList').innerHTML =
    v.body.thoughts
      .slice(-3)
      .reverse()
      .map((t) => `<li>${esc(t.text)}<small>${fmtClock(t.at)} · ${esc(driveName(t.drive))}驱力</small></li>`)
      .join('') || '<li class="faint">脑子里空空的</li>';
  brain?.setActivity(v.body.regions);
  if (events.some((e) => e.type === 'reply')) brain?.firePath(['prefrontal', 'motor']);
  if (S.view === 'life') renderLife($('#dash'), S);
  if (S.view === 'brain' && S.memTab === 'modes') renderMem();
}
const driveName = (id) => S.meta.drives.find((d) => d.id === id)?.name || id;
fish.onVitals((v, events) => applyVitals(v, events));
fish.onFacts((facts) => {
  S.facts = facts;
  if (S.memTab === 'layers') renderMem();
  pushMemories();
});
fish.onDiary((diary) => {
  S.diary = diary;
  if (S.memTab === 'diary') renderMem();
  pushMemories();
});

// ---------- 思考记忆：右侧面板 ----------
const BIG5 = [
  ['开放性', 82, '#4fd6ff'],
  ['尽责性', 38, '#3ddc97'],
  ['外向性', 71, '#f5c242'],
  ['宜人性', 76, '#ef6f8e'],
  ['情绪稳定性', 58, '#a98bff'],
];
const PERSONA = {
  interests: ['布丁', 'B 站', '小说', '深夜刷手机', '海洋', '星星'],
  tone: ['嗯哼', '诶？', '哪里肥了！', '哈哈哈哈', '(｡•ˇ‸ˇ•｡)'],
  bounds: ['不假装自己是人类', '不说伤害人的话', '不替主人做花钱的决定', '安静时段不打扰'],
  routines: ['8:00 早饭', '12:00 午饭', '15:00 下午茶布丁', '18:30 晚饭', '凌晨 1 点前睡觉'],
};
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
  const v = S.vitals;
  if (S.memTab === 'layers') {
    const episodic = S.history.filter((m) => m.role === 'user').length;
    const working = Math.min(24, S.history.length);
    const facts = [...S.facts].sort((a, b) => b.importance - a.importance || b.createdAt - a.createdAt);
    box.innerHTML = `
      <div class="layer"><div class="layer-head"><b>工作记忆</b><small>前额叶</small><span class="count">${working}</span></div><p>此刻放在“脑子里”的最近 ${working} 条对话，加上身体和情绪。</p></div>
      <div class="layer"><div class="layer-head"><b>情景记忆</b><small>海马体</small><span class="count">${episodic}</span></div><p>你说过的每一句话都按时间存着，带着当时的心情。</p></div>
      <div class="layer"><div class="layer-head"><b>语义记忆</b><small>颞叶新皮层</small><span class="count">${facts.length}</span></div>
        ${facts.length ? facts.map((f) => `<div class="fact"><span class="imp">${'★'.repeat(f.importance)}</span><span>${esc(f.text)}</span><button title="让她忘掉这条" data-forget="${esc(f.id)}">✕</button></div>`).join('') : '<p>还没记住什么。多和她聊聊，每聊 3 句她会整理一次。</p>'}
      </div>
      <div class="layer"><div class="layer-head"><b>程序记忆</b><small>小脑、基底核</small><span class="count">${PERSONA.routines.length}</span></div><div class="chips">${PERSONA.routines.map((r) => `<span class="chip">${esc(r)}</span>`).join('')}</div></div>
      <div class="layer"><div class="layer-head"><b>反思与日记</b><small>高级认知</small><span class="count">${S.diary.length}</span></div><p>每晚睡觉时回放当天，写成日记。</p></div>
      <div class="layer"><div class="layer-head"><b>自我叙事</b><small>自传体记忆</small></div><p>我叫${esc(S.name)}，住在电脑里。名字是养我的人取的。</p></div>`;
    box.querySelectorAll('[data-forget]').forEach((b) =>
      b.addEventListener('click', () => {
        if (confirm('让她忘掉这条记忆？')) fish.forget(b.dataset.forget);
      }),
    );
  } else if (S.memTab === 'persona') {
    box.innerHTML = `
      <div class="layer"><div class="layer-head"><b>天性 · 大五人格</b><small>只读，不会变</small></div>${BIG5.map(([n, val, c]) => bar(n, val, c)).join('')}</div>
      <div class="layer"><div class="layer-head"><b>兴趣</b></div><div class="chips">${PERSONA.interests.map((x) => `<span class="chip">${esc(x)}</span>`).join('')}</div></div>
      <div class="layer"><div class="layer-head"><b>语气</b></div><div class="chips">${PERSONA.tone.map((x) => `<span class="chip">${esc(x)}</span>`).join('')}</div></div>
      <div class="layer"><div class="layer-head"><b>边界</b><small>主人设定，成长不会改写</small></div><div class="chips">${PERSONA.bounds.map((x) => `<span class="chip">${esc(x)}</span>`).join('')}</div></div>
      <div class="layer"><div class="layer-head"><b>后天性格</b><small>睡眠时缓慢偏移</small></div><p>还没有偏移记录。和她相处一段时间后，这里会记下她因为什么变了一点点。</p></div>`;
  } else if (S.memTab === 'modes') {
    const cur = v?.mind.thinking;
    const regs = S.meta.regions.map((r) => ({ ...r, v: v?.body.regions[r.id] ?? 0 })).sort((a, b) => b.v - a.v);
    box.innerHTML =
      MODES.map(([n, d]) => `<div class="mode ${n === cur ? 'on' : ''}"><b>${n}</b><span>${d}</span></div>`).join('') +
      `<div class="layer"><div class="layer-head"><b>14 个脑区激活</b></div>${regs.map((r) => bar(r.name, r.v * 100, '#4fd6ff')).join('')}</div>`;
  } else if (S.memTab === 'diary') {
    box.innerHTML = S.diary.length
      ? [...S.diary].reverse().map((d) => `<div class="diary-item"><small>${esc(d.date)}</small><p>${esc(d.text)}</p></div>`).join('')
      : '<div class="empty">还没有日记。她每晚睡觉时会写一篇。</div>';
  }
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
  const items = [
    ...S.facts.map((f) => ({ id: f.id, kind: 'semantic', text: f.text })),
    ...S.history
      .filter((m) => m.role === 'user')
      .slice(-40)
      .map((m) => ({ id: String(m.at), kind: 'episodic', text: m.content, at: m.at })),
    ...S.diary.map((d) => ({ id: d.date, kind: 'diary', text: d.text, at: d.at })),
  ];
  brain.setMemories(items);
}

// ---------- 3D 大脑 ----------
const KIND = { semantic: '语义记忆', episodic: '情景记忆', diary: '日记', self: '自我叙事' };
function initBrain() {
  const tip = $('#brainTip');
  try {
    brain = createBrain($('#brainCanvas'), {
      onHover(hit) {
        if (!hit) return (tip.hidden = true);
        if (hit.type === 'region') {
          const r = S.meta.regions.find((x) => x.id === hit.id);
          const act = S.vitals?.body.regions[hit.id] ?? 0;
          tip.innerHTML = `<b>${esc(r?.name || hit.id)}</b> · 激活 ${Math.round(act * 100)}%<small>${esc(r?.role || '')}</small>`;
        } else {
          const it = hit.item;
          const text = it.text.length > 90 ? it.text.slice(0, 90) + '…' : it.text;
          tip.innerHTML = `<b>记忆 · ${KIND[it.kind]}</b>：${esc(text)}${it.at ? `<small>${fmtTime(it.at)}</small>` : ''}`;
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
function setLabels(on) {
  labelsOn = on;
  document.querySelector('[data-brainact="labels"]').classList.toggle('on', on);
  document.querySelectorAll('[data-brainmode]').forEach((x) => x.classList.toggle('on', (x.dataset.brainmode === 'regions') === on));
  brain?.showLabels($('.brain-stage'), on ? Object.fromEntries(S.meta.regions.map((r) => [r.id, r.name])) : null);
}
document.querySelectorAll('[data-brainmode]').forEach((b) => b.addEventListener('click', () => setLabels(b.dataset.brainmode === 'regions')));

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
  openExternal: (url) => fish.openExternal(url),
};
function setName(name) {
  if (!name) return;
  S.name = name;
  $('#chatName').textContent = name;
  document.querySelectorAll('[data-name]').forEach((el) => (el.textContent = name));
  if (S.memTab === 'layers') renderMem();
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
    facts: data.facts,
    diary: data.diary,
    meta: data.meta,
  });
  setName(data.name);
  refreshSetup();
  renderHistory();
  initBrain();
  applyVitals(data);
  pushMemories();
  renderMem();
  window.__fishReady = true;
})();

window.__setView = setView; // 调试与截图用
