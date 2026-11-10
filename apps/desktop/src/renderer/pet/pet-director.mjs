// 选片：把状态机给出的状态，按 pet.json 的映射表换成具体的一段动画。
// 纯函数，随机数由调用方传入，Node 测试和界面共用。

import { festivalsOn } from './pet-calendar.mjs';

const pickFrom = (list, rnd, recent = []) => {
  if (!list?.length) return null;
  const last = recent[recent.length - 1];
  const pool = list.length > 1 ? list.filter((x) => x !== last) : list; // 不连着播同一段
  return pool[Math.floor(rnd() * pool.length) % pool.length];
};

const month = (now) => new Date(now).getMonth() + 1;
const hour = (now) => new Date(now).getHours();

/** 当天是节日或纪念日时，能播的时节动画 */
function festivalClips(manifest, now, anniversaryToday) {
  const out = [];
  for (const id of festivalsOn(new Date(now))) out.push(...(manifest.festivals[id] || []));
  if (anniversaryToday) out.push(...(manifest.festivals.anniversary || []));
  return out;
}

function seasonClips(manifest, now) {
  const m = month(now);
  return manifest.seasons.filter((x) => x.months.includes(m)).flatMap((x) => x.clips);
}

/** 闲时链里“小动作”这一格：加上按钟点、按季节出现的 */
function smallMoves(src, now) {
  const list = [...src.clips];
  for (const t of src.timed || []) if (hour(now) >= t.hours[0] && hour(now) < t.hours[1]) list.push(t.clip);
  for (const t of src.seasonal || []) if (t.months.includes(month(now))) list.push(t.clip);
  return list;
}

/** 吃饭：按摄取记录的备注选，纪念日那天吃长寿面 */
function mealClips(manifest, meal, now, anniversaryToday) {
  if (anniversaryToday) return manifest.meals.anniversary;
  const list = [...(manifest.meals[meal] || manifest.meals['饿了'])];
  if (meal === '下午茶' || meal === '饿了' || !manifest.meals[meal]) {
    if (manifest.summerMonths.includes(month(now))) list.push(...manifest.meals.summer);
    if (manifest.winterMonths.includes(month(now))) list.push(...manifest.meals.winter);
  }
  return list;
}

/**
 * 选下一段动画。
 * @param manifest  pet.json 的内容
 * @param derived   pet-state 的 derive() 结果
 * @param ctx       { now, rnd, recent: string[], anniversaryToday: boolean, sleepPhase?: 'start'|'loop'|'end' }
 * @returns {{ clip: string, source: string }}
 */
export function nextClip(manifest, derived, ctx) {
  const { now, rnd = Math.random, recent = [], anniversaryToday = false } = ctx;
  const a = derived.action;
  if (a === 'sleep') {
    const phase = ctx.sleepPhase || 'loop';
    return { clip: manifest.sleep[phase], source: `睡觉-${phase}` };
  }
  if (a === 'eat') return { clip: pickFrom(mealClips(manifest, derived.meal, now, anniversaryToday), rnd, recent), source: `吃饭-${derived.meal}` };
  if (a !== 'idle') return { clip: pickFrom(manifest.actions[a], rnd, recent), source: `动作-${a}` };

  // 闲着：按权重抽一个来源。节日当天“时节”的权重变大
  const fest = festivalClips(manifest, now, anniversaryToday);
  const sources = manifest.idleChain.map((src) => {
    let clips;
    if (src.from === 'moods') clips = (manifest.moods[derived.mood] || manifest.moods['平静']).clips;
    else if (src.from === 'seasons') clips = [...fest, ...seasonClips(manifest, now)];
    else if (src.id === '小动作') clips = smallMoves(src, now);
    else clips = src.clips;
    return { id: src.id, clips: src.from === 'seasons' && fest.length ? fest : clips, weight: clips.length ? src.weight : 0, festival: src.from === 'seasons' && fest.length ? src.festivalWeight : null };
  });
  // 节日当天，时节占 festivalWeight%（比如 40%），其余来源按原比例分剩下的
  const fs = sources.find((s) => s.festival != null);
  if (fs) {
    const others = sources.filter((s) => s !== fs).reduce((x, s) => x + s.weight, 0);
    fs.weight = (others * fs.festival) / (100 - fs.festival);
  }
  const total = sources.reduce((x, s) => x + s.weight, 0);
  let r = rnd() * total;
  for (const s of sources) {
    if ((r -= s.weight) < 0 && s.weight > 0) return { clip: pickFrom(s.clips, rnd, recent), source: `闲时-${s.id}` };
  }
  return { clip: manifest.fallbackClip, source: '闲时-待机' };
}

/** 一次性反应对应的动画 */
export function reactionClip(manifest, reaction, derived, ctx) {
  const { rnd = Math.random, recent = [], balanceTier } = ctx;
  if (reaction === 'wallet') return manifest.balance.clips[Math.max(0, Math.min(manifest.balance.clips.length - 1, balanceTier ?? 3))];
  if (reaction === 'poke') {
    const bad = manifest.badMoods.includes(derived.mood);
    return pickFrom(manifest.reactions.poke[bad ? 'bad' : 'good'], rnd, recent);
  }
  return pickFrom(manifest.reactions[reaction], rnd, recent);
}

/** 图标和色调 */
export function decorations(manifest, derived) {
  const icons = [];
  const actionIcon = manifest.icons[derived.action];
  if (actionIcon) icons.push(actionIcon);
  if (derived.action === 'idle') {
    const moodIcon = manifest.moods[derived.mood]?.icon;
    if (moodIcon) icons.push(moodIcon);
  }
  if (derived.missYou && derived.action !== 'sleep') icons.push('heart');
  return { icons: [...new Set(icons)], tint: manifest.tints[derived.action] || null };
}

/** 映射表里引用到的全部动画名 */
export function referencedClips(manifest) {
  const out = new Set();
  const add = (list) => (list || []).forEach((x) => out.add(x));
  Object.values(manifest.sleep).forEach((x) => out.add(x));
  Object.values(manifest.actions).forEach(add);
  Object.values(manifest.meals).forEach(add);
  for (const src of manifest.idleChain) {
    add(src.clips);
    (src.timed || []).forEach((t) => out.add(t.clip));
    (src.seasonal || []).forEach((t) => out.add(t.clip));
  }
  Object.values(manifest.moods).forEach((m) => add(m.clips));
  manifest.seasons.forEach((s) => add(s.clips));
  Object.values(manifest.festivals).forEach(add);
  for (const [k, v] of Object.entries(manifest.reactions)) (k === 'poke' ? [...v.good, ...v.bad] : v).forEach((x) => out.add(x));
  add(manifest.balance.clips);
  out.add(manifest.fallbackClip);
  return [...out];
}

/** 右键菜单里列出的全部动画名 */
export const menuClips = (manifest) => manifest.menu.flatMap((g) => g.clips);
