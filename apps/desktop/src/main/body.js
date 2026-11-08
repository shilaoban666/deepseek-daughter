// 身体与大脑的数值模型（全部是纯计算，不调用大模型）
// 对应设计文档：§4.1 脑区与神经递质、§5 八大生命系统、§8 自驱力。
// 每次心跳调用 stepBody，按经过的分钟数推进。

const { clamp, hourOf } = require('./life');
const neural = require('./neural');
const config = require('./config');
const physiology = require('./physiology');
const { initialPhys } = physiology.H;
const { behavior } = physiology;

const REGIONS = neural.REGIONS;

const TRANSMITTERS = [
  { id: 'dopamine', name: '多巴胺', color: '#f5c242', kind: 'transmitter', effect: 'modulate', role: '想要、期待' },
  { id: 'oxytocin', name: '催产素', color: '#5fd4e8', kind: 'hormone', role: '亲近、安心' },
  { id: 'cortisol', name: '皮质醇', color: '#ef6f8e', kind: 'hormone', role: '压力' },
  { id: 'serotonin', name: '血清素', color: '#a98bff', kind: 'transmitter', effect: 'modulate', role: '情绪稳定' },
  { id: 'norepinephrine', name: '去甲肾上腺素', color: '#3ddc97', kind: 'transmitter', effect: 'modulate', role: '清醒、专注' },
  { id: 'acetylcholine', name: '乙酰胆碱', color: '#7fb2ff', kind: 'transmitter', effect: 'excite', role: '记忆、学习' },
  { id: 'glutamate', name: '谷氨酸', color: '#7dffb8', kind: 'transmitter', effect: 'excite', role: '主要的兴奋性递质' },
  { id: 'gaba', name: 'GABA', color: '#9fd0ff', kind: 'transmitter', effect: 'inhibit', role: '主要的抑制性递质' },
  { id: 'melatonin', name: '褪黑素', color: '#c9a7ff', kind: 'hormone', role: '困意' },
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

function initialBody(now = Date.now()) {
  const nt = {};
  for (const t of TRANSMITTERS) nt[t.id] = 40;
  const drives = {};
  for (const d of DRIVES) drives[d.id] = 20;
  const brain = neural.createState(now);
  return {
    stomach: 30, // 胃内容物
    intestine: 20, // 小肠吸收中
    glucose: 60, // 血糖/可用能量
    hydration: 70, // 水分
    temp: 36.6,
    immunity: 92, // 免疫（内容过滤健康度）
    memoryLoad: 0, // 待消化（还没整理进记忆的消息数）
    tokenFullness: 0, // Token 预算对应的“今天吃进去多少”
    budget: null,
    fever: false,
    nt,
    hpa: { crh: 20, acth: 20 },
    brain, // 脑区状态 + 连接权重 + 信号日志
    regions: { ...brain.act }, // 给界面看的激活值快照
    signals: [],
    lastFired: [],
    drives,
    phys: initialPhys(),
    causes: [], // 因果记录，界面回答「为什么」用
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
 * ctx.budget 是今天的 Token 预算使用情况 {ratio, warnRatio, used, limit}。
 */
function stepBody(prevBody, prevLife, dtMin, now, events = [], rnd = Math.random, ctx = {}) {
  const b = structuredClone(prevBody);
  const s = structuredClone(prevLife);
  const h = hourOf(now);
  const asleep = s.asleep;
  const c = config.get();
  const digestion = c.body.digestion;
  const stressCfg = c.body.stress;

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
    if (e.type === 'threat') {
      // 免疫系统检测到操纵：皮质醇上升、免疫下降，可能“发烧”
      b.nt.cortisol = clamp(b.nt.cortisol + 18 * (e.level || 1));
      b.immunity = clamp(b.immunity - 12 * (e.level || 1));
      b.fever = true;
    }
  }

  // ---- 消化：胃 → 小肠 → 血糖 → 饱腹 ----
  // 饿了会自己去找吃的
  const statesNow = behavior.activeStates(b, s, pad(b, s));
  if (behavior.shouldSnack(statesNow, s, now, b.stomach)) {
    s.lastSnackAt = now;
    b.stomach = clamp(b.stomach + 20);
    logIntake(b, now, '吃', pick(MENU.零食, rnd), '饿了');
    physiology.H.addCause(b, { at: now, from: '肚子饿', to: 'activity', text: '饿了，自己找了点吃的' });
  }
  const digestSpeed = b.phys.psych.chronic > 0 ? 0.85 : 1; // 长期压力让消化变慢
  const toIntestine = Math.min(b.stomach, digestion.stomachToIntestine * digestSpeed * dtMin);
  b.stomach -= toIntestine;
  b.intestine = clamp(b.intestine + toIntestine);
  const absorbed = Math.min(b.intestine, digestion.intestineToGlucose * dtMin);
  b.intestine -= absorbed;
  b.glucose = clamp(b.glucose + absorbed * 0.9 - (asleep ? digestion.glucoseBurnAsleep : digestion.glucoseBurnAwake) * physiology.metabolicRate(b.phys) * dtMin);
  s.satiety = clamp(s.satiety + absorbed * digestion.satietyFromGlucose);

  // 喝水（规则行为）
  b.hydration = clamp(b.hydration - c.body.hydrationPerMin * dtMin);
  if (!asleep && b.hydration < c.life.water.low) {
    b.hydration = clamp(b.hydration + c.life.water.addPercent);
    logIntake(b, now, '喝', pick(['温水', '柠檬水', '乌龙茶', '牛奶'], rnd), '口渴了');
  }

  // 下午茶：心情一般又醒着，15–17 点吃个布丁（每天一次）
  const day = new Date(now).toDateString();
  if (!asleep && h >= c.life.snack.startHour && h < c.life.snack.endHour && b.lastSnack !== day) {
    b.lastSnack = day;
    b.stomach = clamp(b.stomach + 15);
    b.nt.dopamine = clamp(b.nt.dopamine + 15);
    s.mood = clamp(s.mood + 0.12, -1, 1);
    logIntake(b, now, '吃', pick(MENU.零食, rnd), c.life.snack.name);
  }

  // ---- HPA 轴：压力 → CRH → ACTH → 皮质醇 ----
  const stress =
    (s.satiety < stressCfg.hungryBelow ? 30 : 0) +
    (s.social < stressCfg.lonelyBelow ? 30 : 0) +
    (s.energy < stressCfg.tiredBelow ? 15 : 0) +
    (b.hydration < stressCfg.thirstyBelow ? 10 : 0) +
    (b.fever ? 20 : 0) +
    b.phys.psych.stress;
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
  b.nt.glutamate = approach(b.nt.glutamate, asleep ? 28 : clamp(38 + s.energy * 0.12), dtMin, 20);
  b.nt.gaba = approach(b.nt.gaba, asleep ? 68 : clamp(52 - b.nt.norepinephrine * 0.1), dtMin, 20);
  for (const k of Object.keys(b.nt)) b.nt[k] = clamp(b.nt[k]);

  // 体温：昼夜节律 ± 0.3℃，免疫低时发烧
  b.temp = 36.5 + 0.3 * Math.sin(((h - 10) / 24) * 2 * Math.PI) + (b.immunity < 50 ? (50 - b.immunity) * 0.04 : 0);
  const immunity = approach(b.immunity, c.body.immunityBaseline - b.phys.psych.chronic, dtMin, c.body.immunityRecoverHalfLifeMinutes);
  b.immunity = clamp(immunity);
  if (b.immunity > 70) b.fever = false;

  // ---- Token 预算：吃 token 也是吃饭（设计文档 §5 消化系统） ----
  if (ctx.budget) {
    b.budget = { ...ctx.budget };
    b.tokenFullness = clamp((ctx.budget.ratio || 0) * 100);
    const warn = ctx.budget.warnRatio ?? 0.8;
    if ((ctx.budget.ratio || 0) > warn) {
      // 预算快用完：她开始累，而不是突然报错
      s.energy = clamp(s.energy - (ctx.budget.ratio - warn) * 12 * dtMin);
    }
  }

  physiology.step(b, s, dtMin, now, events, { padOf: pad });

  // ---- 脑区：神经信号总线（设计文档 §4.1） ----
  b.brain = neural.normalizeState(b.brain);
  b.regions = { ...b.brain.act };
  const budgetRatio = ctx.budget?.ratio || 0;
  const lifts = {
    brainstem: asleep ? 0.3 : 0.45 + 0.004 * b.nt.norepinephrine,
    hypothalamus: 0.25 + stress / 150 + (s.satiety < 30 ? 0.3 : 0) + budgetRatio * 0.2,
    insula: 0.2 + (100 - s.satiety) / 300 + (100 - s.energy) / 400 + (100 - b.immunity) / 500,
    amygdala: 0.15 + b.nt.cortisol / 250 + Math.abs(s.mood) * 0.2 + budgetRatio * 0.1,
    acc: b.immunity < 60 || b.fever ? 0.62 : 0.2,
  };
  if (asleep) {
    lifts.hippocampus = 0.72;
    lifts.dmn = 0.5;
  } else {
    const idle = !s.lastUserAt || now - s.lastUserAt > 10 * 60000;
    if (idle) lifts.dmn = 0.55;
    else lifts.prefrontal = 0.55;
    lifts.cerebellum = 0.2 + (s.activity !== '发呆' ? 0.2 : 0);
    lifts.temporal = s.activity.includes('看') || s.activity.includes('刷') ? 0.5 : 0.2;
  }
  if (events.some((e) => e.type === 'user')) neural.triggerPath(b.brain, neural.CHAT_PATH, now, 0.95);
  if (events.some((e) => e.type === 'reply')) neural.triggerPath(b.brain, ['prefrontal', 'motor', 'cerebellum'], now, 0.8);
  if (events.some((e) => e.type === 'digested')) neural.triggerPath(b.brain, ['hippocampus', 'temporal', 'prefrontal'], now, 0.7);
  const stepped = neural.step(b.brain, dtMin, now, { lifts, asleep, rnd });
  b.regions = { ...stepped.act };
  b.lastFired = stepped.fired;
  b.signals = b.brain.signals.slice(-20);

  // 驱力由 drives.js 在女儿层算好后写回来（冲动 = 缺口 × 性格权重 × 情绪调节）。
  // 这里只让基底核跟着最强的冲动亮一点：它负责在多个动作里选一个。
  const maxDrive = Math.max(0, ...Object.values(b.drives || {}));
  b.regions.basal = Math.max(b.regions.basal, maxDrive / 140);
  b.brain.act.basal = b.regions.basal;

  return { body: b, life: s };
}

/** 思考状态（设计文档 §4.1 的七种） */
function thinkingState(b, s) {
  return neural.thinking(b.regions, { ...b.nt, energy: s.energy }, s.asleep);
}

/** PAD 情绪，由递质算出 */
function pad(b, s) {
  const P = clamp((s.mood * 0.6 + (b.nt.serotonin - 50) / 100 + (b.nt.dopamine - 40) / 120 - (b.nt.cortisol - 30) / 160), -1, 1);
  const A = clamp((b.nt.norepinephrine - 35) / 40 - (b.nt.melatonin - 30) / 90 + (b.budget?.ratio || 0) * 0.1, -1, 1);
  const D = clamp((b.nt.serotonin - 45) / 60 - (b.nt.cortisol - 30) / 90 - (b.fever ? 0.15 : 0), -1, 1);
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
  const regionSum = Object.values(b.regions).reduce((a, v) => a + v, 0);
  return [
    { id: 'digestive', name: '消化', value: s.satiety, note: `饱腹 ${Math.round(s.satiety)}${b.budget ? ` · Token ${Math.round(b.budget.ratio * 100)}%` : ''}` },
    { id: 'nervous', name: '神经', value: s.energy, note: `精力 ${Math.round(s.energy)}` },
    { id: 'endocrine', name: '内分泌', value: clamp(50 + (b.nt.serotonin - b.nt.cortisol) * 0.8), note: '激素平衡' },
    { id: 'circulatory', name: '循环', value: clamp(20 + regionSum * 5.5), note: '信号活跃度' },
    { id: 'respiratory', name: '呼吸', value: s.asleep ? 30 : clamp(45 + b.nt.norepinephrine * 0.4), note: s.asleep ? '缓慢' : '平稳' },
    { id: 'immune', name: '免疫', value: b.immunity, note: b.fever ? '发烧了，拒绝配合' : b.immunity > 80 ? '健康' : '有点不舒服' },
    { id: 'excretory', name: '排泄', value: clamp(100 - b.memoryLoad * 5), note: `记忆负担 ${b.memoryLoad}` },
    { id: 'motor', name: '运动', value: clamp(s.energy * 0.6 + b.glucose * 0.4), note: '体力' },
  ];
}

module.exports = { REGIONS, TRANSMITTERS, DRIVES, initialBody, stepBody, thinkingState, pad, systems, MENU };
