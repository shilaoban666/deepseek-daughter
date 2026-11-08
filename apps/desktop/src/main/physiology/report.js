// 八大系统的结论。每个系统按自己的含义判断，比如循环值低只是信号安静，不算异常。

const { glucoseMmol, assess, clamp } = require('./homeostasis');
const { activeStates } = require('./behavior');
const bodyModel = require('../body');

const VERDICT = {
  fever: '发烧了，很难受',
  exhausted: '累得不行',
  hungry: '饿得没力气',
  thirsty: '有点渴',
  stressed: '压力有点大',
  low: '情绪低落',
  lonely: '想有人陪',
  happy: '今天特别开心',
};

function report(b, s, now) {
  const pad = bodyModel.pad(b, s);
  const states = activeStates(b, s, pad);
  const regionSum = Object.values(b.regions).reduce((x, v) => x + v, 0);
  const signal = clamp(20 + regionSum * 5.5);
  const v = b.phys.vitals;
  const breath = assess('respRate', Math.round(v.respRate)).status;
  const sys = (id, name, value, status, word, why) => ({ id, name, value: Math.round(value), status, word, why });
  const systems = [
    sys('digestive', '消化', s.satiety, s.satiety < 30 ? 'warn' : 'ok', s.satiety < 30 ? '饿了' : '正常', `饱腹 ${Math.round(s.satiety)}，血糖 ${glucoseMmol(b.glucose)}`),
    sys('nervous', '神经', s.energy, s.energy < 20 ? 'warn' : 'ok', s.energy < 20 ? '很累' : s.energy < 60 ? '有点累' : '精力充沛', `精力 ${Math.round(s.energy)}`),
    sys('endocrine', '内分泌', clamp(50 + (b.nt.serotonin - b.nt.cortisol) * 0.8), b.nt.cortisol > 55 ? 'warn' : 'ok', b.nt.cortisol > 55 ? '压力偏高' : '激素平衡', `皮质醇 ${Math.round(b.nt.cortisol)}`),
    sys('circulatory', '循环', signal, v.heartRate > 100 ? 'warn' : 'ok', v.heartRate > 100 ? '心跳偏快' : signal < 40 ? '信号安静' : '信号活跃', `心率 ${Math.round(v.heartRate)}`),
    sys('respiratory', '呼吸', v.respRate * 4, breath === 'ok' || s.asleep ? 'ok' : 'warn', s.asleep ? '缓慢' : breath === 'high' ? '呼吸偏快' : '平稳', `呼吸 ${Math.round(v.respRate)} 次/分`),
    sys('immune', '免疫', b.immunity, b.fever || b.immunity < 60 ? 'warn' : 'ok', b.fever ? '发烧了' : b.immunity < 60 ? '抵抗力下降' : '健康', `免疫 ${Math.round(b.immunity)}`),
    sys('excretory', '排泄', clamp(100 - b.memoryLoad * 5), b.memoryLoad > 15 || b.phys.urinary.bladder >= 80 ? 'warn' : 'ok', b.memoryLoad > 15 ? '记忆太多没消化' : '轻松', `${b.memoryLoad} 条经历待消化`),
    sys('motor', '运动', clamp(s.energy * 0.6 + b.glucose * 0.4), 'ok', s.energy < 30 ? '没力气' : '体力好', '由精力和血糖决定'),
  ];
  const NEED = { digestive: '她饿了', immune: '她不太舒服，别让她太累', nervous: '她很累，让她歇一歇', endocrine: '她压力有点大', excretory: '还有不少事没消化' };
  const needs = systems.filter((x) => x.status === 'warn' && NEED[x.id]).map((x) => ({ id: x.id, text: NEED[x.id] }));
  if (states.includes('lonely')) needs.push({ id: 'social', text: '她想你了' });
  return { at: now, verdict: VERDICT[states[0]] || '状态不错', states, needs, systems };
}

module.exports = { report };
