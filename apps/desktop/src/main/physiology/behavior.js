// 身体状态判定。说话方式、自主活动、系统报告都用这一张表，优先级就是表的顺序。

const config = require('../config');
const { glucoseMmol } = require('./homeostasis');

const STATES = [
  { id: 'fever', test: (b) => !!b.fever || b.temp > 37.3, activity: '裹着被子躺着' },
  { id: 'exhausted', test: (b, s) => s.energy < 20, activity: '窝在被子里犯困' },
  { id: 'hungry', test: (b, s) => s.satiety < 30 || glucoseMmol(b.glucose) < 3.9, activity: '到处找吃的' },
  { id: 'thirsty', test: (b) => b.hydration < 30, activity: '去倒水喝' },
  { id: 'stressed', test: (b) => b.nt.cortisol > 55, activity: '坐立不安' },
  { id: 'low', test: (b, s, pad) => pad.P < -0.25, activity: '窝着发呆' },
  { id: 'lonely', test: (b, s) => s.social < 25, activity: '抱着手机等消息' },
  { id: 'happy', test: (b, s, pad) => pad.P > 0.35, activity: '抱着手机在床上打滚' },
];

function activeStates(b, s, pad) {
  return STATES.filter((x) => x.test(b, s, pad)).map((x) => x.id);
}

/** 有身体状态时决定她在做什么，没有则返回 null，走原来的作息逻辑 */
function activityFor(states) {
  return STATES.find((x) => x.id === states[0])?.activity || null;
}

/** stomach 是胃里还有多少：刚吃过饭就算还饿，也不用再找吃的 */
function shouldSnack(states, s, now, stomach = 0) {
  if (!states.includes('hungry') || s.asleep || stomach > 25) return false;
  const cooldown = config.get().physiology.snackCooldownMinutes * 60000;
  return now - (s.lastSnackAt || 0) >= cooldown;
}

module.exports = { STATES, activeStates, activityFor, shouldSnack };
