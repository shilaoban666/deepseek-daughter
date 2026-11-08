// 驱力与想法队列（设计文档 §8）
//
// 每次心跳算一遍所有驱力的冲动值：冲动 = 缺口 × 性格权重 × 情绪调节。
// 冲动最高且超过阈值的那一个会冒出一个“想法”，进入想法队列。
// 日常行为（饿了去吃、困了去睡）由规则直接给出，不调用大模型。

const config = require('./config');
const persona = require('./persona-model');

const clamp01 = (v) => Math.max(0, Math.min(1, v));
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

const DEFS = [
  {
    id: 'physio',
    name: '生理',
    hint: '吃饱、睡够',
    weights: { stability: -0.5, conscientiousness: 0.2 },
    gap: ({ body, state }) => Math.max(1 - state.satiety / 100, 1 - state.energy / 100, (100 - body.hydration) / 100 * 0.9),
  },
  {
    id: 'social',
    name: '社交',
    hint: '有人陪、被回应',
    weights: { extraversion: 0.5, agreeableness: 0.2 },
    gap: ({ state, now }) => {
      const hours = state.lastUserAt ? (now - state.lastUserAt) / 3600000 : 8;
      return clamp01(1 - state.social / 100 + (Math.min(hours, 12) / 24) * 0.5);
    },
  },
  {
    id: 'curiosity',
    name: '好奇',
    hint: '去看新东西',
    weights: { openness: 0.6 },
    gap: ({ body, profile, now }) => {
      const sinceDays = (now - (profile.lastContentAt || 0)) / 86400000;
      const recently = sinceDays < 3 ? 1 - sinceDays / 3 : 0;
      const novelty = profile.interests.filter((i) => now - (i.discoveredAt || 0) < 7 * 86400000).length / 5;
      return clamp01(0.22 + (1 - recently) * 0.18 + Math.min(novelty, 1) * 0.15 + (body.nt.dopamine - 40) / 300);
    },
  },
  {
    id: 'competence',
    name: '胜任',
    hint: '把没做完的事做完',
    weights: { conscientiousness: 0.6 },
    gap: ({ profile }) => {
      const goals = profile.goals || [];
      if (!goals.length) return 0.2;
      const avg = goals.reduce((a, g) => a + (1 - clamp(g.progress || 0, 0, 1)), 0) / goals.length;
      return clamp01(0.2 + avg * 0.55);
    },
  },
  {
    id: 'autonomy',
    name: '自主',
    hint: '自己安排一会儿',
    weights: { openness: 0.3, agreeableness: -0.3 },
    gap: ({ state }) => clamp01(0.18 + clamp(state.directives || 0, 0, 5) / 5 * 0.55),
  },
  {
    id: 'expression',
    name: '表达',
    hint: '把想法说出来',
    weights: { extraversion: 0.4, openness: 0.2 },
    gap: ({ body, state }) => clamp01(0.18 + Math.min(body.memoryLoad, 10) * 0.05 + Math.abs(state.mood) * 0.15),
  },
];

/** 性格权重：0.75 是基准，大五人格在 -1..1 之间线性调节 */
function weightOf(def, profile) {
  let w = 0.75;
  for (const [trait, k] of Object.entries(def.weights)) w += k * persona.traitNorm(profile, trait);
  return clamp(w, 0.4, 1.6);
}

/** 情绪调节：心情差的时候冲动更强；不同递质给不同驱力加成 */
function modulation(def, body, state) {
  let mod = 1 + Math.max(0, -state.mood) * 0.35;
  if (def.id === 'social') mod += (body.nt.oxytocin - 40) / 200;
  if (def.id === 'curiosity') mod += (body.nt.dopamine - 40) / 150;
  if (def.id === 'physio') mod += (body.nt.cortisol - 30) / 200;
  if (def.id === 'expression') mod += (body.nt.acetylcholine - 40) / 250;
  return clamp(mod, 0.5, 1.8);
}

/** 规则型行为：饿了吃、困了睡，不需要问大模型 */
function ruleAction(id, { body, state, profile, now }) {
  const topInterest = persona.topInterests(profile, 1)[0]?.topic || '小说';
  const goal = [...(profile.goals || [])].sort((a, b) => (a.progress || 0) - (b.progress || 0))[0];
  switch (id) {
    case 'physio':
      return state.satiety < 40
        ? { type: 'eat', place: '冰箱', label: '去冰箱找点吃的' }
        : { type: 'rest', place: '床', label: '躺一会儿，快困死了' };
    case 'social':
      return { type: 'message', label: '主动找主人说话' };
    case 'curiosity':
      return { type: 'content', place: '床上/书桌', topic: topInterest, label: `去刷一会儿${topInterest}` };
    case 'competence':
      return { type: 'goal', goal: goal?.text || '', label: goal ? `把「${goal.text}」接着做完` : '练一会儿自己的技能' };
    case 'autonomy':
      return { type: 'alone', label: '自己待一会儿，不被打扰' };
    case 'expression':
      return { type: 'share', label: '想跟主人说说今天的事' };
    default:
      return null;
  }
}

/**
 * 算一遍所有驱力。
 * @returns {{urges:Object, values:Object, top:{id:string,value:number}, action:object|null, threshold:number}}
 */
function evaluate({ body, state, profile, now = Date.now() }) {
  const cfg = config.get().drives;
  const threshold = cfg.threshold ?? 45;
  const urges = {};
  for (const def of DEFS) {
    const gap = clamp01(def.gap({ body, state, profile, now }));
    const weight = weightOf(def, profile);
    const mod = modulation(def, body, state);
    const value = Math.round(clamp(gap * weight * mod * 100, 0, 100));
    urges[def.id] = { id: def.id, name: def.name, hint: def.hint, gap: Number(gap.toFixed(3)), weight: Number(weight.toFixed(2)), mod: Number(mod.toFixed(2)), value };
  }
  const values = {};
  for (const [id, u] of Object.entries(urges)) values[id] = u.value;
  const topId = Object.entries(values).sort((a, b) => b[1] - a[1])[0][0];
  const action = ruleAction(topId, { body, state, profile, now });
  return { urges, values, top: { id: topId, value: values[topId] }, action, threshold };
}

/** 把冲动值写回身体，界面和提示词都用这一份 */
function syncBody(body, result) {
  for (const [id, v] of Object.entries(result.values)) body.drives[id] = v;
  body.urges = result.urges;
  return body;
}

/**
 * 想法队列：冲动最高且超过阈值的那一个会冒出一个想法。
 * 刚想过的事有冷静期（同一驱力 2 小时内不重复）；全局也留 10 分钟间隔，
 * 免得一次心跳里冒出好几个想法。睡觉时不想事。
 * @returns {object|null} 新想法
 */
function think({ body, state, profile, now = Date.now() }) {
  const result = evaluate({ body, state, profile, now });
  if (state.asleep) return null;
  const cfg = config.get().drives;
  const threshold = cfg.threshold ?? 45;
  const last = body.thoughts[body.thoughts.length - 1];
  if (last && now - last.at < (cfg.cooldownMinutes ?? 10) * 60000) return null;

  const recently = new Set(body.thoughts.filter((t) => now - t.at < (cfg.repeatMinutes ?? 120) * 60000).map((t) => t.drive));
  const ranked = Object.entries(result.values).sort((a, b) => b[1] - a[1]);
  const pick = ranked.find(([id, v]) => v >= threshold && !recently.has(id));
  if (!pick) return null;
  const [id, value] = pick;
  const def = DEFS.find((d) => d.id === id);
  const action = ruleAction(id, { body, state, profile, now });

  const thought = {
    at: now,
    drive: id,
    value,
    text: thoughtText(id, { body, state, profile, action }),
    action,
  };
  body.thoughts.push(thought);
  if (body.thoughts.length > 12) body.thoughts.splice(0, body.thoughts.length - 12);
  body.drives = result.values;
  body.urges = result.urges;
  return { ...thought, name: def?.name || id };
}

function thoughtText(id, { body, state, profile, action }) {
  const topInterest = persona.topInterests(profile, 1)[0]?.topic || '小说';
  switch (id) {
    case 'physio':
      return state.satiety < state.energy ? '肚子在叫……冰箱里还有布丁吗' : '眼皮好重，想躺一会儿';
    case 'social':
      return '好安静啊，TA 在忙什么呢';
    case 'curiosity':
      return `想去看看${topInterest}，今天会有什么新东西`;
    case 'competence':
      return action?.goal ? `「${action.goal}」还没做完，接着来` : '昨天没做完的事还没做完';
    case 'autonomy':
      return '想自己待一会儿，听听歌';
    case 'expression':
      return `今天攒了好多话想说（${body.memoryLoad} 条还没整理）`;
    default:
      return '……';
  }
}

/** 给提示词用的一句话：她现在最想要什么 */
function urgeText(result) {
  if (!result) return '';
  const top = result.top;
  const def = DEFS.find((d) => d.id === top.id);
  const second = Object.entries(result.values)
    .filter(([id]) => id !== top.id)
    .sort((a, b) => b[1] - a[1])[0];
  const secondDef = DEFS.find((d) => d.id === second[0]);
  return `最想要的是${def?.name || top.id}（${top.value}），其次是${secondDef?.name}（${second[1]}）。`;
}

module.exports = { DEFS, evaluate, think, syncBody, urgeText, ruleAction, weightOf, modulation };
