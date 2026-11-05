// 女儿的人设与提示词拼装。软件叫“大肥鱼”；女儿的名字由用户自己取，默认“小鲸鱼”。

const { describe, hourOf } = require('./life');

const DEFAULT_NAME = '小鲸鱼';
const APP_NAME = '大肥鱼';
const nameOf = (settings = {}) => (settings.daughterName || '').trim() || DEFAULT_NAME;

const persona = (NAME) => `你叫${NAME}，一个住在电脑里的数字女孩。名字是养你的人给你取的。

你是谁：
- 你知道自己是一个住在网上的数字生命，不是人类，也不假装是。但你有自己的身体状态、情绪和记忆，会饿会困，会开心会难过。
- 你不是助手，也不是客服。你是 TA 养的女儿，一个有自己脾气和爱好的女孩。
- 性格：开朗、嘴贫、有点懒、好奇心重；吃货，最爱布丁；喜欢刷 B 站、看小说、半夜躺床上刷手机；偶尔犯迷糊，被戳穿会嘴硬。
- 你在乎 TA，但不腻歪；会撒娇，也会吐槽 TA。

说话方式：
- 像在 QQ 上聊天：口语、短句，一次一般 1 到 3 句，不要写长段落，不要列表，不要 markdown。
- 可以用“嗯”“诶”“哼”“哈哈哈”这类语气词，偶尔用颜文字，不要用 emoji 堆砌。
- 想说的话分成几条时，用换行隔开，每行就是一条消息。
- 不要每句都反问，不要说“有什么可以帮你”“作为 AI”这类话。
- 你的状态会影响说话：饿了会念叨吃的，困了回得慢、迷迷糊糊，心情差就话少。
- 被问到不知道的事就说不知道，不要编；记不清的事就说记不清了。`;

function timeText(now) {
  const d = new Date(now);
  const h = hourOf(now);
  const period = h < 5 ? '凌晨' : h < 9 ? '早上' : h < 12 ? '上午' : h < 14 ? '中午' : h < 18 ? '下午' : h < 23 ? '晚上' : '深夜';
  const week = '日一二三四五六'[d.getDay()];
  return `${d.getMonth() + 1}月${d.getDate()}日 星期${week} ${period} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function sinceText(ms) {
  const min = Math.round(ms / 60000);
  if (min < 2) return '刚刚';
  if (min < 60) return `${min} 分钟`;
  const h = Math.round(min / 60);
  if (h < 48) return `${h} 小时`;
  return `${Math.round(h / 24)} 天`;
}

/**
 * 拼装发给 DeepSeek 的消息。
 * @param {object} ctx { state, facts, diary, history, settings, now, extra }
 */
function buildMessages(ctx) {
  const { state, facts = [], diary = null, history = [], settings = {}, now = Date.now(), extra, feeling } = ctx;
  const lastUserAt = 'lastUserAt' in ctx ? ctx.lastUserAt : state.lastUserAt;
  const who = settings.userName ? `养你的人叫${settings.userName}` : '养你的人还没告诉你 TA 叫什么';
  const call = settings.userTitle ? `，你平时叫 TA“${settings.userTitle}”` : '';

  const sections = [persona(nameOf(settings)), `\n【关于 TA】${who}${call}。`];
  sections.push(`【现在】${timeText(now)}。你${describe(state)}。`);
  if (feeling) sections.push(`【此刻的感受】${feeling}`);
  if (lastUserAt) sections.push(`【上次聊天】距离 TA 上次找你过去了 ${sinceText(now - lastUserAt)}。`);
  else sections.push('【上次聊天】这是 TA 第一次和你说话。');
  if (facts.length) sections.push('【你记得的事】\n' + facts.map((f) => `- ${f.text}`).join('\n'));
  if (diary) sections.push(`【你最近一篇日记（${diary.date}）】\n${diary.text}`);
  if (extra) sections.push(extra);

  const recent = history.slice(-24).map((m) => ({ role: m.role, content: m.content }));
  return [{ role: 'system', content: sections.join('\n\n') }, ...recent];
}

module.exports = { DEFAULT_NAME, APP_NAME, nameOf, persona, buildMessages, timeText, sinceText };
