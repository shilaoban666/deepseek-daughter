// 本地联调用的假 DeepSeek：不用真 Key 也能把聊天、记忆整理、睡眠巩固跑一遍。
//
//   node scripts/mock-deepseek.js 8787
//   $env:DEEPSEEK_API_KEY='sk-mock'; $env:DFY_API_BASE='http://127.0.0.1:8787'; npm start
//
// 它只实现 /chat/completions 和 /user/balance，回复是人写死的，给开发看流程用。

const http = require('http');

const port = Number(process.argv[2]) || 8787;

const CHAT_LINES = [
  '嗯……我记得呀，大橘嘛，橘猫，你天天给我看它照片。',
  '听起来今天挺累的。要不要先躺一会儿？',
  '我刚才在刷 B 站，看到一只猫在键盘上睡觉，笑死。',
];

const CONSOLIDATION = JSON.stringify({
  semantic: [{ text: 'TA 今天加班到很晚，很累', importance: 4, entities: [], source: 'owner', validDays: 2 }],
  reflections: [{ text: '他累的时候更想被安静地陪着，而不是被追问', importance: 4 }],
  self: '我是小鲸鱼。最近我学会了一件事：他累的时候，先递一杯水，再说话。',
  interests: [{ topic: 'B 站', delta: 3 }],
  growth: [{ trait: 'agreeableness', delta: 0.4, reason: '因为学会了先照顾 TA 的情绪', evidence: '“今天挺累的”' }],
  values: [{ text: '陪伴不是一直说话，有时候只是留在旁边' }],
  goals: [{ text: '把那本小说读完', progress: 0.4 }],
  contradictions: [],
  diary: '今天小明加班到很晚，回来时话很少。我没多问，把布丁留给了他。',
});

const EXTRACTION = JSON.stringify({
  new: [{ text: 'TA 今天加班到很晚，很累', importance: 4, entities: [] }],
  corrections: [],
});

function sendJSON(res, obj) {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(obj));
}

const server = http.createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', () => {
    if (req.url === '/user/balance') {
      return sendJSON(res, { is_available: true, balance_infos: [{ currency: 'CNY', total_balance: '42.00' }] });
    }
    if (req.url !== '/chat/completions') {
      res.writeHead(404);
      return res.end('not found');
    }
    const body = JSON.parse(raw || '{}');
    const system = body.messages?.[0]?.content || '';
    if (body.response_format) {
      const isConsolidation = system.includes('睡眠巩固');
      console.log(`[mock] ${isConsolidation ? '睡眠巩固' : '记忆整理'}请求 → 返回 JSON`);
      return sendJSON(res, { choices: [{ message: { content: isConsolidation ? CONSOLIDATION : EXTRACTION } }], usage: { prompt_tokens: 300, completion_tokens: 120 } });
    }

    const line = CHAT_LINES[Math.floor(Math.random() * CHAT_LINES.length)];
    console.log(`[mock] 聊天请求（${body.messages?.length || 0} 条消息）→ ${line}`);
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    let i = 0;
    const timer = setInterval(() => {
      if (i < line.length) {
        const chunk = line.slice(i, i + 4);
        i += 4;
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: chunk } }] })}\n\n`);
      } else {
        clearInterval(timer);
        res.write(`data: ${JSON.stringify({ choices: [{ delta: {} }], usage: { prompt_tokens: 800, completion_tokens: 40 } })}\n\n`);
        res.write('data: [DONE]\n\n');
        res.end();
      }
    }, 30);
    res.on('close', () => clearInterval(timer));
  });
});

server.listen(port, '127.0.0.1', () => console.log(`假 DeepSeek 已启动：http://127.0.0.1:${port}（Ctrl+C 退出）`));
