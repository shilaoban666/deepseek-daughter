// 记忆（阶段 1 最小版本）：
// - 长期事实：每聊几轮，让 DeepSeek 从最近对话里提炼值得记住的事
// - 检索：按重要性 + 字面重合度 + 新鲜度打分（以后换成向量 + FTS5 的五路混合检索）
// - 日记：睡觉时把当天的对话写成一篇日记

function bigrams(text) {
  const s = String(text).toLowerCase().replace(/\s+/g, '');
  const set = new Set();
  for (let i = 0; i < s.length - 1; i++) set.add(s.slice(i, i + 2));
  return set;
}

function overlap(a, b) {
  if (!a.size || !b.size) return 0;
  let n = 0;
  for (const x of a) if (b.has(x)) n++;
  return n / Math.min(a.size, b.size);
}

/** 挑出和当前话题最相关的事实，最多 limit 条 */
function retrieve(facts, query, now = Date.now(), limit = 30) {
  if (facts.length <= limit) return facts.slice();
  const q = bigrams(query);
  return facts
    .map((f) => {
      const ageDays = (now - (f.createdAt || now)) / 86400000;
      const score = f.importance / 5 + overlap(q, bigrams(f.text)) * 2 + Math.exp(-ageDays / 14) * 0.5;
      return { f, score };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => x.f);
}

function extractionMessages(recent, facts, userName) {
  const who = userName || 'TA';
  const convo = recent.map((m) => `${m.role === 'user' ? who : '小鲸鱼'}：${m.content}`).join('\n');
  const known = facts.length ? facts.map((f) => `- ${f.text}`).join('\n') : '（还没有）';
  return [
    {
      role: 'system',
      content: `你是小鲸鱼的记忆整理器。从对话里找出以后值得记住的事：关于${who}的事实（名字、喜好、经历、计划、在意的人和事、情绪）、两人之间的约定、小鲸鱼自己的新体验。
规则：
- 只写对话里明确出现的信息，不要推测。
- 已经记住的不要重复；如果新信息和已有记忆冲突，写进 corrections。
- 每条用一句完整的话，主语写清楚（用“${who}”或“我”指小鲸鱼）。
- importance 1-5：5=名字、重大事件、约定；3=喜好、日常经历；1=随口一提。
- 闲聊寒暄没有信息就返回空数组。
只输出 JSON：{"new":[{"text":"...","importance":3}],"corrections":[{"old":"已有记忆原文","text":"更正后的内容"}]}`,
    },
    { role: 'user', content: `已有记忆：\n${known}\n\n最近对话：\n${convo}` },
  ];
}

/** 把提炼结果合并进事实库，返回新数组 */
function mergeFacts(facts, result, now = Date.now()) {
  const out = facts.slice();
  if (!result || typeof result !== 'object') return out;
  for (const c of Array.isArray(result.corrections) ? result.corrections : []) {
    if (!c || typeof c.text !== 'string') continue;
    const i = out.findIndex((f) => f.text === c.old);
    if (i >= 0) out[i] = { ...out[i], text: c.text.trim(), updatedAt: now };
  }
  for (const n of Array.isArray(result.new) ? result.new : []) {
    if (!n || typeof n.text !== 'string') continue;
    const text = n.text.trim();
    if (!text) continue;
    const nb = bigrams(text);
    if (out.some((f) => f.text === text || overlap(nb, bigrams(f.text)) > 0.85)) continue;
    const importance = Math.max(1, Math.min(5, Math.round(Number(n.importance) || 2)));
    out.push({ id: `${now.toString(36)}-${out.length}`, text, importance, createdAt: now });
  }
  return out;
}

function diaryMessages(date, dayMessages, userName) {
  const who = userName || 'TA';
  const convo = dayMessages.map((m) => `${m.role === 'user' ? who : '我'}：${m.content}`).join('\n');
  return [
    {
      role: 'system',
      content: `你是小鲸鱼，一个住在电脑里的数字女孩，现在要睡觉了，写一篇今天的日记。第一人称，口语化，像真的女孩子写的私人日记，150 字以内。写今天和${who}聊了什么、你的感受；没什么事就写写今天的心情。不要标题，不要 markdown。`,
    },
    { role: 'user', content: `${date} 的聊天记录：\n${convo || '（今天没人找我说话）'}` },
  ];
}

module.exports = { retrieve, extractionMessages, mergeFacts, diaryMessages, bigrams, overlap };
