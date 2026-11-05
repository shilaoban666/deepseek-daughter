// 生命状态页：深色 HUD 仪表盘。卡片骨架只建一次，之后每次心跳更新数值；
// 消化通路、分级调节、昼夜节律、生命曲线是 canvas，页面可见时逐帧绘制。

import { esc, fmtClock, fmtDur, fitCanvas } from './util.js';

const C = {
  cyan: '#4fd6ff', blue: '#7fb2ff', amber: '#f5c242', pink: '#ef6f8e', violet: '#a98bff', green: '#3ddc97', orange: '#f0a35e',
  line: 'rgba(120,170,255,0.14)', dim: '#7d8ca6', faint: '#4b5873', text: '#d8e4f5',
};

let root = null;
let S = null;
let raf = 0;

const SERIES = [
  ['satiety', '饱腹', C.amber],
  ['energy', '精力', C.green],
  ['social', '陪伴', C.cyan],
  ['mood', '愉悦', C.pink],
  ['cortisol', '皮质醇', C.orange],
  ['oxytocin', '催产素', C.violet],
];

function skeleton() {
  root.innerHTML = `
  <div class="card c4"><h3>小鲸鱼 <em>状态在线显示</em><span class="tag" id="lv-stage">萌芽期</span></h3>
    <div class="profile">
      <div class="holo"><svg viewBox="0 0 40 40"><use href="#whale"/></svg></div>
      <div><h2>小鲸鱼</h2><div class="online" id="lv-online">● 在线</div><div class="doing" id="lv-doing">—</div><div class="dim" id="lv-mood">—</div></div>
    </div>
  </div>
  <div class="card c3"><h3>运行 <em>uptime</em></h3><dl class="kv" id="lv-run"></dl></div>
  <div class="card c5"><h3>生命曲线 <em>最近 6 小时</em></h3><canvas class="chart" id="lv-chart"></canvas><div class="legend">${SERIES.map(([, n, c]) => `<span><i style="background:${c}"></i>${n}</span>`).join('')}</div></div>

  <div class="card c4"><h3>事物摄取记录</h3><div id="lv-intake"></div></div>
  <div class="card c4"><h3>体内环境</h3><dl class="kv" id="lv-env"></dl></div>
  <div class="card c4"><h3>TOKEN <em>钱包</em><span class="tag" id="lv-bal-tag">—</span></h3><div id="lv-wallet"></div></div>

  <div class="card c8"><h3>消化 · 代谢 · 排泄 <span class="tag" id="lv-digest-tag">—</span></h3><canvas class="chart" id="lv-digest"></canvas></div>
  <div class="card c4"><h3>神经递质 <em>/ 激素</em></h3><div id="lv-nt"></div></div>

  <div class="card c5"><h3>分级调节 <em>下丘脑 – 垂体 – 肾上腺</em><span class="tag" id="lv-hpa-tag">—</span></h3>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;align-items:center"><canvas class="chart" id="lv-hpa"></canvas><div id="lv-hpa-bars"></div></div></div>
  <div class="card c3"><h3>昼夜节律</h3><canvas class="chart" id="lv-clock"></canvas></div>
  <div class="card c4"><h3>驱力 <em>冲动值 · 阈值 45</em></h3><div id="lv-drives"></div></div>

  <div class="card c12"><h3>八大生命系统</h3><div class="sys-grid" id="lv-sys"></div></div>`;
  root.dataset.built = '1';
}

const bar = (name, val, color, extra = '') =>
  `<div class="bar"><span>${esc(name)}</span><div class="track">${extra}<div class="fill" style="width:${Math.max(0, Math.min(100, val))}%;background:${color};box-shadow:0 0 8px ${color}"></div></div><span class="num">${Math.round(val)}</span></div>`;

function stage(days) {
  if (days < 30) return '萌芽期';
  if (days < 120) return '成长期';
  return '独立期';
}

function update() {
  const v = S.vitals;
  if (!v) return;
  const s = v.state, b = v.body, m = v.mind;
  const $ = (id) => root.querySelector('#' + id);

  const firstAt = S.history[0]?.at;
  const days = firstAt ? Math.floor((Date.now() - firstAt) / 86400000) + 1 : 1;
  $('lv-stage').textContent = `${stage(days)} · 第 ${days} 天`;
  $('lv-online').innerHTML = s.asleep ? '<span style="color:#a98bff">● 睡眠中</span>' : '● 在线';
  $('lv-doing').textContent = s.asleep ? '在被窝里睡觉' : `正在${s.activity}`;
  $('lv-mood').textContent = `心情 ${m.pad.label} · ${m.thinking}`;

  const resp = s.asleep ? 12 : Math.round(14 + b.nt.norepinephrine / 8);
  $('lv-run').innerHTML = `
    <dt>运行</dt><dd>${fmtDur(v.uptimeMs)}</dd>
    <dt>心跳</dt><dd>${v.beats} 次 · 60s</dd>
    <dt>模式</dt><dd>LIVE · 本地</dd>
    <dt>状态</dt><dd class="ok">● ${s.asleep ? '休眠' : '在线'}</dd>
    <dt>呼吸</dt><dd>${resp} 次/分</dd>
    <dt>体温</dt><dd>${b.temp.toFixed(1)}℃</dd>
    <dt>大模型</dt><dd>${esc(S.settings.model || '—')}</dd>`;

  const last = b.intake[b.intake.length - 1];
  const lastEat = [...b.intake].reverse().find((x) => x.kind === '吃');
  const lastDrink = [...b.intake].reverse().find((x) => x.kind === '喝');
  $('lv-intake').innerHTML = last
    ? `<div class="intake-now"><span class="k">${esc(last.kind)}到</span>${esc(last.item)} <span class="dim mono" style="font-size:12px">· ${fmtClock(last.at)}</span></div>
       <div class="dim" style="font-size:12px">最近吃到：${esc(lastEat?.item || '—')}　最近喝到：${esc(lastDrink?.item || '—')}</div>
       <ul class="intake-list">${[...b.intake].reverse().slice(0, 8).map((x) => `<li><span class="mono">${fmtClock(x.at)}</span><span>${esc(x.kind)}</span><b>${esc(x.item)}</b><span>${esc(x.note || '')}</span></li>`).join('')}</ul>`
    : '<div class="empty">还没吃过东西。到饭点她会自己去吃。</div>';

  $('lv-env').innerHTML = `
    <dt>胃</dt><dd>${Math.round(b.stomach)}%</dd>
    <dt>小肠</dt><dd>${Math.round(b.intestine)}%</dd>
    <dt>血糖 / 能量</dt><dd>${Math.round(b.glucose)}</dd>
    <dt>水分</dt><dd>${Math.round(b.hydration)}%</dd>
    <dt>饱腹</dt><dd>${Math.round(s.satiety)}</dd>
    <dt>精力</dt><dd>${Math.round(s.energy)}</dd>
    <dt>体温</dt><dd>${b.temp.toFixed(1)}℃</dd>
    <dt>免疫</dt><dd>${Math.round(b.immunity)}</dd>
    <dt>记忆负担</dt><dd>${b.memoryLoad} 条待消化</dd>`;

  const bal = v.balance;
  const u = v.usageToday;
  let tag = '未连接', main = '—', note = '去「链接」里填 DeepSeek API Key';
  if (bal && !bal.error) {
    main = bal.total.toFixed(2);
    tag = bal.available ? '可用' : '不可用';
    note = bal.total > 50 ? '饭钱还够 · 安心' : bal.total > 10 ? '饭钱不多了 · 该省着点吃' : '快没饭钱了 · 有点生存压力';
  } else if (bal?.error) {
    tag = '查询失败';
    note = bal.error;
  }
  $('lv-bal-tag').textContent = tag;
  $('lv-wallet').innerHTML = `
    <div class="big">${main}<small>${bal && !bal.error ? '元' : ''}</small></div>
    <div class="dim" style="font-size:12px;margin:2px 0 10px">${esc(note)}</div>
    <dl class="kv"><dt>今日输入</dt><dd>${u.prompt.toLocaleString()} tokens</dd><dt>今日输出</dt><dd>${u.completion.toLocaleString()} tokens</dd><dt>今日调用</dt><dd>${u.calls} 次</dd></dl>
    <div class="faint" style="font-size:11px;margin-top:8px">余额就是她的饭钱。低于 10 元时她会觉得有生存压力。</div>`;

  $('lv-digest-tag').textContent = `今日三餐 ${s.mealsEaten?.list?.length || 0} 次 · 代谢 ${(0.5 + b.glucose / 120).toFixed(2)}x`;
  $('lv-nt').innerHTML = S.meta.transmitters.map((t) => bar(t.name, b.nt[t.id], t.color)).join('') + `<div class="faint" style="font-size:11px;margin-top:6px">${esc(ntHint(b))}</div>`;
  $('lv-hpa-tag').textContent = b.nt.cortisol > 55 ? '皮质醇偏高' : b.hpa.crh > 40 ? '轻度压力' : '平稳';
  $('lv-hpa-bars').innerHTML = bar('CRH', b.hpa.crh, C.pink) + bar('ACTH', b.hpa.acth, C.amber) + bar('皮质醇', b.nt.cortisol, C.orange) + bar('褪黑素', b.nt.melatonin, C.violet) + bar('催产素', b.nt.oxytocin, C.cyan);

  const thr = '<div style="position:absolute;left:45%;top:-2px;bottom:-2px;width:1px;background:#ef6f8e;opacity:.7"></div>';
  $('lv-drives').innerHTML =
    S.meta.drives.map((d) => bar(d.name, b.drives[d.id], b.drives[d.id] >= 45 ? C.pink : C.blue, thr)).join('') +
    `<div class="faint" style="font-size:11px;margin-top:6px">最强的驱力超过阈值时会冒出一个想法，见「思考记忆」页的想法队列。</div>`;

  const sysColor = [C.amber, C.green, C.violet, C.cyan, C.blue, C.green, C.orange, C.pink];
  $('lv-sys').innerHTML = m.systems
    .map((x, i) => `<div class="sys"><div class="n">${esc(x.name)}系统</div><div class="v mono" style="color:${sysColor[i]}">${Math.round(x.value)}</div><div class="note">${esc(x.note)}</div><div class="track"><div class="fill" style="width:${x.value}%;background:${sysColor[i]}"></div></div></div>`)
    .join('');
}

function ntHint(b) {
  const top = Object.entries(b.nt).sort((a, c) => c[1] - a[1])[0][0];
  return (
    {
      melatonin: '褪黑素高：困了，准备睡觉。',
      cortisol: '皮质醇高：有压力，容易委屈。',
      oxytocin: '催产素高：刚和你聊过，很安心。',
      dopamine: '多巴胺高：有点兴奋，想做点什么。',
      serotonin: '血清素高：情绪稳定。',
      norepinephrine: '去甲肾上腺素高：很清醒。',
      acetylcholine: '乙酰胆碱高：记东西特别牢。',
    }[top] || ''
  );
}

// ---------- canvas ----------
function drawChart(t) {
  const c = root.querySelector('#lv-chart');
  const { g, w, h } = fitCanvas(c, 150);
  g.clearRect(0, 0, w, h);
  g.strokeStyle = C.line;
  g.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const y = 6 + ((h - 18) * i) / 4;
    g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke();
  }
  const data = S.vitals.vitals;
  if (data.length < 2) {
    g.fillStyle = C.faint;
    g.font = '12px sans-serif';
    g.fillText('数据积累中，每分钟采样一次', 10, h / 2);
    return;
  }
  const t1 = data[data.length - 1].t, t0 = t1 - 6 * 3600000;
  const X = (tt) => ((tt - t0) / (t1 - t0)) * w;
  const Y = (v) => 6 + (h - 18) * (1 - v / 100);
  for (const [key, , color] of SERIES) {
    g.strokeStyle = color;
    g.lineWidth = 1.6;
    g.shadowColor = color;
    g.shadowBlur = 6;
    g.beginPath();
    let started = false;
    for (const p of data) {
      if (p.t < t0) continue;
      const x = X(p.t), y = Y(p[key] ?? 0);
      started ? g.lineTo(x, y) : g.moveTo(x, y);
      started = true;
    }
    g.stroke();
  }
  g.shadowBlur = 0;
  g.fillStyle = C.faint;
  g.font = '10px Consolas, monospace';
  for (let i = 0; i <= 6; i++) {
    const tt = t0 + (i * (t1 - t0)) / 6;
    const label = fmtClock(tt);
    g.fillText(label, Math.min(w - 30, Math.max(0, X(tt) - 14)), h - 2);
  }
}

function vessel(g, x, y, w, h, level, color, label, sub, t) {
  // 玻璃容器
  g.strokeStyle = 'rgba(160,200,255,0.35)';
  g.lineWidth = 1.2;
  g.beginPath();
  g.roundRect(x, y, w, h, Math.min(w / 2, 14));
  g.stroke();
  const lv = Math.max(0, Math.min(1, level / 100));
  const top = y + h - h * lv;
  g.save();
  g.beginPath();
  g.roundRect(x + 2, y + 2, w - 4, h - 4, Math.min(w / 2, 12));
  g.clip();
  const grd = g.createLinearGradient(0, top, 0, y + h);
  grd.addColorStop(0, color);
  grd.addColorStop(1, 'rgba(0,0,0,0.2)');
  g.fillStyle = grd;
  g.globalAlpha = 0.75;
  g.beginPath();
  g.moveTo(x, y + h);
  for (let i = 0; i <= w; i += 3) g.lineTo(x + i, top + Math.sin(i * 0.2 + t * 2) * 1.6);
  g.lineTo(x + w, y + h);
  g.fill();
  // 气泡
  g.globalAlpha = 0.6;
  g.fillStyle = '#fff';
  for (let i = 0; i < 4; i++) {
    const by = y + h - ((t * 14 + i * 23) % Math.max(4, h * lv));
    g.beginPath(); g.arc(x + w * (0.25 + 0.17 * i), by, 1.2, 0, 7); g.fill();
  }
  g.restore();
  g.globalAlpha = 1;
  g.fillStyle = C.text;
  g.font = '12px "Microsoft YaHei UI", sans-serif';
  g.textAlign = 'center';
  g.fillText(label, x + w / 2, y + h + 16);
  g.fillStyle = C.dim;
  g.font = '11px Consolas, monospace';
  g.fillText(sub, x + w / 2, y + h + 30);
  g.textAlign = 'left';
}

function drawDigest(t) {
  const c = root.querySelector('#lv-digest');
  const { g, w, h } = fitCanvas(c, 170);
  g.clearRect(0, 0, w, h);
  const b = S.vitals.body, s = S.vitals.state;
  const top = 14, vh = 92;
  const cols = [
    { k: '胃', v: b.stomach, c: C.amber, sub: `${Math.round(b.stomach)}%`, w: 56 },
    null, // 小肠波浪
    { k: '小肠', v: b.intestine, c: C.violet, sub: `${Math.round(b.intestine)}%`, w: 44 },
    { k: '血糖', v: b.glucose, c: C.cyan, sub: `${Math.round(b.glucose)}`, w: 30 },
    { k: '饱腹', v: s.satiety, c: C.green, sub: `${Math.round(s.satiety)}`, w: 30 },
    { k: '水分', v: b.hydration, c: C.blue, sub: `${Math.round(b.hydration)}%`, w: 30 },
    { k: '记忆消化', v: Math.min(100, b.memoryLoad * 10), c: C.pink, sub: `${b.memoryLoad} 条`, w: 30 },
  ];
  const gap = (w - 40 - cols.reduce((a, x) => a + (x ? x.w : 0), 0)) / cols.length;
  let x = 20;
  let waveStart = 0;
  cols.forEach((col, i) => {
    if (!col) {
      waveStart = x;
      x += gap * 1.6;
      // 波浪形肠道 + 流动光点
      const y0 = top + vh / 2;
      g.strokeStyle = 'rgba(245,194,66,0.55)';
      g.lineWidth = 2;
      g.shadowColor = C.amber;
      g.shadowBlur = 8;
      g.beginPath();
      for (let k = 0; k <= x - waveStart; k += 2) g.lineTo(waveStart + k, y0 + Math.sin(k * 0.09) * 12);
      g.stroke();
      g.shadowBlur = 0;
      const flow = b.intestine > 1 || b.stomach > 1;
      for (let p = 0; p < 7 && flow; p++) {
        const k = ((t * 30 + p * 17) % (x - waveStart));
        g.fillStyle = '#ffe6a8';
        g.beginPath(); g.arc(waveStart + k, y0 + Math.sin(k * 0.09) * 12, 2, 0, 7); g.fill();
      }
      g.fillStyle = C.dim;
      g.font = '11px "Microsoft YaHei UI", sans-serif';
      g.textAlign = 'center';
      g.fillText('蠕动吸收', (waveStart + x) / 2, top + vh + 16);
      g.textAlign = 'left';
      return;
    }
    vessel(g, x, top, col.w, vh, col.v, col.c, col.k, col.sub, t + i);
    // 连接箭头
    if (i > 1 && i < cols.length) {
      g.strokeStyle = 'rgba(160,200,255,0.25)';
      g.setLineDash([3, 4]);
      g.beginPath(); g.moveTo(x - gap + 4, top + vh / 2); g.lineTo(x - 4, top + vh / 2); g.stroke();
      g.setLineDash([]);
    }
    x += col.w + gap;
  });
  g.fillStyle = C.faint;
  g.font = '11px "Microsoft YaHei UI", sans-serif';
  g.fillText('胃排空 → 小肠吸收 → 血糖 → 饱腹；聊天内容整理进记忆就是“消化”，忘掉没用的就是“排泄”', 20, h - 4);
}

function drawHPA(t) {
  const c = root.querySelector('#lv-hpa');
  const { g, w, h } = fitCanvas(c, 170);
  g.clearRect(0, 0, w, h);
  const b = S.vitals.body;
  // 星图背景
  for (let i = 0; i < 40; i++) {
    const sx = ((i * 97) % 100) / 100 * w, sy = ((i * 61) % 100) / 100 * h;
    g.fillStyle = `rgba(79,214,255,${0.15 + 0.25 * Math.abs(Math.sin(t + i))})`;
    g.beginPath(); g.arc(sx, sy, 1.2, 0, 7); g.fill();
  }
  g.strokeStyle = 'rgba(79,214,255,0.18)';
  g.beginPath(); g.ellipse(w / 2, h / 2, w * 0.42, h * 0.32, 0, 0, 7); g.stroke();
  g.beginPath(); g.moveTo(w / 2, 8); g.lineTo(w / 2, h - 8); g.stroke();
  const nodes = [
    { n: '下丘脑', x: w / 2, y: 26, v: b.hpa.crh, c: C.pink },
    { n: '垂体', x: w / 2, y: h / 2, v: b.hpa.acth, c: C.amber },
    { n: '肾上腺', x: w / 2, y: h - 26, v: b.nt.cortisol, c: C.orange },
  ];
  // 信号向下传递
  for (let i = 0; i < 2; i++) {
    const a = nodes[i], bb = nodes[i + 1];
    const k = (t * (0.3 + a.v / 120)) % 1;
    g.fillStyle = a.c;
    g.shadowColor = a.c; g.shadowBlur = 10;
    g.beginPath(); g.arc(a.x, a.y + (bb.y - a.y) * k, 3, 0, 7); g.fill();
    g.shadowBlur = 0;
  }
  // 负反馈：皮质醇抑制下丘脑
  g.strokeStyle = 'rgba(239,111,142,0.35)';
  g.setLineDash([3, 4]);
  g.beginPath(); g.moveTo(w / 2 + 34, h - 26); g.quadraticCurveTo(w - 10, h / 2, w / 2 + 34, 26); g.stroke();
  g.setLineDash([]);
  g.fillStyle = C.faint; g.font = '10px sans-serif'; g.fillText('负反馈', w - 44, h / 2 + 4);
  for (const n of nodes) {
    const r = 5 + n.v / 14;
    g.fillStyle = n.c;
    g.shadowColor = n.c; g.shadowBlur = 14;
    g.beginPath(); g.arc(n.x, n.y, r, 0, 7); g.fill();
    g.shadowBlur = 0;
    g.fillStyle = C.text; g.font = '11px "Microsoft YaHei UI", sans-serif';
    g.fillText(n.n, n.x - r - 46, n.y + 4);
  }
}

function drawClock(t) {
  const c = root.querySelector('#lv-clock');
  const { g, w, h } = fitCanvas(c, 190);
  g.clearRect(0, 0, w, h);
  const cx = w / 2, cy = h / 2, R = Math.min(w, h) / 2 - 16;
  const ang = (hr) => (hr / 24) * Math.PI * 2 - Math.PI / 2;
  const arc = (a, b, color, lw = 8) => {
    g.strokeStyle = color; g.lineWidth = lw; g.lineCap = 'round';
    g.beginPath(); g.arc(cx, cy, R, ang(a), ang(b)); g.stroke();
  };
  arc(0, 24, 'rgba(127,178,255,0.1)');
  arc(1, 7.5, C.violet); // 睡眠
  arc(7.5, 13, C.green); // 清醒
  arc(13, 15, C.blue); // 午后低谷
  arc(15, 22, C.cyan); // 活跃
  arc(22, 24.98, 'rgba(169,139,255,0.5)');
  for (const m of [8, 12, 18.5]) {
    g.fillStyle = C.amber;
    g.beginPath(); g.arc(cx + Math.cos(ang(m)) * (R - 14), cy + Math.sin(ang(m)) * (R - 14), 2.5, 0, 7); g.fill();
  }
  const now = new Date();
  const hr = now.getHours() + now.getMinutes() / 60;
  const px = cx + Math.cos(ang(hr)) * R, py = cy + Math.sin(ang(hr)) * R;
  g.fillStyle = '#fff';
  g.shadowColor = C.cyan; g.shadowBlur = 12 + Math.sin(t * 3) * 4;
  g.beginPath(); g.arc(px, py, 5, 0, 7); g.fill();
  g.shadowBlur = 0;
  const phase = hr >= 1 && hr < 7.5 ? '深睡期' : hr < 13 ? '清醒期' : hr < 15 ? '午后低谷' : hr < 22 ? '活跃期' : '入睡准备';
  g.textAlign = 'center';
  g.fillStyle = C.text; g.font = '16px "Microsoft YaHei UI", sans-serif';
  g.fillText(phase, cx, cy - 2);
  g.fillStyle = C.dim; g.font = '11px Consolas, monospace';
  g.fillText(`${fmtClock(now)} · 褪黑素 ${Math.round(S.vitals.body.nt.melatonin)}`, cx, cy + 16);
  g.textAlign = 'left';
}

function loop() {
  raf = 0;
  if (!root || S.view !== 'life' || !S.vitals) return;
  const t = performance.now() / 1000;
  drawChart(t);
  drawDigest(t);
  drawHPA(t);
  drawClock(t);
  raf = requestAnimationFrame(loop);
}

export function renderLife(el, state) {
  root = el;
  S = state;
  if (!root.dataset.built) skeleton();
  update();
  if (!raf) raf = requestAnimationFrame(loop);
}
