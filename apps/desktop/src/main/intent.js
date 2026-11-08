// 从一句话里读出意图：主人是不是在忙、是不是在夸她、是不是在要求她做事。
// 这些判断不调用大模型，便宜而且快；人格成长和“主动找人要克制”都靠它。

const BUSY = /(我在忙|我忙|先忙|忙完再|等下再聊|晚点聊|在开会|开会中|上班中|加班|赶due|赶 ddl|赶ddl)/i;
const PRAISE = /(真棒|好棒|厉害|喜欢你|可爱|聪明|做得好|做得不错|谢谢你|乖|爱你|靠谱|有进步|真不错)/;
const CRITICISM = /(笨|讨厌你|烦死|闭嘴|滚|蠢|失望|没用|别烦我|不想理你)/;
const DIRECTIVE = /(帮我|替我|给我(看|找|写|查|讲|说)|快去|快点|你应该|你必须|不许|马上|现在去|去(看看|查查|找找))/;
const QUESTION = /[?？]|(吗|呢|什么|怎么|为什么|哪|多少|几[点个天号岁])/;
const AFFECTION = /(想你|抱抱|晚安|早安|乖|摸摸|辛苦了|注意身体|早点睡)/;

const norm = (s) => String(s ?? '').trim();
const hit = (re, text) => re.test(norm(text));

/**
 * @returns {{busy:boolean, praise:boolean, criticism:boolean, directive:boolean, question:boolean, affection:boolean, length:number}}
 */
function analyze(text) {
  const t = norm(text);
  return {
    busy: hit(BUSY, t),
    praise: hit(PRAISE, t) && !hit(CRITICISM, t),
    criticism: hit(CRITICISM, t),
    directive: hit(DIRECTIVE, t),
    question: hit(QUESTION, t),
    affection: hit(AFFECTION, t),
    length: t.length,
  };
}

/** 截一小段原话当成长记录里的证据 */
function snippet(text, n = 24) {
  const t = norm(text);
  return t.length > n ? `${t.slice(0, n)}…` : t;
}

module.exports = { analyze, snippet, BUSY, PRAISE, CRITICISM, DIRECTIVE, QUESTION, AFFECTION };
