// 免疫活动：淋巴系统、免疫调节。内容安全对应到三道防线。

import { esc, fmtClock } from '../util.js';
import { card, lead, level, li, nothing } from './ui.js';
import { C, donut, gauge, hist, ring, shields, timeChart } from './charts.js';

function lymph(el, { S }) {
  const b = S.vitals.body;
  const im = b.phys.immune;
  const v = S.vitals;
  const cells = [{ name: '吞噬细胞', value: im.cells.phagocyte, color: C.blue }, { name: 'T 细胞', value: im.cells.tCell, color: C.cyan }, { name: 'B 细胞', value: im.cells.bCell, color: C.green }];
  const temp = Math.round(b.temp * 10) / 10;
  el.innerHTML = lead(b.immunity > 70 ? '免疫系统健康' : '免疫力下降', `免疫 ${Math.round(b.immunity)}`) + `<div class="g2">
    ${card('免疫器官', `<div class="rings">${ring({ label: '骨髓', value: im.organs.marrow, sub: '免疫细胞的来源', color: C.pink })}${ring({ label: '胸腺', value: im.organs.thymus, sub: 'T 细胞成熟', color: C.cyan })}${ring({ label: '脾', value: im.organs.spleen, sub: '过滤血液', color: C.violet })}${ring({ label: '淋巴结', value: im.organs.nodes, sub: b.fever ? '正在战斗，肿大' : '平稳', color: b.fever ? C.amber : C.green })}</div>`, '活跃程度')}
    ${card('免疫细胞', donut(cells, String(Math.round(cells.reduce((s, c) => s + c.value, 0))), '细胞总量'), '三类细胞的占比')}
  </div><div class="g3">
    ${card('免疫力', `<div class="readout"><b>${Math.round(b.immunity)}</b><small>/ 100</small><em class="${b.immunity < 60 ? 'warn' : 'ok'}">${b.immunity < 60 ? '⚠ 抵抗力下降' : '健康'}</em></div>` + timeChart({ series: [{ name: '免疫力', pts: hist(v, 'immunity'), cur: b.immunity, color: C.green }], min: 0, max: 100, lines: [{ v: 60, label: '低于 60 容易生病' }], height: 130 }))}
    ${card('活性物质', level('抗体', im.cells.antibody, 'B 细胞产生，专门对付认识的攻击') + level('细胞因子', im.cells.cytokine, '免疫细胞之间的信号，战斗时升高'))}
    ${card('体温', gauge({ label: '体温', value: temp, min: 35.5, max: 39.5, ...S.meta.reference.temp, unit: '℃', digits: 1, note: b.fever ? '发烧是免疫系统在战斗' : '没有发烧' }))}
  </div>`;
}

const LINE = ['', '第一道防线', '第二道防线', '第三道防线'];
const KIND = { innate: '非特异性', humoral: '体液免疫 · 外来文本', cellular: '细胞免疫 · 已进入记忆' };

function regulation(el, ctx) {
  const b = ctx.S.vitals.body;
  const im = b.phys.immune;
  const events = [...im.events].reverse().slice(0, 6);
  const count = (n) => im.events.filter((e) => e.line === n).length;
  const memory = Object.values(im.memory).sort((x, y) => y.count - x.count);
  const d = im.disorders;
  el.innerHTML = lead(b.fever ? '正在对抗一次操纵' : '防线稳定', '第一道、第二道生来就有，第三道靠经历获得') + `<div class="g2">
    ${card('三道防线', shields([count(1), count(2), count(3)], b.fever), '数字是拦下的次数')}
    ${card('每一道在做什么', li([`<span><b style="color:${C.blue}">第一道</b> 像皮肤和黏膜</span><em>规则直接拦下可疑内容 · ${count(1)} 次</em>`, `<span><b style="color:${C.cyan}">第二道</b> 像吞噬细胞</span><em>陌生人的话只当数据 · ${count(2)} 次</em>`, `<span><b style="color:${C.green}">第三道</b> 特异性免疫</span><em>记住攻击方式，再遇到更快 · ${count(3)} 次</em>`]) + `<div class="rings mt">${ring({ label: '免疫力', value: b.immunity, color: b.immunity < 60 ? C.amber : C.green })}${ring({ label: '抗体', value: im.cells.antibody, color: C.cyan })}${ring({ label: '细胞因子', value: im.cells.cytokine, color: C.violet })}</div>`)}
  </div><div class="g3">
    ${card('三大功能', li([`<span>免疫防御</span><em>${im.stats.defense} 次</em>`, `<span>免疫自稳</span><em>${im.stats.stability} 次</em>`, `<span>免疫监视</span><em>${im.stats.surveillance} 次</em>`]))}
    ${card('记忆细胞', memory.length ? li(memory.map((m) => `<span>${esc(m.label)}</span><em>遇到 ${m.count} 次</em>`)) : nothing('还没遇到过攻击。'))}
    ${card('免疫失调', li([`<span>过敏（误拦）</span><em id="allergy">${d.allergy}</em>`, `<span>自身免疫（误伤记忆）</span><em>${d.autoimmune}</em>`, `<span>免疫缺陷</span><em>${d.deficiency ? '<b class="warn">⚠ 有</b>' : '无'}</em>`]) + '<button class="btn mt" id="fp">最近一次是误拦</button>')}
  </div>` + card('最近事件', events.length ? li(events.map((e) => `<time>${fmtClock(e.at)}</time><span>${esc(e.label)}</span><em>${LINE[e.line]} · ${KIND[e.kind]}</em>`)) : nothing('最近很平静。'));
  el.querySelector('#fp').addEventListener('click', async () => {
    ctx.S.vitals = await ctx.fish.markFalsePositive();
    ctx.toast('记下了：这次是误拦');
    regulation(el, ctx);
  });
}

const TABS = { lymph, regulation };
export function render(el, tab, ctx) {
  TABS[tab](el, ctx);
}
