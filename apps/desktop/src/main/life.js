// 女儿的身体与情绪（阶段 1 的最小版本）。
// 全是纯函数：传入状态和时间，返回新状态，方便测试。
// 设计文档里的 14 个脑区、7 种递质、八大系统会在后面逐步替换掉这里的简化模型。

const clamp = (v, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, v));

const MEALS = [
  { h: 8, name: '早饭' },
  { h: 12, name: '午饭' },
  { h: 18.5, name: '晚饭' },
];

function initialState(now = Date.now()) {
  return {
    satiety: 70, // 饱腹 0-100
    energy: 80, // 精力 0-100
    social: 60, // 被陪伴的满足感 0-100，越低越想找人
    mood: 0.2, // 心情 -1..1
    asleep: false,
    lastTick: now,
    lastUserAt: 0,
    lastProactiveAt: 0,
    proactive: { date: '', count: 0 },
    mealsEaten: { date: '', list: [] },
    activity: '发呆',
  };
}

function dateKey(t) {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function hourOf(t) {
  const d = new Date(t);
  return d.getHours() + d.getMinutes() / 60;
}

/** 推进时间。返回 { state, events }，events 是这段时间里发生的事（吃饭、睡着、醒来）。 */
function tick(prev, now = Date.now()) {
  const s = structuredClone(prev);
  const events = [];
  const dtMin = Math.min(Math.max(0, (now - s.lastTick) / 60000), 24 * 60);
  s.lastTick = now;
  const h = hourOf(now);
  const today = dateKey(now);

  // 消耗与恢复
  s.satiety = clamp(s.satiety - 0.07 * dtMin);
  s.social = clamp(s.social - 0.04 * dtMin);
  s.energy = clamp(s.asleep ? s.energy + 0.22 * dtMin : s.energy - 0.06 * dtMin);
  // 心情向基线回落（半衰期约 3 小时）
  const baseline = 0.15 + (s.satiety < 25 ? -0.25 : 0) + (s.social < 25 ? -0.2 : 0) + (s.energy < 20 ? -0.15 : 0);
  s.mood = baseline + (s.mood - baseline) * Math.pow(0.5, dtMin / 180);

  // 一日三餐（规则行为，不调用大模型）
  if (s.mealsEaten.date !== today) s.mealsEaten = { date: today, list: [] };
  if (!s.asleep) {
    for (const meal of MEALS) {
      if (h >= meal.h && h < meal.h + 2 && !s.mealsEaten.list.includes(meal.name)) {
        s.mealsEaten.list.push(meal.name);
        s.satiety = clamp(s.satiety + 8); // 吃下去先垫一垫，其余由消化系统慢慢吸收（body.js）
        s.mood = clamp(s.mood + 0.1, -1, 1);
        events.push({ type: 'meal', meal: meal.name });
      }
    }
  }

  // 作息：凌晨 1 点后或者精力见底就去睡；早上 7:30 后精力够了就醒
  // 刚和人聊过天的 30 分钟内不会睡着
  const night = h >= 1 && h < 7.5;
  const chatting = s.lastUserAt && now - s.lastUserAt < 30 * 60000;
  if (!s.asleep && !chatting && (night || s.energy < 8)) {
    s.asleep = true;
    events.push({ type: 'sleep' });
  } else if (s.asleep && !night && s.energy >= 60) {
    s.asleep = false;
    events.push({ type: 'wake' });
  }

  s.activity = pickActivity(s, h);
  return { state: s, events };
}

function pickActivity(s, h) {
  if (s.asleep) return '睡觉';
  if (s.satiety < 20) return '翻冰箱找吃的';
  if (s.energy < 25) return '窝在被子里犯困';
  if (h >= 22 || h < 1) return '躺在床上刷手机';
  if (h >= 19) return '在电脑前刷 B 站';
  if (h >= 14 && h < 17) return '窝在懒人沙发上看小说';
  return '发呆';
}

/** 用户发来消息时 */
function onUserMessage(prev, now = Date.now()) {
  const s = structuredClone(prev);
  const events = [];
  if (s.asleep) {
    s.asleep = false; // 被吵醒了
    s.mood = clamp(s.mood - 0.1, -1, 1);
    events.push({ type: 'woken' });
  }
  s.social = clamp(s.social + 12);
  s.mood = clamp(s.mood + 0.05, -1, 1);
  s.lastUserAt = now;
  return { state: s, events };
}

/** 是否想主动找人。满足条件返回理由，否则返回 null。 */
function proactiveReason(s, now = Date.now(), opts = {}) {
  const { quietStart = 23, quietEnd = 9, dailyLimit = 3, minGapMin = 120, idleMin = 180 } = opts;
  if (s.asleep) return null;
  const h = hourOf(now);
  const quiet = quietStart > quietEnd ? h >= quietStart || h < quietEnd : h >= quietStart && h < quietEnd;
  if (quiet) return null;
  const today = dateKey(now);
  const count = s.proactive.date === today ? s.proactive.count : 0;
  if (count >= dailyLimit) return null;
  if (now - s.lastProactiveAt < minGapMin * 60000) return null;
  if (s.lastUserAt && now - s.lastUserAt < idleMin * 60000) return null;
  if (s.social < 35) return '好久没人陪你说话了，有点想他';
  if (s.mood > 0.45) return '你心情很好，想跟他分享';
  return null;
}

function markProactive(prev, now = Date.now()) {
  const s = structuredClone(prev);
  const today = dateKey(now);
  s.proactive = { date: today, count: (s.proactive.date === today ? s.proactive.count : 0) + 1 };
  s.lastProactiveAt = now;
  s.social = clamp(s.social + 8);
  return s;
}

/** 给提示词用的身体状态描述 */
function describe(s) {
  const parts = [];
  if (s.asleep) parts.push('正在睡觉');
  else parts.push(`正在${s.activity}`);
  if (s.satiety < 20) parts.push('很饿');
  else if (s.satiety < 40) parts.push('有点饿');
  else if (s.satiety > 90) parts.push('吃得很饱');
  if (s.energy < 20) parts.push('困得睁不开眼');
  else if (s.energy < 40) parts.push('有点累');
  if (s.social < 25) parts.push('很孤单，特别想有人陪');
  else if (s.social < 45) parts.push('有点想找人说话');
  if (s.mood > 0.45) parts.push('心情很好');
  else if (s.mood < -0.3) parts.push('心情低落');
  else if (s.mood < 0) parts.push('有点闷闷的');
  return parts.join('，');
}

module.exports = { initialState, tick, onUserMessage, proactiveReason, markProactive, describe, dateKey, hourOf, clamp };
