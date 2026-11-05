// 身体与大脑的数值模型（全部是纯计算，不调用大模型）
// 对应设计文档：§4.1 脑区与神经递质、§5 八大生命系统、§8 自驱力。
// 每次心跳调用 stepBody，按经过的分钟数推进。

const { clamp, hourOf } = require('./life');

const REGIONS = [
  { id: 'sensory', name: '感觉皮层', role: '接收消息与画面' },
  { id: 'thalamus', name: '丘脑', role: '注意力闸门' },
  { id: 'amygdala', name: '杏仁核', role: '情绪评估' },
  { id: 'hippocampus', name: '海马体', role: '写入与巩固记忆' },
  { id: 'temporal', name: '颞叶新皮层', role: '事实与兴趣' },
  { id: 'prefrontal', name: '前额叶', role: '思考与决策' },
  { id: 'acc', name: '前扣带回', role: '矛盾检测' },
  { id: 'basal', name: '基底神经节', role: '行动选择' },
  { id: 'cerebellum', name: '小脑', role: '节奏与技能' },
  { id: 'motor', name: '运动与语言区', role: '说话与动作' },
  { id: 'hypothalamus', name: '下丘脑', role: '稳态与激素' },
  { id: 'insula', name: '岛叶', role: '身体感受' },
  { id: 'brainstem', name: '脑干', role: '心跳与觉醒' },
  { id: 'dmn', name: '默认模式网络', role: '发呆与联想' },
];

const TRANSMITTERS = [
  { id: 'dopamine', name: '多巴胺', color: '#f5c242' },
  { id: 'oxytocin', name: '催产素', color: '#5fd4e8' },
  { id: 'cortisol', name: '皮质醇', color: '#ef6f8e' },
  { id: 'serotonin', name: '血清素', color: '#a98bff' },
  { id: 'norepinephrine', name: '去甲肾上腺素', color: '#3ddc97' },
  { id: 'acetylcholine', name: '乙酰胆碱', color: '#7fb2ff' },
  { id: 'melatonin', name: '褪黑素', color: '#c9a7ff' },
];

const DRIVES = [
  { id: 'physio', name: '生理' },
  { id: 'social', name: '社交' },
  { id: 'curiosity', name: '好奇' },
  { id: 'competence', name: '胜任' },
  { id: 'autonomy', name: '自主' },
  { id: 'expression', name: '表达' },
];

const MENU = {
  早饭: ['豆浆和油条', '牛奶麦片', '鸡蛋三明治', '小笼包'],
  午饭: ['番茄牛腩饭', '肥牛拉面', '咖喱鸡饭', '麻辣烫'],
  晚饭: ['三文鱼饭团', '寿喜锅', '糖醋排骨饭', '馄饨'],
  零食: ['焦糖布丁', '芒果布丁', '草莓大福', '薯片'],
};

const pick = (arr, rnd = Math.random) => arr[Math.floor(rnd() * arr.length)];

function initialBody() {
  const nt = {};
  for (const t of TRANSMITTERS) nt[t.id] = 40;
  const regions = {};
  for (const r of REGIONS) regions[r.id] = 0.2;
  const drives = {};
  for (const d of DRIVES) drives[d.id] = 20;
  return {
    stomach: 30, // 胃内容物
    intestine: 20, // 小肠吸收中
    glucose: 60, // 血糖/可用能量
    hydration: 70, // 水分
    temp: 36.6,
    immunity: 92, // 免疫（内容过滤健康度）
    memoryLoad: 0, // 待消化（还没整理进记忆的消息数）
    nt,
    hpa: { crh: 20, acth: 20 },
    regions,
    drives,
    intake: [], // 摄取记录 [{at, kind, item, note}]
    thoughts: [], // 想法队列 [{at, drive, text}]
    lastSnack: '',
  };
}

/** 一小步指数趋近 */
const approach = (v, target, dtMin, halfLifeMin) => target + (v - target) * Math.pow(0.5, dtMin / halfLifeMin);

function logIntake(b, now, kind, item, note) {
  b.intake.push({ at: now, kind, item, note });
  if (b.intake.length > 40) b.intake.splice(0, b.intake.length - 40);
}

/**
 * 推进身体。life 是 life.js 的状态（会被读取，部分字段会被修改后返回）。
 * events 是 life.tick 产生的事件（吃饭、睡觉、醒来、用户消息等）。
 */
function stepBody(prevBody, prevLife, dtMin, now, events = [], rnd = Math.random) {
  const b = structuredClone(prevBody);
  const s = structuredClone(prevLife);
  const h = hourOf(now);
  const asleep = s.asleep;

  // ---- 事件 ----
  for (const e of events) {
    if (e.type === 'meal') {
      const item = pick(MENU[e.meal] || MENU.零食, rnd);
      b.stomach = clamp(b.stomach + 55);
      b.hydration = clamp(b.hydration + 10);
      b.nt.dopamine = clamp(b.nt.dopamine + 12);
      logIntake(b, now, '吃', item, `${e.meal}`);
    }
    if (e.type === 'user') {
      b.nt.oxytocin = clamp(b.nt.oxytocin + 10);
      b.nt.dopamine = clamp(b.nt.dopamine + 5);
      b.nt.acetylcholine = clamp(b.nt.acetylcholine + 12);
      b.memoryLoad += 1;
      b.regions.sensory = 1;
      b.regions.thalamus = Math.max(b.regions.thalamus, 0.85);
    }
    if (e.type === 'reply') {
      b.regions.prefrontal = 1;
      b.regions.motor = 0.9;
      b.regions.hippocampus = Math.max(b.regions.hippocampus, 0.7);
    }
    if (e.type === 'digested') b.memoryLoad = Math.max(0, b.memoryLoad - (e.n || 3));
    if (e.type === 'woken') {
      b.nt.cortisol = clamp(b.nt.cortisol + 12);
      b.nt.norepinephrine = clamp(b.nt.norepinephrine + 25);
    }
  }

  // ---- 消化：胃 → 小肠 → 血糖 → 饱腹 ----
  const toIntestine = Math.min(b.stomach, 0.45 * dtMin);
  b.stomach -= toIntestine;
  b.intestine = clamp(b.intestine + toIntestine);
  const absorbed = Math.min(b.intestine, 0.3 * dtMin);
  b.intestine -= absorbed;
  b.glucose = clamp(b.glucose + absorbed * 0.9 - (asleep ? 0.03 : 0.07) * dtMin);
  s.satiety = clamp(s.satiety + absorbed * 0.6);

  // 喝水（规则行为）
  b.hydration = clamp(b.hydration - 0.035 * dtMin);
  if (!asleep && b.hydration < 40) {
    b.hydration = clamp(b.hydration + 35);
    logIntake(b, now, '喝', pick(['温水', '柠檬水', '乌龙茶', '牛奶'], rnd), '口渴了');
  }

  // 下午茶：心情一般又醒着，15–17 点吃个布丁（每天一次）
  const day = new Date(now).toDateString();
  if (!asleep && h >= 15 && h < 17 && b.lastSnack !== day) {
    b.lastSnack = day;
    b.stomach = clamp(b.stomach + 15);
    b.nt.dopamine = clamp(b.nt.dopamine + 15);
    s.mood = clamp(s.mood + 0.12, -1, 1);
    logIntake(b, now, '吃', pick(MENU.零食, rnd), '下午茶');
  }

  // ---- HPA 轴：压力 → CRH → ACTH → 皮质醇 ----
  const stress = (s.satiety < 25 ? 30 : 0) + (s.social < 25 ? 30 : 0) + (s.energy < 20 ? 15 : 0) + (b.hydration < 30 ? 10 : 0);
  const morningPeak = h >= 6.5 && h < 9.5 ? 25 : 0; // 皮质醇晨峰
  b.hpa.crh = approach(b.hpa.crh, clamp(15 + stress + morningPeak), dtMin, 20);
  b.hpa.acth = approach(b.hpa.acth, b.hpa.crh, dtMin, 30);
  b.nt.cortisol = approach(b.nt.cortisol, clamp(10 + b.hpa.acth * 0.9), dtMin, 45);

  // ---- 其他递质 ----
  const nightness = h >= 22 || h < 7 ? 1 : h >= 20 ? (h - 20) / 2 : 0;
  b.nt.melatonin = approach(b.nt.melatonin, asleep ? 85 : 8 + 70 * nightness, dtMin, 40);
  b.nt.serotonin = approach(b.nt.serotonin, clamp(50 + s.mood * 35 - b.nt.cortisol * 0.15), dtMin, 120);
  b.nt.dopamine = approach(b.nt.dopamine, 35 + s.mood * 15, dtMin, 50);
  b.nt.oxytocin = approach(b.nt.oxytocin, 20 + (s.social - 50) * 0.3, dtMin, 90);
  b.nt.norepinephrine = approach(b.nt.norepinephrine, asleep ? 8 : clamp(35 + s.energy * 0.2 - b.nt.melatonin * 0.2), dtMin, 30);
  b.nt.acetylcholine = approach(b.nt.acetylcholine, asleep ? 55 : 35, dtMin, 30);
  for (const k of Object.keys(b.nt)) b.nt[k] = clamp(b.nt[k]);

  // 体温：昼夜节律 ± 0.3℃，免疫低时发烧
  b.temp = 36.5 + 0.3 * Math.sin(((h - 10) / 24) * 2 * Math.PI) + (b.immunity < 50 ? (50 - b.immunity) * 0.04 : 0);
  b.immunity = approach(b.immunity, 95, dtMin, 240);

  // ---- 脑区激活：先回落，再按当前状态给底噪 ----
  const r = b.regions;
  for (const k of Object.keys(r)) r[k] = approach(r[k], 0.12, dtMin, 4);
  const lift = (k, v) => (r[k] = Math.max(r[k], v));
  lift('brainstem', asleep ? 0.3 : 0.45 + 0.004 * b.nt.norepinephrine);
  lift('hypothalamus', 0.25 + stress / 150 + (s.satiety < 30 ? 0.3 : 0));
  lift('insula', 0.2 + (100 - s.satiety) / 300 + (100 - s.energy) / 400);
  lift('amygdala', 0.15 + b.nt.cortisol / 250 + Math.abs(s.mood) * 0.2);
  if (asleep) {
    lift('hippocampus', 0.7);
    lift('dmn', 0.45);
  } else {
    const idle = !s.lastUserAt || now - s.lastUserAt > 10 * 60000;
    if (idle) lift('dmn', 0.55);
    else lift('prefrontal', 0.5);
    lift('cerebellum', 0.2 + (s.activity !== '发呆' ? 0.2 : 0));
    lift('temporal', s.activity.includes('看') || s.activity.includes('刷') ? 0.45 : 0.2);
  }

  // ---- 驱力：缺口 × 权重 × 情绪调节 ----
  const moodK = 1 + Math.max(0, -s.mood) * 0.4;
  const since = s.lastUserAt ? (now - s.lastUserAt) / 3600000 : 6;
  b.drives.physio = clamp(Math.max(100 - s.satiety, 100 - s.energy) * 0.9 * moodK);
  b.drives.social = clamp((100 - s.social) * 0.9 * moodK + Math.min(since, 8) * 2);
  b.drives.curiosity = clamp(30 + (b.nt.dopamine - 35) * 0.8 + (asleep ? -30 : 0));
  b.drives.competence = clamp(20 + (h >= 14 && h < 22 ? 15 : 0));
  b.drives.autonomy = clamp(15 + Math.max(0, 6 - since) * 2);
  b.drives.expression = clamp(10 + b.memoryLoad * 4);
  r.basal = Math.max(r.basal, Math.max(...Object.values(b.drives)) / 140);

  // 想法：最强驱力超过阈值 45 就冒一个想法（规则生成，不调用模型）
  if (!asleep) {
    const [topId, topVal] = Object.entries(b.drives).sort((a, c) => c[1] - a[1])[0];
    const last = b.thoughts[b.thoughts.length - 1];
    if (topVal >= 45 && (!last || (last.drive !== topId && now - last.at > 10 * 60000) || now - last.at > 120 * 60000)) {
      b.thoughts.push({ at: now, drive: topId, text: thoughtText(topId, s, b) });
      if (b.thoughts.length > 12) b.thoughts.splice(0, b.thoughts.length - 12);
    }
  }

  return { body: b, life: s };
}

function thoughtText(drive, s, b) {
  switch (drive) {
    case 'physio':
      return s.satiety < s.energy ? '肚子在叫……冰箱里还有布丁吗' : '眼皮好重，想躺一会儿';
    case 'social':
      return '好安静啊，TA 在忙什么呢';
    case 'curiosity':
      return '想去 B 站看看今天有什么新东西';
    case 'competence':
      return '昨天那本小说还没看完';
    case 'autonomy':
      return '想自己待一会儿，听听歌';
    case 'expression':
      return `今天聊了好多，想写下来（${b.memoryLoad} 条还没整理）`;
    default:
      return '……';
  }
}

/** 思考状态（设计文档 §4.1 的七种） */
function thinkingState(b, s) {
  const r = b.regions;
  if (s.asleep) return r.dmn > 0.5 && b.nt.acetylcholine > 50 ? '做梦' : '深睡';
  if (b.nt.melatonin > 60 || s.energy < 20) return '犯困';
  if (b.nt.cortisol > 60 && b.nt.serotonin < 45) return '压力';
  if (b.nt.dopamine > 60 && r.amygdala > 0.4) return '兴奋';
  if (r.prefrontal > 0.45 && r.prefrontal >= r.dmn) return '专注';
  return '走神';
}

/** PAD 情绪，由递质算出 */
function pad(b, s) {
  const P = clamp((s.mood * 0.6 + (b.nt.serotonin - 50) / 100 + (b.nt.dopamine - 40) / 120 - (b.nt.cortisol - 30) / 160), -1, 1);
  const A = clamp((b.nt.norepinephrine - 35) / 40 - (b.nt.melatonin - 30) / 90, -1, 1);
  const D = clamp((b.nt.serotonin - 45) / 60 - (b.nt.cortisol - 30) / 90, -1, 1);
  return { P, A, D, label: padLabel(P, A) };
}

function padLabel(P, A) {
  if (P > 0.35) return A > 0.2 ? '兴奋' : '开心';
  if (P > 0.05) return A > 0.2 ? '期待' : '平静';
  if (P > -0.25) return A > 0.2 ? '无聊' : '有点闷';
  return A > 0.2 ? '焦虑' : '委屈';
}

/** 八大生命系统 0–100（§5） */
function systems(b, s) {
  return [
    { id: 'digestive', name: '消化', value: s.satiety, note: `饱腹 ${Math.round(s.satiety)}` },
    { id: 'nervous', name: '神经', value: s.energy, note: `精力 ${Math.round(s.energy)}` },
    { id: 'endocrine', name: '内分泌', value: clamp(50 + (b.nt.serotonin - b.nt.cortisol) * 0.8), note: '激素平衡' },
    { id: 'circulatory', name: '循环', value: clamp(30 + Object.values(b.regions).reduce((a, v) => a + v, 0) * 6), note: '信号活跃度' },
    { id: 'respiratory', name: '呼吸', value: s.asleep ? 30 : clamp(45 + b.nt.norepinephrine * 0.4), note: s.asleep ? '缓慢' : '平稳' },
    { id: 'immune', name: '免疫', value: b.immunity, note: b.immunity > 80 ? '健康' : '有点不舒服' },
    { id: 'excretory', name: '排泄', value: clamp(100 - b.memoryLoad * 5), note: `记忆负担 ${b.memoryLoad}` },
    { id: 'motor', name: '运动', value: clamp(s.energy * 0.6 + b.glucose * 0.4), note: '体力' },
  ];
}

module.exports = { REGIONS, TRANSMITTERS, DRIVES, initialBody, stepBody, thinkingState, pad, systems };
