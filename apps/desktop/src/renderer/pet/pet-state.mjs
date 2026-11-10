// 鲸鱼娘的状态机：根据生命核心的快照和最近发生的事，决定她此刻在做什么。
// 全是纯函数，不碰 DOM、不读时钟（now 由调用方传入），Node 测试和界面共用。

export const ACTIONS = ['sleep', 'think', 'talk', 'sick', 'drowsy', 'eat', 'drink', 'hungry', 'fidget', 'wait', 'roll', 'phone', 'watch', 'read', 'idle'];
export const REACTIONS = ['poke', 'hold', 'done', 'fail', 'startle', 'greet', 'wave', 'blush', 'pout', 'guard', 'digest', 'tidy', 'wallet'];

const MIN = 60000;
const EAT_MINUTES = 3;
const DRINK_MINUTES = 2;
const REPLY_STALE_MS = 30000; // 30 秒没有新字，当作这次回复已经结束
const MAX_PENDING = 2;

export const DEFAULTS = { greetAfterHours: 3, balanceTiers: [1, 5, 10, 20, 50] };

/** 短期状态：回复进行到哪一步、有哪些反应等着播 */
export function initial() {
  return { replying: null, pending: [], lastUserAt: 0, balanceTier: null };
}

function push(m, name, at) {
  const pending = [...m.pending, { name, at }].slice(-MAX_PENDING);
  return { ...m, pending };
}

/** 余额（元）→ 0–5 档 */
export function balanceTier(yuan, tiers = DEFAULTS.balanceTiers) {
  const v = Number(yuan);
  if (!Number.isFinite(v)) return null;
  const i = tiers.findIndex((t) => v < t);
  return i < 0 ? tiers.length : i;
}

/**
 * 收到一个事件后的新短期状态。
 * @param {object} m 现在的短期状态
 * @param {{type:string, at:number, [k:string]:any}} e
 * @param {{greetAfterHours?:number, balanceTiers?:number[]}} [opts]
 */
export function reduce(m, e, opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  const at = e.at ?? 0;
  switch (e.type) {
    case 'reply-start':
      return { ...m, replying: { id: e.id, phase: 'think', since: at, lastAt: at } };
    case 'reply-delta':
      if (!m.replying || (e.id && m.replying.id !== e.id)) return m;
      return { ...m, replying: { ...m.replying, phase: 'talk', lastAt: at } };
    case 'reply-end':
      return push({ ...m, replying: null }, e.error ? 'fail' : 'done', at);
    case 'proactive':
      return push(m, 'wave', at);
    case 'poke':
      return push(m, 'poke', at);
    case 'hold':
      return push(m, 'hold', at);
    case 'wallet':
      return push(m, 'wallet', at);
    case 'balance': {
      const tier = balanceTier(e.yuan, o.balanceTiers);
      if (tier == null) return m;
      const changed = m.balanceTier != null && tier !== m.balanceTier;
      const next = { ...m, balanceTier: tier };
      return changed ? push(next, 'wallet', at) : next;
    }
    case 'reaction-done':
      return { ...m, pending: m.pending.slice(1) };
    case 'vitals': {
      let next = m;
      for (const ev of e.events || []) {
        if (ev.type === 'woken') next = push(next, 'startle', at);
        else if (ev.type === 'threat') next = push(next, 'guard', at);
        else if (ev.type === 'digested') next = push(next, 'digest', at);
        else if (ev.type === 'consolidated') next = push(next, 'tidy', at);
        else if (ev.type === 'user') {
          if (ev.intent?.praise) next = push(next, 'blush', at);
          else if (ev.intent?.criticism) next = push(next, 'pout', at);
          else if (next.lastUserAt && at - next.lastUserAt > o.greetAfterHours * 60 * MIN) next = push(next, 'greet', at);
          next = { ...next, lastUserAt: at };
        }
      }
      return next;
    }
    default:
      return m;
  }
}

/** 活动文字 → 动作 id；认不出来返回 'idle' */
export function actionForActivity(text) {
  const t = String(text || '');
  if (!t) return 'idle';
  if (/睡觉/.test(t) && !/犯困/.test(t)) return 'sleep';
  if (/裹着被子/.test(t)) return 'sick';
  if (/犯困/.test(t)) return 'drowsy';
  if (/倒水|喝水/.test(t)) return 'drink';
  if (/找吃的|翻冰箱/.test(t)) return 'hungry';
  if (/坐立不安/.test(t)) return 'fidget';
  if (/等消息/.test(t)) return 'wait';
  if (/打滚/.test(t)) return 'roll';
  if (/刷手机/.test(t)) return 'phone';
  if (/B\s*站|刷视频/.test(t)) return 'watch';
  if (/看小说|看书/.test(t)) return 'read';
  return 'idle';
}

/** 最近一条某类摄取记录（吃 / 喝），在 minutes 分钟以内才算 */
function recentIntake(body, kind, now, minutes) {
  const list = Array.isArray(body?.intake) ? body.intake : [];
  for (let i = list.length - 1; i >= 0; i--) {
    const x = list[i];
    if (x.kind !== kind) continue;
    return x.at <= now && now - x.at < minutes * MIN ? x : null;
  }
  return null;
}

/**
 * 此刻该怎么演。
 * @param {{state:object, body:object, mind:{thinking?:string, pad?:{label:string}, report?:{states:string[]}}}} snap 界面里的 S.vitals
 * @param {object} m 短期状态
 * @param {number} now
 * @returns {{action:string, mood:string, meal:string|null, reaction:string|null, missYou:boolean, why:string}}
 */
export function derive(snap, m, now) {
  const s = snap?.state || {};
  const b = snap?.body || {};
  const states = snap?.mind?.report?.states || [];
  const thinking = snap?.mind?.thinking || '';
  const mood = snap?.mind?.pad?.label || '平静';
  const activity = s.activity || '';
  const byActivity = actionForActivity(activity);
  const replying = m.replying && now - m.replying.lastAt < REPLY_STALE_MS ? m.replying : null;
  const ate = recentIntake(b, '吃', now, EAT_MINUTES);
  const drank = recentIntake(b, '喝', now, DRINK_MINUTES);

  let action = 'idle', why = activity ? `在${activity}` : '闲着';
  if (s.asleep) { action = 'sleep'; why = '睡着了'; }
  else if (replying?.phase === 'think') { action = 'think'; why = '在想怎么回你'; }
  else if (replying?.phase === 'talk') { action = 'talk'; why = '在回你的话'; }
  else if (states.includes('fever') || b.fever) { action = 'sick'; why = '发烧了，不舒服'; }
  else if (states.includes('exhausted') || thinking === '犯困') { action = 'drowsy'; why = '困了'; }
  else if (ate) { action = 'eat'; why = `在吃${ate.note ? ate.note : '东西'}：${ate.item}`; }
  else if (drank || byActivity === 'drink') { action = 'drink'; why = drank ? `在喝${drank.item}` : '去倒水喝'; }
  else if (states.includes('hungry') || byActivity === 'hungry') { action = 'hungry'; why = '饿了，在找吃的'; }
  else if (states.includes('stressed') || byActivity === 'fidget') { action = 'fidget'; why = '压力有点大，坐立不安'; }
  else if (states.includes('lonely') || byActivity === 'wait') { action = 'wait'; why = '有点孤单，在等你的消息'; }
  else if (states.includes('happy') || byActivity === 'roll') { action = 'roll'; why = '特别开心'; }
  else if (['phone', 'watch', 'read'].includes(byActivity)) { action = byActivity; }

  let reaction = m.pending[0]?.name || null;
  // 睡着时点她、或者有什么动静，只会惊醒一下，然后接着睡
  if (action === 'sleep' && reaction && !['startle', 'wallet'].includes(reaction)) reaction = 'startle';

  return {
    action,
    mood,
    meal: action === 'eat' ? ate.note || '饿了' : null,
    reaction,
    missYou: (s.social ?? 100) < 25,
    why,
  };
}
