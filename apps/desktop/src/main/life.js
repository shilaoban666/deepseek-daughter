// 女儿的身体与情绪状态（阶段 1 的心跳层）。
// 全是纯函数：传入状态和时间，返回新状态，方便测试；所有参数都来自 config。
// 设计文档：§5 八大生命系统、§6 情绪、§8 自驱力的克制规则。

const config = require('./config');

const clamp = (v, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, v));

function initialState(now = Date.now()) {
  return {
    satiety: 70, // 饱腹 0-100
    energy: 80, // 精力 0-100
    social: 60, // 被陪伴的满足感 0-100，越低越想找人
    mood: 0.2, // 心情 -1..1（PAD 由身体和递质算出，这是其中一项输入）
    asleep: false,
    lastTick: now,
    lastUserAt: 0,
    lastProactiveAt: 0,
    busyUntil: 0, // 主人说“我在忙”之后的社交冷静期
    directives: 0, // 最近被要求做事的累积，越高越想要一点自主
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
  const c = config.get().life;
  const s = structuredClone(prev);
  const events = [];
  const dtMin = Math.min(Math.max(0, (now - s.lastTick) / 60000), 24 * 60);
  s.lastTick = now;
  const h = hourOf(now);
  const today = dateKey(now);

  // 消耗与恢复
  s.satiety = clamp(s.satiety - c.satietyPerMin * dtMin);
  s.social = clamp(s.social - c.socialPerMin * dtMin);
  s.energy = clamp(s.asleep ? s.energy + c.energySleepPerMin * dtMin : s.energy - c.energyAwakePerMin * dtMin);
  s.directives = Math.max(0, (s.directives || 0) * Math.pow(0.5, dtMin / 120));
  // 心情向基线回落（默认半衰期 3 小时）
  const baseline =
    c.moodBaseline +
    (s.satiety < 25 ? -0.25 : 0) +
    (s.social < 25 ? -0.2 : 0) +
    (s.energy < 20 ? -0.15 : 0);
  s.mood = baseline + (s.mood - baseline) * Math.pow(0.5, dtMin / c.moodHalfLifeMinutes);

  // 一日三餐（规则行为，不调用大模型）
  if (s.mealsEaten.date !== today) s.mealsEaten = { date: today, list: [] };
  if (!s.asleep) {
    for (const meal of c.meals) {
      if (h >= meal.h && h < meal.h + 2 && !s.mealsEaten.list.includes(meal.name)) {
        s.mealsEaten.list.push(meal.name);
        s.satiety = clamp(s.satiety + 8); // 吃下去先垫一垫，其余由消化系统慢慢吸收（body.js）
        s.mood = clamp(s.mood + 0.1, -1, 1);
        events.push({ type: 'meal', meal: meal.name });
      }
    }
  }

  // 作息：默认凌晨 1 点后或者精力见底就去睡；早上 7:30 后精力够了就醒
  // 刚和人聊过天的 30 分钟内不会睡着
  const night = h >= c.sleep.startHour && h < c.sleep.endHour;
  const chatting = s.lastUserAt && now - s.lastUserAt < c.sleep.chatGuardMinutes * 60000;
  if (!s.asleep && !chatting && (night || s.energy < c.sleep.sleepEnergy)) {
    s.asleep = true;
    events.push({ type: 'sleep' });
  } else if (s.asleep && !night && s.energy >= c.sleep.wakeEnergy) {
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
  s.busyUntil = 0; // 主人回来了，就不用再躲着
  return { state: s, events };
}

/** 主人说“我在忙”：压住社交冲动一段时间（设计文档 §8 决策规则 4） */
function markBusy(prev, now = Date.now(), minutes) {
  const s = structuredClone(prev);
  const m = minutes ?? config.get().life.proactive.busyBackoffMinutes;
  s.busyUntil = now + m * 60000;
  return s;
}

const isBusy = (s, now = Date.now()) => !!s.busyUntil && now < s.busyUntil;

/** 主人让她做事（“帮我看看”“快去”）：自主驱力会慢慢上涨 */
function addDirective(prev, amount = 1) {
  const s = structuredClone(prev);
  s.directives = Math.min(5, (s.directives || 0) + amount);
  return s;
}

function quietHours(now, cfg) {
  const h = hourOf(now);
  return cfg.quietStart > cfg.quietEnd ? h >= cfg.quietStart || h < cfg.quietEnd : h >= cfg.quietStart && h < cfg.quietEnd;
}

/**
 * 是否想主动找人。满足条件返回理由，否则返回 null。
 * 安静时段、每日上限、刚说完话、主人说忙，都会拦住她。
 */
function proactiveReason(s, now = Date.now(), opts = {}) {
  const cfg = { ...config.get().life.proactive, ...opts };
  if (s.asleep) return null;
  if (quietHours(now, cfg)) return null;
  if (isBusy(s, now)) return null;
  const today = dateKey(now);
  const count = s.proactive.date === today ? s.proactive.count : 0;
  if (count >= cfg.dailyLimit) return null;
  if (now - s.lastProactiveAt < cfg.minGapMinutes * 60000) return null;
  if (s.lastUserAt && now - s.lastUserAt < cfg.idleMinutes * 60000) return null;
  if (s.social < cfg.socialThreshold) return '好久没人陪你说话了，有点想他';
  if (s.mood > cfg.moodThreshold) return '你心情很好，想跟他分享';
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

module.exports = { initialState, tick, onUserMessage, markBusy, isBusy, addDirective, proactiveReason, markProactive, describe, dateKey, hourOf, clamp };
