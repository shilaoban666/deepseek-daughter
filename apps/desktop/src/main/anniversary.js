// 纪念日和你们的关系。

const DAY = 86400000;
const clamp = (v) => Math.min(100, Math.max(0, v));
const pad = (n) => String(n).padStart(2, '0');

function occurrence(month, day, year) {
  const last = new Date(year, month, 0).getDate(); // 2 月 29 日在平年落到 2 月 28 日
  return new Date(year, month - 1, Math.min(day, last));
}

function nextOccurrence(date, now) {
  const [, month, day] = String(date).split('-').map(Number);
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  let d = occurrence(month, day, today.getFullYear());
  if (d < today) d = occurrence(month, day, today.getFullYear() + 1);
  return { date: d, daysLeft: Math.round((d - today) / DAY) };
}

/** days 天之内要到的纪念日，近的在前 */
function upcoming(items, now, days) {
  return items
    .map((x) => {
      const n = nextOccurrence(x.date, now);
      return { id: x.id, title: x.title, auto: !!x.auto, date: `${n.date.getFullYear()}-${pad(n.date.getMonth() + 1)}-${pad(n.date.getDate())}`, daysLeft: n.daysLeft };
    })
    .filter((x) => x.daysLeft <= days)
    .sort((a, b) => a.daysLeft - b.daysLeft);
}

/** 关系由你们真实的相处算出来，不是随便写的数 */
function relation({ days = 0, messages = 0, memories = 0, proactive = 0 }) {
  return {
    intimacy: Math.round(clamp(12 + Math.sqrt(messages) * 2.2 + Math.min(days, 90) * 0.25)),
    trust: Math.round(clamp(20 + Math.min(days, 180) * 0.2 + Math.sqrt(memories) * 3)),
    reliance: Math.round(clamp(8 + Math.sqrt(proactive) * 6 + Math.min(days, 60) * 0.1)),
  };
}

module.exports = { upcoming, relation };
