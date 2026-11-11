// 代谢活动：消化、呼吸心率、体液、内分泌、泌尿、生殖。每页先给结论，再用图说明。

import { esc, fmtClock } from '../util.js';
import { card, lead, level, li, nothing } from './ui.js';
import { C, axis, balance, bladder, dial24, digestTract, fluidTanks, gauge, hist, monitor, ring, timeChart } from './charts.js';

const mmol = (g) => Math.round((3 + g * 0.05) * 100) / 100;
const R = (S) => S.meta.reference;
const MEAL_COLOR = { 吃: C.amber, 喝: C.cyan };
const readout = (value, unit, word, warn) => `<div class="readout"><b>${esc(value)}</b><small>${esc(unit)}</small><em class="${warn ? 'warn' : 'ok'}">${warn ? '⚠ ' : ''}${esc(word)}</em></div>`;
const assess = (x, ref) => (x < ref.low ? '偏低' : x > ref.high ? '偏高' : '');
const startOfDay = () => new Date().setHours(0, 0, 0, 0);

function digestion(el, { S }) {
  const v = S.vitals;
  const { body: b, state: s } = v;
  const u = v.usageToday;
  const budget = v.budget || { used: 0, limit: 0, ratio: 0 };
  const bal = v.balance;
  const today = (b.intake || []).filter((x) => x.at >= startOfDay());
  const intake = [...(b.intake || [])].reverse().slice(0, 5);
  const marks = (b.intake || []).filter((x) => x.kind === '吃').map((x) => ({ t: x.at, label: x.note || x.item, color: C.amber }));
  const glu = mmol(b.glucose);
  const gluWord = assess(glu, R(S).glucose);
  const h = b.phys.hormones;
  el.innerHTML = lead(s.satiety < 30 ? '肚子空空' : '消化正常', `今日三餐 ${s.mealsEaten?.list?.length || 0} 次`) +
    card('消化通路', digestTract({ stomach: b.stomach, intestine: b.intestine, glucose: b.glucose, glucoseText: `${glu} mmol/L`, glucoseWarn: gluWord ? `血糖${gluWord}` : '', glycogen: b.phys.liver.glycogen, satiety: s.satiety }), '食物 → 养分 → 能量') +
    `<div class="g2">
      ${card('饥饿和进食', readout(Math.round(s.satiety), '饱腹', s.satiety < 30 ? '饿了' : s.satiety > 75 ? '饱饱的' : '还行', s.satiety < 30) + timeChart({ series: [{ name: '饱腹', pts: hist(v, 'satiety'), cur: s.satiety, color: C.amber }], min: 0, max: 100, lines: [{ v: 30, label: '低于 30 会饿' }], marks }), '竖线是吃饭')}
      ${card('血糖', readout(glu, 'mmol/L', gluWord || '正常', !!gluWord) + timeChart({ series: [{ name: '血糖', pts: hist(v, 'glucose'), cur: glu, color: C.pink }], band: R(S).glucose, min: 2.8, max: 8, digits: 1, unit: 'mmol/L', marks }), '绿色带是参考范围')}
    </div>
    <div class="g3 wide1">
      ${card('今天吃了', `<div class="split">${dial24(today.map((x) => ({ t: x.at, label: `${x.kind}${x.item}`, color: MEAL_COLOR[x.kind] || C.violet })), Date.now(), `今天 ${today.length} 次`)}<div>${intake.length ? li(intake.map((x) => `<time>${fmtClock(x.at)}</time><span>${esc(x.kind)} ${esc(x.item)}</span><em>${esc(x.note || '')}</em>`)) : nothing('还没吃过东西。到饭点她会自己去吃。')}</div></div>`)}
      ${card('血糖调节', balance({ name: '胰岛素', value: h.insulin, note: '降血糖，存起来', color: C.cyan }, { name: '胰高血糖素', value: h.glucagon, note: '升血糖，放出来', color: C.orange }) + `<div class="cap">肝糖原 ${Math.round(b.phys.liver.glycogen)}% · 两种激素作用相反，一起把血糖稳住</div>`)}
      ${card('饭钱', `<div class="split narrow">${ring({ label: '今日预算', value: Math.min(1, budget.ratio || 0) * 100, text: `${Math.round((budget.ratio || 0) * 100)}%`, color: (budget.ratio || 0) > 0.8 ? C.amber : C.cyan })}<div><div class="bignum">${bal && !bal.error ? `¥${bal.total.toFixed(2)}` : '—'}</div><div class="dim sm">Token 就是她的饭钱</div><div class="f mt"><span>输入 ${u.prompt.toLocaleString()} · 输出 ${u.completion.toLocaleString()}</span></div><div class="f"><span>调用 ${u.calls} 次</span></div></div></div>`, '今日')}
    </div>`;
}

function breath(el, { S }) {
  const v = S.vitals;
  const b = v.body;
  const ph = b.phys;
  const hr = Math.round(ph.vitals.heartRate);
  const rr = Math.round(ph.vitals.respRate);
  const a = ph.autonomic;
  const ref = R(S);
  el.innerHTML = lead(hr > 100 ? '心跳偏快' : '呼吸心率平稳', a.sympathetic > a.parasympathetic ? '交感神经在起作用' : '副交感神经占优') +
    card('监护仪', monitor({ hr, rr, asleep: v.state.asleep, nums: [
      { name: '心率', value: hr, unit: '次/分', ref: `${ref.heartRate.low}–${ref.heartRate.high}`, color: C.green },
      { name: '呼吸', value: rr, unit: '次/分', ref: `${ref.respRate.low}–${ref.respRate.high}`, color: C.cyan },
      { name: 'CO₂', value: Math.round(ph.vitals.co2), unit: 'mmHg', color: C.amber },
      { name: '体温', value: (Math.round(b.temp * 10) / 10).toFixed(1), unit: '℃', color: C.pink },
    ] }), v.state.asleep ? '睡着时偏低是正常的' : '波形按现在的心率和呼吸画') +
    `<div class="g3">
      ${card('心率', gauge({ label: '心率', value: hr, min: 40, max: 130, ...ref.heartRate, unit: '次/分', note: '受交感神经影响' }))}
      ${card('呼吸', gauge({ label: '呼吸', value: rr, min: 8, max: 30, ...ref.respRate, unit: '次/分', note: `CO₂ ${Math.round(ph.vitals.co2)}，高了呼吸会加快` }))}
      ${card('自主神经', balance({ name: '交感', value: a.sympathetic * 100, note: '心跳加快', color: C.orange }, { name: '副交感', value: a.parasympathetic * 100, note: '心跳变慢', color: C.cyan }) + '<div class="mt"></div>' + timeChart({ series: [{ name: '交感', pts: hist(v, 'symp'), cur: a.sympathetic * 100, color: C.orange }, { name: '副交感', pts: hist(v, 'para'), cur: a.parasympathetic * 100, color: C.cyan }], min: 0, max: 100, height: 104 }), '作用通常相反')}
    </div>
    <div class="g2">
      ${card('最近的心率', timeChart({ series: [{ name: '心率', pts: hist(v, 'hr'), cur: hr, color: C.green }], band: ref.heartRate, min: 40, max: 130, unit: '次/分' }))}
      ${card('最近的呼吸', timeChart({ series: [{ name: '呼吸', pts: hist(v, 'rr'), cur: rr, color: C.cyan }], band: ref.respRate, min: 8, max: 30, unit: '次/分' }))}
    </div>`;
}

function fluid(el, { S }) {
  const v = S.vitals;
  const { body: b } = v;
  const f = b.phys.fluid;
  const ref = R(S);
  const temp = Math.round(b.temp * 10) / 10;
  el.innerHTML = lead('内环境稳定是一切的基础', '细胞生活在血浆、组织液、淋巴液构成的环境里') +
    card('细胞外液', fluidTanks(f), `共 ${(f.plasma + f.tissue + f.lymph).toFixed(1)} L`) +
    `<div class="g3">
      ${card('渗透压', gauge({ label: '血浆渗透压', value: Math.round(f.osmolarity), min: 700, max: 840, ...ref.osmolarity, unit: 'kPa', note: '缺水时升高，会觉得渴' }))}
      ${card('酸碱', gauge({ label: '血浆 pH', value: Math.round(f.ph * 100) / 100, min: 7.2, max: 7.6, ...ref.ph, digits: 2, note: '靠缓冲物质维持' }))}
      ${card('体温', gauge({ label: '体温', value: temp, min: 35.5, max: 39.5, ...ref.temp, unit: '℃', digits: 1, note: b.fever ? '发烧了' : '产热和散热平衡' }))}
    </div>
    <div class="g2">
      ${card('水分', readout(Math.round(b.hydration), '%', b.hydration < 40 ? '渴了' : '正常', b.hydration < 40) + timeChart({ series: [{ name: '水分', pts: hist(v, 'hydration'), cur: b.hydration, color: C.cyan }], min: 0, max: 100, lines: [{ v: 40, label: '低于 40 会去喝水' }], unit: '%', marks: (b.intake || []).filter((x) => x.kind === '喝').map((x) => ({ t: x.at, label: x.item, color: C.cyan })) }), '竖线是喝水')}
      ${card('体温变化', readout(temp.toFixed(1), '℃', assess(temp, ref.temp) || '正常', !!assess(temp, ref.temp)) + timeChart({ series: [{ name: '体温', pts: hist(v, 'temp'), cur: temp, color: C.pink }], band: ref.temp, min: 35.5, max: 39.5, digits: 1, unit: '℃' }))}
    </div>`;
}

function endocrine(el, { S }) {
  const v = S.vitals;
  const { body: b } = v;
  const h = b.phys.hormones;
  const hormoneT = S.meta.transmitters.filter((t) => t.kind === 'hormone');
  el.innerHTML = lead(b.nt.cortisol > 55 ? '皮质醇偏高，身体在应激' : '激素平衡', '下丘脑 → 垂体 → 靶腺，靶激素反过来抑制前两级') + `<div class="g3">
    ${card('肾上腺轴', axis([{ organ: '下丘脑', hormone: '分泌 CRH', value: b.hpa.crh }, { organ: '垂体', hormone: '分泌 ACTH', value: b.hpa.acth }, { organ: '肾上腺皮质', hormone: '分泌 皮质醇', value: b.nt.cortisol, color: b.nt.cortisol > 55 ? C.amber : C.cyan }], '作用：应对压力'), b.nt.cortisol > 55 ? '⚠ 应激中' : '压力')}
    ${card('甲状腺轴', axis([{ organ: '下丘脑', hormone: '分泌 TRH', value: h.trh }, { organ: '垂体', hormone: '分泌 TSH', value: h.tsh }, { organ: '甲状腺', hormone: '分泌 甲状腺激素', value: h.thyroxine }], '作用：决定代谢快慢'), '代谢快慢')}
    ${card('血糖调节', gauge({ label: '血糖', value: mmol(b.glucose), min: 2.5, max: 8, ...R(S).glucose, unit: 'mmol/L', digits: 1 }) + balance({ name: '胰岛素', value: h.insulin, note: '降血糖', color: C.cyan }, { name: '胰高血糖素', value: h.glucagon, note: '升血糖', color: C.orange }), '胰岛')}
  </div>` +
    card('一天里的节律', timeChart({ series: [{ name: '皮质醇', pts: hist(v, 'cortisol'), cur: b.nt.cortisol, color: C.amber }, { name: '褪黑素', pts: hist(v, 'melatonin'), cur: b.nt.melatonin, color: C.violet }, { name: '胰岛素', pts: hist(v, 'insulin'), cur: h.insulin, color: C.cyan }], min: 0, max: 100, lines: [{ v: 55, label: '皮质醇高于 55 算应激' }], height: 170 }), '皮质醇早上高，褪黑素晚上高') +
    `<div class="g3">
    ${card('其他激素', level('肾上腺素', h.adrenaline, '应急') + hormoneT.filter((t) => t.id !== 'cortisol').map((t) => level(t.name, b.nt[t.id], t.role)).join('') + level('生长激素', h.growth, '睡觉时分泌'))}
    ${card('水盐调节', level('抗利尿激素', h.adh, '减少尿量') + level('醛固酮', h.aldosterone, '保钠'))}
    ${card('腺体和作用', li((S.meta.hormones || []).slice(0, 6).map((x) => `<span>${esc(x.name)}</span><em>${esc(x.gland)} · ${esc(x.effect)}</em>`)))}
  </div>`;
}

function urinary(el, { S }) {
  const v = S.vitals;
  const { body: b } = v;
  const u = b.phys.urinary;
  const h = b.phys.hormones;
  el.innerHTML = lead(u.bladder >= 80 ? '想上厕所' : '泌尿正常', '缺水时抗利尿激素升高，尿量减少') + `<div class="g3">
    ${card('膀胱', bladder(u.bladder) + `<div class="cap" style="text-align:center">${u.bladder >= 80 ? '<span class="warn">⚠ 快满了，要去上厕所</span>' : '满 80% 会去上厕所'}</div>`, '充盈')}
    ${card('尿量', readout(u.rate.toFixed(1), 'mL/分', u.rate < 0.6 ? '在省水' : '正常', false) + level('抗利尿激素', h.adh, '高了尿就少') + level('醛固酮', h.aldosterone, '保钠，也保水') + level('水分', b.hydration, '缺水时身体会少排尿'), '肾')}
    ${card('记忆排泄', `<div class="split narrow">${ring({ label: '待消化', value: Math.min(100, b.memoryLoad * 5), text: String(b.memoryLoad), color: b.memoryLoad > 15 ? C.amber : C.violet })}<div><div>还有 <b>${b.memoryLoad}</b> 条经历等着在睡觉时消化</div><div class="dim sm">整理成记忆，没用的就忘掉</div></div></div>`)}
  </div>` + card('膀胱充盈的变化', timeChart({ series: [{ name: '膀胱', pts: hist(v, 'bladder'), cur: u.bladder, color: '#e8c860' }], min: 0, max: 100, unit: '%', lines: [{ v: 80, label: '到 80 去上厕所' }] }), '掉下去的那一下是上了厕所');
}

function reproductive(el, { S }) {
  const h = S.vitals.body.phys.hormones;
  const stages = ['萌芽', '成长', '独立'];
  const stage = S.profile?.stage || '萌芽';
  el.innerHTML = lead('性腺轴', '只显示激素水平，不进入对话') + `<div class="g2">
    ${card('分级调节', axis([{ organ: '下丘脑', hormone: '分泌 GnRH', value: h.gnrh }, { organ: '垂体', hormone: '分泌 促性腺激素', value: h.gonadotropin }, { organ: '性腺', hormone: '分泌 性激素', value: h.sexHormone, color: C.pink }], '作用：生长发育'))}
    ${card('成长阶段', `<div class="bignum sm-num">${esc(stage)}期</div><div class="dim sm">第 ${S.vitals.days || 1} 天 · 随陪伴慢慢成长</div><div class="rings mt">${[['GnRH', h.gnrh, C.cyan], ['促性腺激素', h.gonadotropin, C.blue], ['性激素', h.sexHormone, C.pink], ['生长激素', h.growth, C.green]].map(([n, x, c]) => ring({ label: n, value: x, color: c })).join('')}</div>${stages.includes(stage) ? `<div class="cap">${stages.map((x) => (x === stage ? `<b class="ok">${x}期</b>` : `${x}期`)).join(' → ')}</div>` : ''}`)}
  </div>`;
}

const TABS = { digestion, breath, fluid, endocrine, urinary, reproductive };
export function render(el, tab, ctx) {
  TABS[tab](el, ctx);
}
