// 意识和记忆：意识海、思想、人格、记忆、情绪。

import { esc, fmtClock, fmtTime } from '../util.js';
import { card, causeList, lead, level, li, nothing } from './ui.js';
import { C, affectPlane, bars, donut, hist, radar, ring, thresholdBars, timeChart } from './charts.js';

const THINKING = [['专注', '前额叶在工作'], ['走神', '默认网络在漫游'], ['兴奋', '多巴胺很高'], ['压力', '皮质醇很高'], ['犯困', '褪黑素上来了'], ['做梦', '睡着时回放记忆'], ['深睡', '睡得很沉']];
const LAYER_COLORS = [C.cyan, C.violet, C.amber, C.green, C.pink, C.blue, C.orange];
const DAY = 86400000;

let query = '';
let layerFilter = '全部';
const STAGE = { first: '第一级', second: '第二级', third: '第三级', sensory: '感觉性' };

function thoughts(el, { S }) {
  const v = S.vitals;
  const list = (v.body.thoughts || []).slice(-8).reverse();
  const urges = Object.values(v.mind.urges || {}).sort((a, b) => b.value - a.value);
  const diary = [...(S.diary || [])].reverse().slice(0, 5);
  el.innerHTML = lead(list[0] ? `“${list[0].text}”` : '脑子里空空的', `思考状态：${v.mind.thinking}`) + `<div class="g2">
    ${card('念头流', list.length ? li(list.map((t) => `<time>${fmtClock(t.at)}</time><span>${esc(t.text)}</span>`)) : nothing('还没有念头。'))}
    ${card('想做的事', urges.length ? thresholdBars(urges, 45, '过了 45 就会去做') : nothing('—'), '六种驱力的冲动值')}
  </div><div class="g2">
    ${card('思考状态', `<div class="stats">${THINKING.map(([n, why]) => `<div class="stat${n === v.mind.thinking ? ' on' : ''}"><b>${n}</b><span>${why}</span></div>`).join('')}</div>`, `现在：${v.mind.thinking}`)}
    ${card('最强的冲动', timeChart({ series: [{ name: '冲动值', pts: hist(v, 'urge'), cur: urges[0]?.value ?? 0, color: C.amber }], min: 0, max: 100, lines: [{ v: 45, label: '过线就行动' }], height: 132 }), urges[0] ? `现在最想：${urges[0].name}` : '')}
  </div>` + card('日记', diary.length ? li(diary.map((d) => `<time class="w">${esc(d.date.slice(5))}</time><span>${esc(d.text)}</span>`)) : nothing('还没有日记。她每晚睡觉时会回放这一天，写成一篇。'));
}

function persona(el, ctx) {
  const { S } = ctx;
  const p = S.profile;
  if (!p) { el.innerHTML = nothing('人格档案还没建好。'); return; }
  const traits = p.traits || p.temperament;
  const defs = S.meta.big5 || [];
  const growth = (p.growth || []).slice(-12).reverse();
  el.innerHTML = `<div class="g2">
    ${card('天性和现在', radar(defs.map((t) => ({ name: t.name, value: traits[t.id] ?? 50, base: p.temperament?.[t.id] ?? 50 })), { size: 240, color: C.violet }) + '<div class="ch-legend" style="margin-left:0;justify-content:center"><span><i style="background:#a98bff"></i>现在的性格</span><span><i style="background:none;border:1px dashed #7d8ca6"></i>天性（只读，不会被成长改写）</span></div>', '大五人格')}
    ${card('现在的性格', defs.map((t) => { const d = (traits[t.id] || 50) - (p.temperament?.[t.id] || 50); return level(`${t.name}${d ? ` (${d > 0 ? '+' : ''}${d.toFixed(1)})` : ''}`, traits[t.id] ?? 50); }).join(''), '会慢慢变')}
  </div><div class="g2">
    ${card('成长记录', growth.length ? li(growth.map((g) => `<span>${esc(g.traitName)} ${g.delta > 0 ? '+' : ''}${g.delta} · ${esc(g.reason)}</span><em>${g.undone ? '已撤销' : `<button class="btn" data-undo="${esc(g.id)}">撤销</button>`}</em>`)) : nothing('和她相处一段时间后，这里会记下她因为什么变了一点点。'), '可以撤销')}
    ${card('兴趣和边界', (p.interests || []).slice().sort((a, b) => b.strength - a.strength).slice(0, 8).map((i) => `<div class="intr"><span>${esc(i.topic)}</span><div class="tr"><i style="width:${Math.max(0, Math.min(100, i.strength))}%"></i></div><b>${Math.round(i.strength)}</b></div>`).join('') + '<div class="t mt"><span>边界 · 成长不会改写</span></div>' + (p.bounds || []).map((x) => `<span class="chip">${esc(x)}</span>`).join(''))}
  </div>` + (p.values?.length ? card('她自己的想法', p.values.map((x) => `<p class="value">“${esc(x.text)}”</p>`).join('')) : '');
  el.querySelectorAll('[data-undo]').forEach((b) => b.addEventListener('click', async () => { await ctx.fish.undoGrowth(b.dataset.undo); ctx.toast('已撤销这次偏移'); }));
}

function memory(el, ctx) {
  const { S } = ctx;
  const names = S.memory.layerNames || {};
  const records = (S.memory.records || []).filter((r) => !r.archived);
  const layers = ['全部', ...(S.memory.layers || [])];
  const list = records.filter((r) => (layerFilter === '全部' || r.layer === layerFilter) && r.text.includes(query)).sort((a, b) => b.at - a.at);
  const byLayer = (S.memory.layers || []).map((l, i) => ({ name: names[l] || l, value: records.filter((r) => r.layer === l).length, color: LAYER_COLORS[i % LAYER_COLORS.length] })).filter((x) => x.value);
  const strength = ['0–20', '20–40', '40–60', '60–80', '80–100'].map((label, i) => ({ label, value: records.filter((r) => Math.min(4, Math.floor((r.strength || 0) * 5)) === i).length, color: i < 1 ? C.amber : C.cyan }));
  const day0 = new Date().setHours(0, 0, 0, 0);
  const recent = Array.from({ length: 14 }, (_, i) => { const t = day0 - (13 - i) * DAY; const d = new Date(t); return { label: i % 2 ? '' : `${d.getMonth() + 1}/${d.getDate()}`, title: `${d.getMonth() + 1}月${d.getDate()}日`, value: records.filter((r) => r.at >= t && r.at < t + DAY).length, color: C.violet }; });
  const charts = records.length ? `<div class="g3 wide1">
    ${card('记在哪一层', donut(byLayer, String(records.length), '条记忆'), `${byLayer.length} 层`)}
    ${card('记得有多牢', bars(strength, { height: 96, unit: ' 条' }) + '<div class="cap">强度低于 20% 的快要忘了，想起一次就会变牢</div>', '强度分布')}
    ${card('最近 14 天', bars(recent, { height: 96, unit: ' 条' }) + '<div class="cap">每天新记住了几件事</div>', '新记忆')}
  </div>` : '';
  el.innerHTML = charts + `<div class="p bar-row"><input id="memQ" placeholder="搜索记忆" aria-label="搜索记忆" value="${esc(query)}">${layers.map((x) => `<button class="chip ${x === layerFilter ? 'on' : ''}" data-layer="${esc(x)}">${esc(names[x] || x)}</button>`).join('')}</div>` +
    card('记忆', list.length ? list.map((r) => `<div class="li mem-li"><span>${esc(r.text)}</span><em>${esc(names[r.layer] || r.layer)} · ${STAGE[r.stage] || ''} · 强度 ${Math.round((r.strength || 0) * 100)}% · ${fmtTime(r.at)}</em><span class="acts"><button class="btn" data-edit="${esc(r.id)}">改</button><button class="btn" data-forget="${esc(r.id)}">忘掉</button><button class="btn" data-delete="${esc(r.id)}">删除</button></span></div>`).join('') : nothing('没有找到。'), `${list.length} 条`);
  const input = el.querySelector('#memQ');
  input.addEventListener('input', () => {
    query = input.value;
    memory(el, ctx);
    const i = el.querySelector('#memQ');
    i.focus();
    i.setSelectionRange(i.value.length, i.value.length);
  });
  el.querySelectorAll('[data-layer]').forEach((b) => b.addEventListener('click', () => { layerFilter = b.dataset.layer; memory(el, ctx); }));
  el.querySelectorAll('[data-forget]').forEach((b) => b.addEventListener('click', () => { ctx.fish.forget(b.dataset.forget); ctx.toast('已移进归档，可以再恢复'); }));
  el.querySelectorAll('[data-delete]').forEach((b) => b.addEventListener('click', () => { if (confirm('彻底删掉这条记忆？删了就找不回来了。')) ctx.fish.deleteMemory(b.dataset.delete); }));
  el.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => {
    const rec = records.find((r) => r.id === b.dataset.edit);
    const text = prompt('改一下她记着的内容：', rec?.text || '');
    if (text && text.trim() && text.trim() !== rec?.text) ctx.fish.editMemory(b.dataset.edit, text.trim());
  }));
}

function emotion(el, { S }) {
  const v = S.vitals;
  const p = v.mind.pad;
  const days = new Map();
  for (const x of v.vitals || []) {
    const k = new Date(x.t).toDateString();
    const d = days.get(k) || { sum: 0, n: 0 };
    d.sum += x.mood; d.n += 1;
    days.set(k, d);
  }
  const avg = [...days.values()].slice(-30).map((d) => d.sum / d.n);
  const cells = Array.from({ length: 30 }, (_, i) => avg[i - (30 - avg.length)]);
  const color = (m) => (m == null ? 'rgba(127,178,255,.06)' : m >= 50 ? `rgba(79,214,255,${0.15 + ((m - 50) / 50) * 0.7})` : `rgba(245,194,66,${0.15 + ((50 - m) / 50) * 0.7})`);
  const trail = (v.vitals || []).filter((x) => Number.isFinite(x.mood) && Number.isFinite(x.arousal)).slice(-90).map((x) => ({ P: (x.mood - 50) / 50, A: (x.arousal - 50) / 50 }));
  const moodNow = Math.round(p.P * 50 + 50);
  el.innerHTML = lead(p.label, `思考状态：${v.mind.thinking}`) + `<div class="g2">
    ${card('情绪平面', affectPlane({ P: p.P, A: p.A, label: p.label, trail }), '点是现在，线是最近走过的路')}
    ${card('情绪的三个维度', `<div class="rings">${ring({ label: '愉悦', value: (p.P + 1) * 50, sub: '开心还是难过', color: C.cyan })}${ring({ label: '唤醒', value: (p.A + 1) * 50, sub: '兴奋还是平静', color: C.amber })}${ring({ label: '掌控', value: (p.D + 1) * 50, sub: '有底气还是无助', color: C.violet })}</div><div class="t mt"><span>为什么是这个心情</span></div>` + causeList(v.body, 4, 'mood'))}
  </div>` +
    card('心情的变化', timeChart({ series: [{ name: '愉悦', pts: hist(v, 'mood'), cur: moodNow, color: C.cyan }, { name: '陪伴', pts: hist(v, 'social'), cur: v.state.social, color: C.pink }], min: 0, max: 100, lines: [{ v: 35, label: '愉悦低于 35 算低落' }], height: 150 }), '陪伴少了，心情会跟着掉') +
    card('最近 30 天的心情', `<div class="cal2">${cells.map((m) => `<i style="background:${color(m)}">${m == null ? '' : Math.round(m)}</i>`).join('')}</div><div class="f mt"><span>黄色：低落</span><span>格子里是当天的平均愉悦</span><span>蓝色：开心</span></div>`);
}

function ocean(el, ctx) {
  el.innerHTML = '<div class="stage-host full" data-stage></div>';
  ctx.gl.attachStage(el.querySelector('[data-stage]'), 'ocean');
}

const TABS = { ocean, thoughts, persona, memory, emotion };
export function render(el, tab, ctx) {
  TABS[tab](el, ctx);
}
