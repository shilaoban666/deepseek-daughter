// 脑区层面的神经信号总线（设计文档 §4.1）
//
// 模拟粒度是脑区，不是神经元：每个脑区有一个激活值，收到信号升高，没有信号时按半衰期回落；
// 超过阈值就“放电”，沿连接向下游脑区发出信号。常一起活跃的连接会变强（赫布学习）。
// 所有信号都写日志，界面把日志画成脑区之间飞过的光点。

const config = require('./config');

const REGION_GROUPS = {
  input: { id: 'input', name: '输入与注意', color: '#5fe0ff', hint: '把外面的世界带进来，决定什么值得注意' },
  emotion: { id: 'emotion', name: '情绪与冲突', color: '#ff7fa8', hint: '给经历打情绪标记，发现说错话和自相矛盾' },
  memory: { id: 'memory', name: '记忆', color: '#ffcf6e', hint: '把经历存下来，睡觉时整理成事实和故事' },
  decide: { id: 'decide', name: '思考与决策', color: '#6fffd6', hint: '组织上下文、调用大模型、在几个动作里选一个' },
  action: { id: 'action', name: '行动', color: '#a8f06a', hint: '把决定变成话和动作，控制节奏' },
  homeo: { id: 'homeo', name: '稳态与觉醒', color: '#b79cff', hint: '维持身体、激素、昼夜节律和清醒程度' },
  imagine: { id: 'imagine', name: '联想', color: '#8fb4ff', hint: '发呆时也活跃，把旧记忆拼成新的想法' },
};

const REGIONS = [
  {
    id: 'sensory',
    name: '感觉皮层',
    role: '接收消息与画面',
    group: 'input',
    desc: '接收各个平台的消息、字幕和图片，先拆成统一的“刺激”。同一句话在 QQ 和在 B 站，进来时走的是这里。',
    side: 'back',
  },
  {
    id: 'thalamus',
    name: '丘脑',
    role: '注意力闸门',
    group: 'input',
    desc: '感觉信息的中继站。给每条刺激打一个显著性分数，低于门槛的直接忽略——这样就省下了 Token，也不会被群聊淹没。',
    side: 'core',
  },
  {
    id: 'amygdala',
    name: '杏仁核',
    role: '情绪评估',
    group: 'emotion',
    desc: '快速判断一条信息是好是坏、有没有危险，给经历打上情绪增量。也参与免疫系统：有人想操纵她时，是这里先报警。',
    side: 'core',
  },
  {
    id: 'hippocampus',
    name: '海马体',
    role: '写入与巩固记忆',
    group: 'memory',
    desc: '把经历编码成情景记忆并建立索引；睡觉时回放当天的事，把重要的片段送去长期记忆。',
    side: 'core',
  },
  {
    id: 'temporal',
    name: '颞叶新皮层',
    role: '事实与兴趣',
    group: 'memory',
    desc: '长期存放事实、概念和兴趣图谱，也管语言理解。你说过的“我喜欢猫”“我在准备考试”最后都落在这里。',
    side: 'side',
  },
  {
    id: 'prefrontal',
    name: '前额叶',
    role: '思考与决策',
    group: 'decide',
    desc: '工作记忆、计划、决策和克制。只有需要“意识参与”的时候，它才会组织上下文去调用大模型——这是全脑最费钱的一块。',
    side: 'front',
  },
  {
    id: 'acc',
    name: '前扣带回',
    role: '矛盾检测',
    group: 'emotion',
    desc: '发现冲突和错误：两段记忆互相矛盾、话说不一致之后的自我纠正。它一活跃，往往意味着她在“等等，好像不对”。',
    side: 'front',
  },
  {
    id: 'basal',
    name: '基底神经节',
    role: '行动选择',
    group: 'decide',
    desc: '各驱力产生的想法在这里竞争，只有一个行动能胜出；重复的行为会慢慢变成习惯，不再消耗思考。',
    side: 'core',
  },
  {
    id: 'cerebellum',
    name: '小脑',
    role: '节奏与技能',
    group: 'action',
    desc: '协调动作和节奏：角色的动画、在平台上操作的节奏、学会的工具用法，都靠它变得熟练。',
    side: 'back',
  },
  {
    id: 'motor',
    name: '运动与语言区',
    role: '说话与动作',
    group: 'action',
    desc: '把决定变成真正发出的东西：一条消息、一条评论、一个动作。前额叶想好了，最后由它开口。',
    side: 'front',
  },
  {
    id: 'hypothalamus',
    name: '下丘脑',
    role: '稳态与激素',
    group: 'homeo',
    desc: '维持稳态：饥饿、体温、昼夜节律和内分泌。释放多巴胺、皮质醇这些“激素”，给全脑定调。',
    side: 'core',
  },
  {
    id: 'insula',
    name: '岛叶',
    role: '身体感受',
    group: 'homeo',
    desc: '内感受：把身体数值翻译成“有点饿”“好困”“心里发紧”，再交给前额叶。她嘴上的“我累了”就是这里先感觉到的。',
    side: 'core',
  },
  {
    id: 'brainstem',
    name: '脑干',
    role: '心跳与觉醒',
    group: 'homeo',
    desc: '控制心跳节律和觉醒水平，决定她是清醒、犯困还是睡着。所有脑区都靠它供能。',
    side: 'core',
  },
  {
    id: 'dmn',
    name: '默认模式网络',
    role: '发呆与联想',
    group: 'imagine',
    desc: '闲下来时最活跃：随机唤起旧记忆、整合自我叙事、冒出一个新的好奇。没人和她说话的时候，她就在想这些。',
    side: 'core',
  },
];

const REGION_IDS = REGIONS.map((r) => r.id);

/** 解剖上大致成立的连接，只用单向边，权重都从初始值开始学 */
const CONNECTIONS = [
  ['sensory', 'thalamus'],
  ['thalamus', 'prefrontal'],
  ['thalamus', 'amygdala'],
  ['thalamus', 'temporal'],
  ['amygdala', 'hypothalamus'],
  ['amygdala', 'hippocampus'],
  ['amygdala', 'prefrontal'],
  ['hippocampus', 'temporal'],
  ['hippocampus', 'prefrontal'],
  ['hippocampus', 'dmn'],
  ['temporal', 'prefrontal'],
  ['prefrontal', 'basal'],
  ['prefrontal', 'motor'],
  ['prefrontal', 'acc'],
  ['prefrontal', 'dmn'],
  ['acc', 'prefrontal'],
  ['basal', 'motor'],
  ['basal', 'cerebellum'],
  ['motor', 'cerebellum'],
  ['cerebellum', 'basal'],
  ['hypothalamus', 'brainstem'],
  ['hypothalamus', 'insula'],
  ['insula', 'prefrontal'],
  ['brainstem', 'hypothalamus'],
  ['dmn', 'hippocampus'],
  ['dmn', 'temporal'],
];

const OUTGOING = {};
for (const [a, b] of CONNECTIONS) (OUTGOING[a] ||= []).push(b);

/** 一条消息从进来到回应的主路 */
const CHAT_PATH = ['sensory', 'thalamus', 'amygdala', 'hippocampus', 'prefrontal', 'motor'];

const clamp01 = (v) => Math.max(0, Math.min(1, v));
const edge = (a, b) => `${a}>${b}`;

function cfg() {
  return config.get().neural;
}

/** 新建一份脑区状态（随身体一起持久化） */
function createState(now = Date.now()) {
  const c = cfg();
  const act = {};
  const firedAt = {};
  const weights = {};
  for (const r of REGIONS) {
    act[r.id] = c.activationFloor;
    firedAt[r.id] = 0;
  }
  for (const [a, b] of CONNECTIONS) weights[edge(a, b)] = c.initialWeight;
  return { act, weights, firedAt, signals: [], pending: [], lastFired: [], lastSignalAt: 0, tick: 0, now };
}

/** 兼容旧的存档：缺字段就补上 */
function normalizeState(raw) {
  const base = createState();
  if (!raw || typeof raw !== 'object') return base;
  return {
    ...base,
    ...raw,
    act: { ...base.act, ...(raw.act || {}) },
    weights: { ...base.weights, ...(raw.weights || {}) },
    firedAt: { ...base.firedAt, ...(raw.firedAt || {}) },
    signals: Array.isArray(raw.signals) ? raw.signals.slice(-(cfg().signalLogLimit || 200)) : [],
    pending: Array.isArray(raw.pending) ? raw.pending : [],
    lastFired: Array.isArray(raw.lastFired) ? raw.lastFired : [],
  };
}

function weightOf(state, from, to) {
  const w = state.weights[edge(from, to)];
  return Number.isFinite(w) ? w : cfg().initialWeight;
}

/** 记一条信号。payload 是这条信号带的内容（给界面和调试看） */
function emit(state, from, to, strength = 0.6, payload = null, now = Date.now()) {
  if (!OUTGOING[from]?.includes(to)) return null;
  const sig = { from, to, strength: clamp01(strength), payload, at: now };
  state.pending.push(sig);
  state.signals.push(sig);
  state.lastSignalAt = now;
  const limit = cfg().signalLogLimit || 200;
  if (state.signals.length > limit) state.signals.splice(0, state.signals.length - limit);
  return sig;
}

/** 让一条消息走完整条主路（感觉皮层 → 丘脑 → 杏仁核 → 海马体 → 前额叶 → 语言区） */
function triggerPath(state, path = CHAT_PATH, now = Date.now(), strength = 0.9) {
  for (let i = 0; i < path.length - 1; i++) emit(state, path[i], path[i + 1], strength, { kind: 'path' }, now);
  return path;
}

/** 赫布学习：信号通过时，这条连接变强一点，权重有上限 */
function learn(state, from, to, strength) {
  const c = cfg();
  const k = edge(from, to);
  const w = weightOf(state, from, to);
  const next = Math.min(c.weightCap ?? 2.5, w + (c.learningRate ?? 0.02) * (0.5 + strength));
  state.weights[k] = next;
}

/**
 * 推进一个心跳。
 * @param {object} state 脑区状态（会被修改）
 * @param {number} dtMin 经过的分钟数
 * @param {number} now
 * @param {{lifts?: Object<string, number>, asleep?: boolean, rnd?: () => number}} [ctx]
 *   lifts 是本步由身体状态给出的“底噪”：下丘脑的压力、岛叶的内感受、脑干的觉醒等。
 * @returns {{act:Object<string,number>, fired:string[]}}
 */
function step(state, dtMin, now = Date.now(), ctx = {}) {
  const c = cfg();
  const rnd = ctx.rnd || Math.random;
  state.tick += 1;
  state.now = now;

  // 1. 回落
  const decay = Math.pow(0.5, Math.max(0, dtMin) / (c.decayHalfLifeMinutes || 4));
  for (const id of REGION_IDS) {
    state.act[id] = Math.max(c.activationFloor ?? 0.12, (state.act[id] || 0) * decay);
  }

  // 2. 身体给的底噪（加上一点抖动，免得永远停在一个数上）
  for (const [id, v] of Object.entries(ctx.lifts || {})) {
    if (!(id in state.act)) continue;
    const jitter = (c.noise ?? 0.04) * (rnd() - 0.5) * 2;
    state.act[id] = Math.max(state.act[id], clamp01(v + jitter));
  }

  // 3. 接收上一步发出的信号
  for (const sig of state.pending) {
    const w = weightOf(state, sig.from, sig.to);
    state.act[sig.to] = clamp01((state.act[sig.to] || 0) + sig.strength * w * 0.8);
    learn(state, sig.from, sig.to, sig.strength);
  }
  state.pending = [];

  // 4. 超过阈值就放电
  const fired = [];
  const refractoryMs = (c.refractoryMinutes || 1.5) * 60000;
  for (const r of REGIONS) {
    const act = state.act[r.id];
    if (act < (c.fireThreshold ?? 0.65)) continue;
    if (now - (state.firedAt[r.id] || 0) < refractoryMs) continue;
    fired.push(r.id);
    state.firedAt[r.id] = now;
    state.act[r.id] = act * 0.35; // 放完电回到静息
    for (const to of OUTGOING[r.id] || []) {
      emit(state, r.id, to, Math.max(0.2, act * 0.9), { kind: 'fire' }, now);
    }
  }
  state.lastFired = fired;
  return { act: { ...state.act }, fired };
}

/** 思考状态：各脑区激活的典型组合（设计文档 §4.1 的七种） */
function thinking(act = {}, chemo = {}, asleep = false) {
  const a = (id) => act[id] || 0;
  if (asleep) return a('hippocampus') > 0.55 && a('dmn') > 0.45 ? '做梦' : '深睡';
  if ((chemo.melatonin || 0) > 60 || (chemo.energy || 100) < 20) return '犯困';
  if ((chemo.cortisol || 0) > 60 && (chemo.serotonin ?? 50) < 45) return '压力';
  if ((chemo.dopamine || 0) > 60 && a('amygdala') > 0.4) return '兴奋';
  if (a('prefrontal') > 0.45 && a('prefrontal') >= a('dmn')) return '专注';
  return '走神';
}

/** 当前最活跃的几个脑区，给调试面板用 */
function dominant(act, n = 4) {
  return REGIONS.map((r) => ({ id: r.id, name: r.name, value: act[r.id] || 0 }))
    .sort((a, b) => b.value - a.value)
    .slice(0, n);
}

function snapshot(state) {
  return {
    act: { ...state.act },
    lastFired: [...(state.lastFired || [])],
    signals: state.signals.slice(-24).map((s) => ({ ...s })),
    weights: { ...state.weights },
    learned: CONNECTIONS.filter(([a, b]) => weightOf(state, a, b) > cfg().initialWeight + 0.05).length,
  };
}

module.exports = {
  REGIONS,
  REGION_IDS,
  REGION_GROUPS,
  CONNECTIONS,
  OUTGOING,
  CHAT_PATH,
  createState,
  normalizeState,
  emit,
  triggerPath,
  step,
  thinking,
  dominant,
  snapshot,
  weightOf,
};
