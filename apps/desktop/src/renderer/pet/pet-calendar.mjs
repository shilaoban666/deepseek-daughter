// 节日判断：农历节日用浏览器内置的中国农历（Intl 'chinese' 日历）现场算，
// 清明、冬至两个节气用标准近似公式，公历节日直接比月日。
// 内置农历在新月靠近午夜的年份可能差一天，所以有一张人工核对过的更正表 OVERRIDES。
// 纯函数，不读时钟；Node（测试）和 Electron 界面共用。

/** 农历节日：[id, 名字, 农历月, 农历日] */
const LUNAR = [
  ['spring', '春节', 1, 1],
  ['lantern', '元宵', 1, 15],
  ['dragon', '端午', 5, 5],
  ['qixi', '七夕', 7, 7],
  ['ghost', '中元', 7, 15],
  ['midautumn', '中秋', 8, 15],
  ['double9', '重阳', 9, 9],
  ['laba', '腊八', 12, 8],
];

/** 公历节日：[id, 名字, 月, 日] */
const SOLAR = [
  ['national', '国庆', 10, 1],
  ['halloween', '万圣节', 10, 31],
  ['xmaseve', '平安夜', 12, 24],
  ['xmas', '圣诞', 12, 25],
];

export const FESTIVAL_NAMES = Object.fromEntries([...LUNAR, ...SOLAR, ['eve', '除夕'], ['qingming', '清明'], ['dongzhi', '冬至']].map(([id, name]) => [id, name]));

/**
 * 人工核对过的更正：内置农历算错的日子。键是公历日期，值是那天真正的节日 id 列表；
 * 同时要在 WRONG 里写上内置日历算错的那一天，避免同一个节日出现两天。
 * 核对来源和时间写在 docs/notes/pet-festivals.md。
 */
export const OVERRIDES = {
  // 2027、2030 年正月初一的新月靠近北京时间午夜，内置农历晚了一天
  '2027-02-05': ['eve'],
  '2027-02-06': ['spring'],
  '2027-02-20': ['lantern'],
  '2030-02-02': ['eve'],
  '2030-02-03': ['spring'],
  '2030-02-17': ['lantern'],
};
export const WRONG = {
  '2027-02-07': ['spring'],
  '2027-02-21': ['lantern'],
  '2030-02-01': ['eve'],
  '2030-02-16': ['lantern'],
};

const pad = (n) => String(n).padStart(2, '0');
export const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

let lunarFmt = null;
/** 公历日期 → {month, day, leap}；不支持中国农历的环境返回 null */
export function lunarOf(date) {
  try {
    lunarFmt ||= new Intl.DateTimeFormat('zh-u-ca-chinese', { month: 'numeric', day: 'numeric', timeZone: 'Asia/Shanghai' });
    const parts = lunarFmt.formatToParts(date);
    const m = parts.find((p) => p.type === 'month')?.value || '';
    const d = parts.find((p) => p.type === 'day')?.value || '';
    const leap = m.includes('闰');
    const month = Number(m.replace(/\D/g, ''));
    const day = Number(d.replace(/\D/g, ''));
    return month && day ? { month, day, leap } : null;
  } catch {
    return null;
  }
}

/** 节气近似公式（21 世纪通用，误差多为 0 天）：C 是该节气的常数 */
function solarTermDay(year, C) {
  const y = year % 100;
  return Math.floor(y * 0.2422 + C) - Math.floor((y - 1) / 4);
}

/** 某一天是哪些节日（可能不止一个），返回 id 数组 */
export function festivalsOn(date) {
  const key = ymd(date);
  if (OVERRIDES[key]) return [...OVERRIDES[key]];
  const ids = [];
  const m = date.getMonth() + 1, d = date.getDate(), y = date.getFullYear();
  for (const [id, , sm, sd] of SOLAR) if (m === sm && d === sd) ids.push(id);
  if (m === 4 && d === solarTermDay(y, 4.81)) ids.push('qingming');
  if (m === 12 && d === solarTermDay(y, 21.94)) ids.push('dongzhi');
  const lunar = lunarOf(date);
  if (lunar && !lunar.leap) {
    for (const [id, , lm, ld] of LUNAR) if (lunar.month === lm && lunar.day === ld) ids.push(id);
    // 除夕：明天是春节
    const next = new Date(y, m - 1, d + 1);
    const ln = lunarOf(next);
    if (ln && !ln.leap && ln.month === 1 && ln.day === 1) ids.push('eve');
  }
  return ids.filter((id) => !(WRONG[key] || []).includes(id));
}

/** 列出一年里所有节日的日期，给核对和测试用：{id: 'YYYY-MM-DD'} */
export function festivalsOfYear(year) {
  const out = {};
  for (let t = new Date(year, 0, 1); t.getFullYear() === year; t = new Date(t.getFullYear(), t.getMonth(), t.getDate() + 1)) {
    for (const id of festivalsOn(t)) out[id] ||= ymd(t);
  }
  return out;
}
