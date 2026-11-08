// 黑话：你们之间的专属用语。聊天里持续学习，长期不用会慢慢淡忘。

const DAY = 86400000;
const HALF_LIFE_DAYS = 90;
const ARCHIVE_BELOW = 0.1;

function add(list, { term, meaning, example = '', at }) {
  const word = String(term || '').trim();
  if (!word) return list;
  const out = list.map((x) => ({ ...x }));
  const hit = out.find((x) => x.term === word);
  if (hit) {
    hit.meaning = meaning || hit.meaning;
    hit.example = example || hit.example;
    hit.count += 1;
    hit.lastAt = at;
    hit.strength = 1;
    hit.archived = false;
    return out;
  }
  out.push({ term: word, meaning: String(meaning || ''), example, count: 1, firstAt: at, lastAt: at, strength: 1, archived: false });
  return out;
}

/** 这句话里用到的黑话：次数加一，强度恢复 */
function observe(list, text, now) {
  return list.map((x) => (String(text).includes(x.term) ? { ...x, count: x.count + 1, lastAt: now, strength: 1, archived: false } : x));
}

function decay(list, now) {
  return list.map((x) => {
    const strength = Math.pow(0.5, Math.max(0, now - x.lastAt) / (HALF_LIFE_DAYS * DAY));
    return { ...x, strength, archived: strength < ARCHIVE_BELOW };
  });
}

/** 只取这句话里出现的，最多 max 条，避免占用上下文 */
function forPrompt(list, text, max = 5) {
  return list.filter((x) => !x.archived && String(text).includes(x.term)).sort((a, b) => b.count - a.count).slice(0, max);
}

module.exports = { add, observe, decay, forPrompt };
