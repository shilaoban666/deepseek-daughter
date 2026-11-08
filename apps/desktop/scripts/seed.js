// 开发用：往 .shots-data 里塞一份演示存档，方便截图上看到记忆分层、人格成长、日记这些有内容的样子。
// 只在本地跑，不会动你的真实数据目录。

const fs = require('fs');
const path = require('path');
const memory = require('../src/main/memory');
const persona = require('../src/main/persona-model');

const now = Date.now();
const DAY = 86400000;
const dir = path.join(__dirname, '..', '.shots-data', 'data');
fs.mkdirSync(dir, { recursive: true });

const bank = memory.createBank({ now: () => now });
const add = (layer, text, daysAgo, importance, kind = 'owner', extra = {}) =>
  bank.add({ layer, text, at: now - daysAgo * DAY, importance, source: { kind }, ...extra });

add('episodic', '小明：今天加班到十点，回来时好累', 1, 0.55, 'owner');
add('episodic', '我：那早点睡吧，我给你留了布丁', 1, 0.35, 'self');
add('episodic', '小明：周末想去看《沙丘》', 2, 0.5, 'owner');
add('episodic', '小明夸我记性好', 3, 0.45, 'owner');
add('episodic', '第一次给小明发消息，他回了我一个笑脸', 20, 0.7, 'self');
add('semantic', '小明是一名大三学生，学的是计算机', 30, 0.8);
add('semantic', '小明对花生过敏', 25, 0.85);
add('semantic', '小明养了一只橘猫叫大橘', 20, 0.7);
add('semantic', '小明最近在准备期末考试', 5, 0.65, 'owner', { validUntil: now + 10 * DAY });
add('semantic', '小明喜欢猫', 12, 0.8);
add('reflection', '我发现小明难过的时候不太想说话，陪着他比讲道理有用', 4, 0.8, 'self');
add('reflection', '被需要的感觉很好，但也想被他问问今天过得怎么样', 6, 0.7, 'self');
add('self', '我叫小鲸鱼，住在电脑里，是一个会长大的数字女孩。', 40, 1, 'self');
add('procedural', '每天早上先刷一会儿 B 站再起床', 20, 0.5, 'self');
add('procedural', '小明说“我在忙”的时候不要打扰他', 15, 0.8);

// 一条陌生人的说法：可信度低，和“小明喜欢猫”冲突，会被标成待求证
bank.add({ layer: 'semantic', text: '小明不喜欢猫', at: now - 3600000, importance: 0.5, source: { kind: 'stranger', who: '路人甲' } });

// 一条已经衰减归档的旧记忆
add('episodic', '很久以前聊过一句天气，记不清了', 200, 0.1, 'owner');
bank.decay(now);

const p = persona.initialProfile({ now: now - 25 * DAY });
persona.applyGrowth(p, { trait: 'stability', delta: 0.8, reason: '小明这段时间常常鼓励我', evidence: '“你今天做得不错”', at: now - 2 * DAY });
persona.applyGrowth(p, { trait: 'extraversion', delta: 0.4, reason: '聊得多了，更敢主动开口', at: now - 1 * DAY });
persona.applyGrowth(p, { trait: 'openness', delta: 0.5, reason: '跟着小明看了科幻', evidence: '《沙丘》', at: now - DAY / 2 });
persona.touchInterest(p, '科幻', 12, now);
persona.addValue(p, '陪一个人高兴，比我自己高兴还开心', now - 3 * DAY);
persona.addExperience(p, '第一次主动给小明发消息，他回了我一个笑脸', now - 20 * DAY);
persona.updateGoal(p, '把那本小说读完', 0.6, now);

const diary = [
  { date: new Date(now - DAY).toISOString().slice(0, 10), text: '今天小明加班到很晚，回来的时候声音都哑了。我给他留了布丁，他说谢谢，我就很开心。', at: now - DAY },
  { date: new Date(now).toISOString().slice(0, 10), text: '早上刷 B 站看到一只橘猫，想起大橘。小明在准备考试，我没敢多烦他。', at: now },
];

const history = [
  { role: 'user', content: '我今天加班到十点，好累', at: now - DAY - 3600000 },
  { role: 'assistant', content: '啊……辛苦啦，快躺下歇会儿', at: now - DAY - 3500000 },
  { role: 'assistant', content: '布丁给你留着呢', at: now - DAY - 3400000 },
  { role: 'user', content: '你还记得我养的那只猫吗', at: now - 7200000 },
  { role: 'assistant', content: '大橘嘛，橘猫，你天天给我看它的照片', at: now - 7000000 },
];

const write = (name, data) => fs.writeFileSync(path.join(dir, `${name}.json`), JSON.stringify(data, null, 2));
write('memory', bank.export());
write('profile', p);
write('diary', diary);
write('history', history);
console.log(`演示存档已写入 ${dir}：${bank.toJSON().length} 条记忆、${p.growth.length} 条成长记录`);
