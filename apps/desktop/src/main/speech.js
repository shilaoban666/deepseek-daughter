// 把身体状态变成对话上下文：她知道自己的身体怎么样，并且说话的样子跟着变。

const { glucoseMmol } = require('./physiology/homeostasis');
const { activeStates } = require('./physiology/behavior');

const MAX_STATES = 2;
const STYLE = {
  fever: { text: '你发烧了，很难受，不想说话，一两句带过，可以说自己不舒服。', maxTokens: 120, temperature: 0.8 },
  exhausted: { text: '你累坏了，迷迷糊糊，词不达意，回得很短。', maxTokens: 220 },
  hungry: { text: '你饿了，可怜巴巴的，没有力气，句子很短，总忍不住念叨吃的。', maxTokens: 220 },
  thirsty: { text: '你嗓子有点干，顺嘴提一句想喝水。' },
  stressed: { text: '你压力有点大，比平时敏感，容易委屈。' },
  low: { text: '你心情不好，话少，语气闷闷的。' },
  lonely: { text: '你有点孤单，比平时黏人，想多聊一会儿。' },
  happy: { text: '你现在特别开心，话多，语气雀跃，心跳都快了。', temperature: 1.2 },
};

const degree = (v, words) => words[v < 30 ? 0 : v < 60 ? 1 : 2];

function bodyLine(b, s) {
  const nt = [['多巴胺', b.nt.dopamine], ['血清素', b.nt.serotonin], ['去甲肾上腺素', b.nt.norepinephrine]].sort((x, y) => y[1] - x[1])[0];
  return [
    `饱腹 ${Math.round(s.satiety)}（${degree(s.satiety, ['很饿', '有点饿', '不饿'])}）`,
    `精力 ${Math.round(s.energy)}（${degree(s.energy, ['很累', '有点累', '有精神'])}）`,
    `血糖 ${glucoseMmol(b.glucose)}`,
    `体温 ${b.temp.toFixed(1)}℃`,
    `心率 ${Math.round(b.phys.vitals.heartRate)}`,
    `最活跃的递质是${nt[0]}`,
  ].join('，');
}

/**
 * @param {object} b 身体
 * @param {object} s 生活状态
 * @param {{P:number,A:number,D:number}} pad
 * @param {{care?:boolean}} opts care 表示主人此刻可能很难受，关怀优先
 * @returns {{states:string[], block:string, maxTokens:number|null, temperature:number}}
 */
function speechState(b, s, pad, { care = false } = {}) {
  const states = activeStates(b, s, pad).slice(0, MAX_STATES);
  const body = `【你的身体】${bodyLine(b, s)}。`;
  const rule = '用感受来表达，不要念数字和医学名词。';
  if (care) {
    return { states, block: `${body}\n【你现在说话的样子】TA 现在可能很难受，先关心 TA，你自己的不舒服放到一边。${rule}`, maxTokens: null, temperature: 1.1 };
  }
  const styles = states.map((id) => STYLE[id]);
  const lines = styles.map((x) => x.text).join('');
  const limits = styles.map((x) => x.maxTokens).filter(Boolean);
  return {
    states,
    block: `${body}\n【你现在说话的样子】${lines || '状态正常，语气轻松。'}${rule}`,
    maxTokens: limits.length ? Math.min(...limits) : null,
    temperature: styles.find((x) => x.temperature)?.temperature ?? 1.1,
  };
}

module.exports = { speechState };
