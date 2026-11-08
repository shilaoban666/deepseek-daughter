// 身体和记忆的连接：情绪强烈时记得牢，生病时记得差，想起旧事会改变心情。

const { addCause, clamp } = require('./homeostasis');

const RECALL_COOLDOWN_MS = 30 * 60000;
const RECALL_MOOD_CAP = 0.08;

function encodingFactor(b, pad, states = []) {
  let f = 1;
  if (Math.abs(pad.A) > 0.5) f *= 1.3;
  if (b.nt.acetylcholine >= 60) f *= 1.1;
  if (states.includes('fever') || states.includes('exhausted')) f *= 0.7;
  return clamp(f, 0.6, 1.4);
}

/** 睡眠质量决定这一夜能整理多少经历 */
function sleepQuality(b, s) {
  let q = 1;
  if (b.fever) q -= 0.3;
  if (s.energy < 20) q -= 0.2;
  return clamp(q, 0.6, 1);
}

/**
 * 想起的事会影响此刻的心情。同一条记忆 30 分钟内不重复起作用，反刍也不会失控。
 * @returns {number} 心情变化量
 */
function afterRecall(items, s, b, now) {
  const seen = b.phys.recallSeen;
  for (const [id, t] of Object.entries(seen)) if (now - t > RECALL_COOLDOWN_MS) delete seen[id];
  const fresh = items.filter((m) => m.emotion && !seen[m.id]);
  if (!fresh.length) return 0;
  for (const m of fresh) seen[m.id] = now;
  const avg = fresh.reduce((x, m) => x + m.emotion.P, 0) / fresh.length;
  const delta = clamp(avg * 0.1, -RECALL_MOOD_CAP, RECALL_MOOD_CAP);
  s.mood = clamp(s.mood + delta, -1, 1);
  if (Math.abs(delta) >= 0.005) {
    const top = [...fresh].sort((x, y) => Math.abs(y.emotion.P) - Math.abs(x.emotion.P))[0];
    addCause(b, { at: now, from: `想起「${String(top.text).slice(0, 14)}」`, to: 'mood', text: delta < 0 ? '想起这件事，心情沉了一下' : '想起这件事，心情好了一点' });
  }
  return delta;
}

module.exports = { encodingFactor, sleepQuality, afterRecall };
