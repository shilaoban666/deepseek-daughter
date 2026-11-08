// 代谢活动：消化、呼吸心率、体液、内分泌、泌尿、生殖。每页先给结论，再给数据。

import { esc, fmtClock } from '../util.js';
import { card, flow, lead, level, li, metric, nothing } from './ui.js';
import { sparkline } from './trends.js';

const mmol = (g) => Math.round((3 + g * 0.05) * 100) / 100;
const R = (S) => S.meta.reference;

function digestion(el, { S }) {
  const v = S.vitals;
  const { body: b, state: s } = v;
  const u = v.usageToday;
  const budget = v.budget || { used: 0, limit: 0, ratio: 0 };
  const bal = v.balance;
  const intake = [...(b.intake || [])].reverse().slice(0, 6);
  el.innerHTML = lead(s.satiety < 30 ? '肚子空空' : '消化正常', `今日三餐 ${s.mealsEaten?.list?.length || 0} 次`) +
    card('消化通路', flow([['胃', b.stomach], ['小肠', b.intestine], ['血糖', b.glucose], ['饱腹', s.satiety]])) +
    `<div class="g2">
      ${card('今天吃了', intake.length ? li(intake.map((x) => `<time>${fmtClock(x.at)}</time><span>${esc(x.kind)} ${esc(x.item)}</span><em>${esc(x.note || '')}</em>`)) : nothing('还没吃过东西。到饭点她会自己去吃。'))}
      ${card('饭钱', `<div class="bignum">${bal && !bal.error ? `¥${bal.total.toFixed(2)}` : '—'}</div><div class="dim sm">Token 就是她的饭钱</div>${level('今日预算', Math.min(1, budget.ratio || 0) * 100)}<div class="f"><span>输入 ${u.prompt.toLocaleString()} · 输出 ${u.completion.toLocaleString()}</span><span>调用 ${u.calls} 次</span></div>`, '今日')}
    </div>` + card('血糖', metric('血糖', mmol(b.glucose), R(S).glucose, 2.5, 8, '肝糖原 ' + Math.round(b.phys.liver.glycogen)));
}

function breath(el, { S }) {
  const v = S.vitals;
  const ph = v.body.phys;
  const hr = Math.round(ph.vitals.heartRate);
  el.innerHTML = lead(hr > 100 ? '心跳偏快' : '呼吸心率平稳', ph.autonomic.sympathetic > ph.autonomic.parasympathetic ? '交感神经在起作用' : '副交感神经占优') + `<div class="g2">
    ${card('心率', metric('心率', hr, R(S).heartRate, 40, 130, v.state.asleep ? '睡着时偏低是正常的' : '受交感神经影响'))}
    ${card('呼吸', metric('呼吸', Math.round(ph.vitals.respRate), R(S).respRate, 8, 30, `CO₂ ${Math.round(ph.vitals.co2)}`))}
  </div>` + card('最近的心率', sparkline((v.vitals || []).map((x) => x.hr).filter(Boolean)));
}

function fluid(el, { S }) {
  const { body: b } = S.vitals;
  const f = b.phys.fluid;
  el.innerHTML = lead('内环境稳定是一切的基础', '细胞生活在血浆、组织液、淋巴液构成的环境里') +
    card('细胞外液', `<div class="flow"><div>血浆<b>${f.plasma.toFixed(1)}</b><span class="sm dim">L</span></div><i>⇄</i><div>组织液<b>${f.tissue.toFixed(1)}</b><span class="sm dim">L</span></div><i>→</i><div>淋巴液<b>${f.lymph.toFixed(1)}</b><span class="sm dim">L</span></div><i>→</i><div>回到血浆</div></div>`) +
    `<div class="g3">
      ${card('渗透压', metric('血浆渗透压', Math.round(f.osmolarity), R(S).osmolarity, 700, 840))}
      ${card('酸碱', metric('血浆 pH', Math.round(f.ph * 100) / 100, R(S).ph, 7.2, 7.6, '缓冲作用维持'))}
      ${card('体温', metric('体温', Math.round(b.temp * 10) / 10, R(S).temp, 35.5, 39.5))}
    </div>` + card('水分', level('水分', b.hydration, '偏低时她会自己去喝水'));
}

function endocrine(el, { S }) {
  const { body: b } = S.vitals;
  const h = b.phys.hormones;
  const hormoneT = S.meta.transmitters.filter((t) => t.kind === 'hormone');
  el.innerHTML = lead(b.nt.cortisol > 55 ? '皮质醇偏高，身体在应激' : '激素平衡', '下丘脑 → 垂体 → 靶腺，靶激素反过来抑制前两级') + `<div class="g3">
    ${card('肾上腺轴', flow([['CRH', b.hpa.crh], ['ACTH', b.hpa.acth], ['皮质醇', b.nt.cortisol]]) + '<div class="f mt"><span>负反馈 ↺</span><span>压力</span></div>')}
    ${card('甲状腺轴', flow([['TRH', h.trh], ['TSH', h.tsh], ['甲状腺激素', h.thyroxine]]) + '<div class="f mt"><span>负反馈 ↺</span><span>代谢快慢</span></div>')}
    ${card('血糖调节', level('胰岛素', h.insulin, '降血糖') + level('胰高血糖素', h.glucagon, '升血糖'), `血糖 ${mmol(b.glucose)}`)}
  </div><div class="g3">
    ${card('其他激素', level('肾上腺素', h.adrenaline, '应急') + hormoneT.filter((t) => t.id !== 'cortisol').map((t) => level(t.name, b.nt[t.id], t.role)).join('') + level('生长激素', h.growth, '睡觉时分泌'))}
    ${card('水盐调节', level('抗利尿激素', h.adh, '减少尿量') + level('醛固酮', h.aldosterone, '保钠'))}
    ${card('腺体和作用', li((S.meta.hormones || []).slice(0, 6).map((x) => `<span>${esc(x.name)}</span><em>${esc(x.gland)} · ${esc(x.effect)}</em>`)))}
  </div>`;
}

function urinary(el, { S }) {
  const { body: b } = S.vitals;
  const u = b.phys.urinary;
  el.innerHTML = lead(u.bladder >= 80 ? '想上厕所' : '泌尿正常', '缺水时抗利尿激素升高，尿量减少') + `<div class="g3">
    ${card('尿量', `<div class="bignum">${u.rate.toFixed(1)}</div><div class="dim sm">mL/分</div>`)}
    ${card('膀胱', level('充盈', u.bladder, '满了会去上厕所'))}
    ${card('调节', level('抗利尿激素', b.phys.hormones.adh) + level('醛固酮', b.phys.hormones.aldosterone))}
  </div>` + card('记忆排泄', `<div>还有 <b>${b.memoryLoad}</b> 条经历等着在睡觉时消化</div><div class="dim sm">整理成记忆，没用的就忘掉</div>`);
}

function reproductive(el, { S }) {
  const h = S.vitals.body.phys.hormones;
  el.innerHTML = lead('性腺轴', '只显示激素水平，不进入对话') + `<div class="g2">
    ${card('分级调节', flow([['GnRH', h.gnrh], ['促性腺激素', h.gonadotropin], ['性激素', h.sexHormone]]))}
    ${card('成长阶段', `<div class="bignum sm-num">${esc(S.profile?.stage || '萌芽')}期</div><div class="dim sm">第 ${S.vitals.days || 1} 天 · 随陪伴慢慢成长</div>`)}
  </div>`;
}

const TABS = { digestion, breath, fluid, endocrine, urinary, reproductive };
export function render(el, tab, ctx) {
  TABS[tab](el, ctx);
}
