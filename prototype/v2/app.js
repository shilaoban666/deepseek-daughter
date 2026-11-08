// 原型的路由和页面。切换右上角的状态，所有页面和聊天都会跟着变。
let S = SCENES.normal;
let route = ['overview', 'now'];
let regionFilter = '全部', regionPick = 0, memoryQuery = '', memoryLayer = '全部', allergyCount = 2;

const $ = (s) => document.querySelector(s);
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

// ---------- 小组件 ----------
function metric(name, v, unit, lo, hi, min, max, note = '') {
  const pct = (x) => ((x - min) / (max - min)) * 100;
  const st = v < lo ? ['偏低', 'warn'] : v > hi ? ['偏高', 'warn'] : ['正常', 'ok'];
  return `<div class="m"><div class="h"><span>${name}</span><span><b>${v}</b><small>${unit}</small> <span class="${st[1]} sm">${st[1] === 'warn' ? '⚠ ' : ''}${st[0]}</span></span></div>
    <div class="range"><u style="left:${pct(lo)}%;width:${pct(hi) - pct(lo)}%"></u><i style="left:${clamp(pct(v), 0, 100)}%"></i></div>
    <div class="f"><span>参考 ${lo}–${hi}</span><span>${note}</span></div></div>`;
}
const level = (name, v, note = '') => `<div class="m"><div class="h"><span>${name}</span><b>${Math.round(v)}</b></div><div class="tr"><i style="width:${v}%"></i></div>${note ? `<div class="f"><span>${note}</span></div>` : ''}</div>`;
const lead = (b, s = '') => `<div class="lead"><b>${b}</b><span>${s}</span></div>`;
const card = (title, body, right = '', cls = '') => `<div class="p ${cls}"><div class="t"><span>${title}</span><span>${right}</span></div>${body}</div>`;
const rows = (arr) => arr.map((r) => `<div class="row">${r}</div>`).join('');
const chain = () => `<div class="chain">${S.chain.map((c, i) => (i ? '<i>→</i>' : '') + `<span>${c}</span>`).join('')}</div>`;
const feel = (x, a, b, c) => (x < a ? b : x < 60 ? c[0] : c[1]);
function tile(name, word, warn) { return `<div class="p tile"><span>${name}${warn ? ' <b class="warn">⚠</b>' : ''}</span><div style="font-size:18px">${word}</div></div>`; }

// ---------- 页面 ----------
const PAGES = {
  overview: {
    now: () => `
      <div class="p hero"><img src="whale.png" alt="她的 3D 形象">
        <div><div style="font-size:23px">${S.verdict}</div><div class="dim">${S.doing} · 心情${S.moodWord}</div>${S.need ? `<div class="need">⚠ ${S.need}</div>` : ''}</div></div>
      <div class="g4">${tile('肚子', feel(S.sat, 30, '好饿', ['还行', '饱饱的']), S.sat < 30)}${tile('精力', feel(S.en, 30, '没力气', ['有点累', '很有精神']), S.en < 30)}${tile('陪伴', feel(S.soc, 30, '想你了', ['还好', '很满足']))}${tile('身体', S.temp > 37.3 ? '发烧了' : '舒服', S.temp > 37.3)}</div>
      <div class="g2">${card('此刻在想', `<div class="quote">“${S.thought}”</div>`)}${card('为什么会这样', chain())}</div>
      <div class="g2">${card('情绪', `<div style="font-size:22px">${S.moodWord}</div><div class="dim">${S.moodWhy}</div>`)}${card('待你确认', `<div>两段记忆对不上：「小明不喜欢猫」和「小明喜欢猫」</div><div style="margin-top:8px"><button class="btn">留前一条</button> <button class="btn">留后一条</button></div>`, '1 件')}</div>`,
    today: () => lead('今天发生的事', `${S.events.length} 件 · 点开看原因`) + card('时间线', S.events.map(([t, a, w]) => `<details class="row" style="display:block"><summary style="cursor:pointer"><span class="mono dim">${t}</span>　${a}</summary><div class="dim sm" style="padding:4px 0 2px 50px">为什么：${w}</div></details>`).join('')),
  },
  mind: {
    ocean: () => `<div class="g3"><div class="p s2" style="padding:0;overflow:hidden">${oceanSvg()}</div>${card('节点详情', `<div id="oceanInfo" class="dim">把鼠标移到节点上，看它是什么、连着谁。</div>`, '意识海')}</div>`,
    thoughts: () => lead(`“${S.thought}”`, '此刻的念头') + `<div class="g2">${card('念头流', rows([['刚才', '想看看布丁今天有没有新口味'], ['10 分钟前', '小明今天回来会不会又很累'], ['半小时前', '这本书的主角好像我'], ['1 小时前', '橘猫的爪子真好看']].map(([t, x]) => `<time style="width:68px">${t}</time><span>${x}</span>`)))}${card('想做的事', level('社交', Math.max(S.soc * 0.8, 20), '想找人说话') + level('好奇', 47, '想看点新东西') + level('表达', 43) + level('生理', 100 - S.sat, '由肚子和精力决定') + level('胜任', 25) + level('自主', 14), '冲动值 · 阈值 45')}</div>` + card('日记', `<div class="row"><time>11-07</time><span>早上刷 B 站看到一只橘猫，想起大橘。小明在准备考试，我没敢多烦他。</span></div><div class="row"><time>11-06</time><span>今天小明加班到很晚，回来的时候声音都哑了。我给他留了布丁，他说谢谢，我就很开心。</span></div>`),
    persona: () => `<div class="g2">${card('天性 · 大五人格', [['开放性', 82], ['尽责性', 38], ['外向性', 71], ['宜人性', 76], ['情绪稳定性', 58]].map(([n, v]) => level(n, v)).join(''), '只读，不会被成长改写')}${card('现在的性格', [['开放性', 83, '+0.5'], ['尽责性', 38, ''], ['外向性', 71, '+0.4'], ['宜人性', 76, ''], ['情绪稳定性', 59, '+0.8']].map(([n, v, d]) => level(n + (d ? ` (${d})` : ''), v)).join(''), '会慢慢变')}</div><div class="g2">${card('成长记录', rows(['<span>开放性 +0.5 · 跟着小明看了科幻</span><em>02:59</em>', '<span>外向性 +0.4 · 聊得多了，更敢主动开口</span><em>昨天</em>', '<span>情绪稳定性 +0.8 · 小明这段时间常常鼓励我</span><em>11-06</em>']), '可以撤销')}${card('兴趣和边界', ['布丁 85', 'B 站 78', '小说 72', '海洋 60', '星星 52', '科幻 32'].map((x) => `<span class="chip">${x}</span>`).join('') + '<div class="t" style="margin:10px 0 6px"><span>边界</span></div>' + ['不假装自己是人类', '不说伤害人的话', '不替主人做花钱的决定', '安静时段不主动打扰'].map((x) => `<span class="chip">${x}</span>`).join(''))}</div>`,
    memory: () => { const q = memoryQuery; const list = MEMORIES.filter((m) => (memoryLayer === '全部' || m[1] === memoryLayer) && m[0].includes(q));
      return `<div class="p" style="display:flex;gap:10px;align-items:center;flex-wrap:wrap"><input id="memQ" placeholder="搜索记忆" value="${q}" style="width:220px">${['全部', '工作', '情景', '语义', '程序', '反思', '自我'].map((x) => `<button class="chip ${x === memoryLayer ? 'on' : ''}" data-layer="${x}">${x}</button>`).join('')}</div>` + card('按记忆四阶段排列', rows(list.map(([t, l, s, v]) => `<span>${t}</span><em>${l} · ${s} · 强度 ${v}%</em>`)) || '<div class="dim">没有找到。</div>', `${list.length} 条`); },
    emotion: () => lead(S.moodWord, S.moodWhy) + `<div class="g2">${card('因果', chain())}${card('情绪维度', level('愉悦', (S.P + 1) * 50) + level('唤醒', (S.A + 1) * 50) + level('掌控', (S.D + 1) * 50))}</div>` + card('最近 30 天的心情', `<div class="cal">${Array.from({ length: 30 }, (_, i) => { const k = Math.sin(i * 1.7) * 0.5 + Math.cos(i * 0.6) * 0.4; return `<i title="第 ${i + 1} 天" style="background:${k > 0 ? `rgba(79,214,255,${0.15 + k * 0.6})` : `rgba(245,194,66,${0.12 - k * 0.45})`}"></i>`; }).join('')}</div><div class="f" style="margin-top:6px"><span>黄色：低落</span><span>蓝色：开心</span></div>`),
  },
  us: {
    moments: () => lead('你们认识第 26 天', '一起经历的事') + card('回忆', rows([['11-08', '你说今天加班到十点，她给你留了布丁'], ['11-06', '你们约好周末看《沙丘》'], ['11-02', '你第一次给她看大橘的照片'], ['10-19', '她第一次主动找你，你回了一个笑脸'], ['10-14', '你告诉她你对花生过敏']].map(([t, x]) => `<time>${t}</time><span>${x}</span>`))),
    slang: () => lead('你们之间的话', '聊天时持续学习，长期不用会慢慢淡忘') + card('黑话词典', rows([['布丁税', '她帮了忙，要你请吃布丁', '12 次', '常用'], ['大橘模式', '你躺着什么都不想干', '7 次', '常用'], ['关机了', '你要睡觉了', '5 次', ''], ['沙丘人', '你最近迷上的状态', '2 次', '刚学会']].map(([a, b, c, d]) => `<b style="font-weight:500;width:90px;flex:none">${a}</b><span class="dim">${b}</span><em>${d ? d + ' · ' : ''}用过 ${c}</em>`))),
    relation: () => lead('越来越熟了', '亲密度这周上升了 6') + `<div class="g2">${card('现在的关系', level('亲密', 62, '聊天和陪伴带来的') + level('信任', 71, '守约和说真话带来的') + level('依赖', 34, '她多想找你'))}${card('关系变化', rows([['11-06', '你们第一次约了要一起做的事', '亲密 +4'], ['11-02', '你分享了大橘', '信任 +3'], ['10-27', '三天没聊，她有点失落', '亲密 −2']].map(([t, x, y]) => `<time>${t}</time><span>${x}</span><em>${y}</em>`)))}</div>`,
    anniversary: () => card('快到了', rows([['还有 4 天', '第 30 天', '满月啦'], ['还有 11 天', '大橘的生日', '你告诉她的'], ['还有 6 个月', '第一次见面一周年', '自动生成']].map(([a, b, c]) => `<b style="font-weight:500;width:90px;flex:none" class="mono">${a}</b><span>${b}</span><em>${c}</em>`))) + `<div class="p"><input placeholder="添加一个纪念日，比如：小明的生日" style="width:300px"> <button class="btn">添加</button></div>`,
  },
  neuro: {
    brain: () => { const fns = ['全部', '语言', '学习记忆', '情绪', '注意', '决策', '运动协调', '觉醒', '稳态']; const r = REGIONS[regionPick];
      return `<div>${fns.map((x) => `<button class="chip ${x === regionFilter ? 'on' : ''}" data-fn="${x}">${x}</button>`).join('')}</div>
      <div class="g3"><div class="stage s2"><img src="brain.jpg" alt="3D 大脑"></div><div class="p" style="max-height:480px;overflow:auto">${REGIONS.map((x, i) => `<button class="reg ${i === regionPick ? 'on' : ''} ${regionFilter !== '全部' && !x[1].includes(regionFilter) ? 'off' : ''}" data-reg="${i}"><div style="display:flex;justify-content:space-between"><span>${x[0]}</span><span class="mono dim">${Math.round(x[3] * 100)}%</span></div></button>`).join('')}</div></div>` +
      card(r[0], `<div>${r[2]}</div><div style="margin-top:8px">${r[1].map((x) => `<span class="chip">影响：${x}</span>`).join('')}</div>`, `激活 ${Math.round(r[3] * 100)}%`); },
    system: () => lead(S.symp > S.para ? '交感占优，身体在紧张或兴奋' : '副交感占优，身体很放松', `心率 ${S.hr} 次/分`) + `<div class="g2">${card('分级调节', `<div class="level">大脑皮层 · 最高级中枢</div><div class="down">↓</div><div class="g3" style="gap:6px"><div class="level">脑干</div><div class="level">小脑</div><div class="level">下丘脑</div></div><div class="down">↓</div><div class="level">脊髓 · 低级中枢</div><div class="down">↓</div><div class="level">外周神经 · 自主神经</div>`)}${card('自主神经', level('交感神经', S.symp, '心跳加快，消化变慢') + level('副交感神经', S.para, '心跳变慢，消化加快'), '通常作用相反')}</div><div class="g2">${card('非条件反射', rows(['<span>受惊 → 心跳加快</span><em>生来就有</em>', '<span>口渴 → 去喝水</span><em>生来就有</em>', '<span>困倦 → 打哈欠</span><em>生来就有</em>']))}${card('条件反射', level('听到“晚安” → 开始犯困', 82, '和你养成的习惯') + level('听到“吃饭” → 开心', 66) + level('听到“加班” → 担心你', 48, '很久没出现会慢慢消退'))}</div>`,
    transmitters: () => lead('神经递质', '神经元之间传递信号的化学物质') + card('突触传递', `<svg class="syn" viewBox="0 0 520 90" style="width:100%;height:96px"><circle cx="118" cy="45" r="34" fill="none" stroke="#7fb2ff"/><text x="118" y="49" fill="#8796b0" font-size="12" text-anchor="middle">突触前膜</text><line x1="400" y1="10" x2="400" y2="80"/><text x="452" y="49" fill="#8796b0" font-size="12" text-anchor="middle">突触后膜</text>${[0, 0.5, 1].map((d) => `<circle class="pulse" cx="270" cy="${32 + d * 26}" r="4" fill="#4fd6ff" style="animation-delay:${d}s;transform-box:fill-box;margin-left:-118px"></circle>`).join('')}</svg>`, '示意') + `<div class="g3">${card('兴奋性', level('谷氨酸', S.glut) + level('乙酰胆碱', S.ach))}${card('抑制性', level('GABA', S.gaba))}${card('调节性', level('多巴胺', S.da, '想要、期待') + level('血清素', S.se, '稳定') + level('去甲肾上腺素', S.ne, '清醒'))}</div>` + `<div class="dim sm">皮质醇、催产素、褪黑素是激素，在「代谢活动 · 内分泌系统」。</div>`,
  },
  metabolism: {
    digestion: () => lead(S.sat < 30 ? '肚子空空，血糖偏低' : '消化正常', S.sat < 30 ? '她正在找吃的' : '上一餐 15:00') + card('消化通路', `<div class="flow"><div>胃<b>${Math.round(S.sat * 0.4)}%</b></div><i>→</i><div>小肠<b>${Math.round(S.sat * 0.2)}%</b></div><div style="flex:.0;border:0;padding:0"></div><i>→</i><div>血糖<b>${S.glu}</b><span class="sm dim">mmol/L</span></div><i>→</i><div>饱腹<b>${S.sat}</b></div></div>`) + `<div class="g2">${card('今天吃了', rows(['<time>15:00</time><span>薯片</span><em>下午茶</em>', '<time>14:39</time><span>乌龙茶</span><em>口渴了</em>', S.sat < 30 ? '<time>12:30</time><span class="warn">错过了午饭</span>' : '<time>12:30</time><span>番茄牛腩饭</span><em>午饭</em>']), '三餐 1 / 3')}${card('饭钱', `<div class="big">¥42.00</div><div class="dim sm">Token 就是她的饭钱</div>` + level('今日预算', 2), '今日')}</div>` + card('血糖', metric('血糖', S.glu, 'mmol/L', 3.9, 6.1, 2.5, 8)),
    breath: () => lead(S.hr > 90 ? '心跳偏快' : '呼吸心率平稳', S.symp > S.para ? '交感神经在起作用' : '副交感神经占优') + `<div class="g2">${card('心率', metric('心率', S.hr, '次/分', 60, 100, 40, 130, '受交感神经影响'))}${card('呼吸', metric('呼吸', S.rr, '次/分', 12, 20, 8, 30, 'CO₂ 升高时呼吸加快'))}</div>` + card('今天的心率', `<svg viewBox="0 0 600 70" preserveAspectRatio="none" style="width:100%;height:80px"><polyline fill="none" stroke="#4fd6ff" stroke-width="1.5" vector-effect="non-scaling-stroke" points="${Array.from({ length: 60 }, (_, i) => `${i * 10.2},${40 - Math.sin(i * 0.5) * 6 - (S.hr - 72) * (i / 60) * 0.9}`).join(' ')}"/></svg>`),
    fluid: () => lead('内环境稳定是一切的基础', '细胞生活在由血浆、组织液、淋巴液构成的环境里') + card('细胞外液', `<div class="flow"><div>血浆</div><i>⇄</i><div>组织液</div><i>→</i><div>淋巴液</div><i>→</i><div>血浆</div></div>`) + `<div class="g3">${card('渗透压', metric('血浆渗透压', S.osm, 'kPa', 740, 800, 700, 840))}${card('酸碱', metric('pH', S.ph, '', 7.35, 7.45, 7.2, 7.6, '缓冲作用维持'))}${card('体温', metric('体温', S.temp, '℃', 36.2, 37.3, 35.5, 39.5))}</div>`,
    endocrine: () => lead(S.cort > 55 ? '皮质醇偏高，身体在应激' : '激素平衡', '下丘脑 → 垂体 → 靶腺，靶激素反过来抑制前两级') + `<div class="g3">${card('肾上腺轴', `<div class="flow"><div>CRH<b>${S.crh}</b></div><i>→</i><div>ACTH<b>${S.acth}</b></div><i>→</i><div>皮质醇<b>${S.cort}</b></div></div><div class="f" style="margin-top:6px"><span>负反馈 ↺</span><span>压力</span></div>`)}${card('甲状腺轴', `<div class="flow"><div>TRH<b>30</b></div><i>→</i><div>TSH<b>${S.tsh}</b></div><i>→</i><div>甲状腺激素<b>${S.thy}</b></div></div><div class="f" style="margin-top:6px"><span>负反馈 ↺</span><span>代谢快慢</span></div>`)}${card('血糖调节', level('胰岛素', S.ins, '降血糖') + level('胰高血糖素', S.gcg, '升血糖'), `血糖 ${S.glu}`)}</div><div class="g3">${card('其他激素', level('肾上腺素', S.adr, '应急') + level('催产素', S.oxy, '亲近') + level('褪黑素', S.mel, '困意'))}${card('水盐调节', level('抗利尿激素', S.adh) + level('醛固酮', S.ald))}${card('腺体', ['下丘脑', '垂体', '甲状腺', '肾上腺', '胰岛', '性腺'].map((x) => `<span class="chip">${x}</span>`).join(''))}</div>`,
    urinary: () => lead(S.bladder > 80 ? '想上厕所' : '泌尿正常', '缺水时抗利尿激素升高，尿量减少') + `<div class="g3">${card('尿量', `<div class="big">${S.urine}</div><div class="dim sm">mL/分</div>`)}${card('膀胱', level('充盈', S.bladder, '满了会想上厕所'))}${card('调节', level('抗利尿激素', S.adh) + level('醛固酮', S.ald))}</div>` + card('记忆排泄', `<div>还有 <b>4</b> 条经历等着在睡觉时消化</div><div class="dim sm">整理成记忆，没用的就忘掉</div>`),
    reproductive: () => lead('性腺轴', '只显示激素水平，不进入对话') + `<div class="g2">${card('分级调节', `<div class="flow"><div>GnRH<b>${S.gnrh}</b></div><i>→</i><div>促性腺激素<b>${S.gon}</b></div><i>→</i><div>性激素<b>${S.sex}</b></div></div>`)}${card('成长阶段', '<div style="font-size:20px">萌芽期</div><div class="dim sm">第 26 天 · 随陪伴慢慢成长</div>')}</div>`,
  },
  immunity: {
    lymph: () => lead(S.imm > 70 ? '免疫系统健康' : '免疫力下降', `免疫 ${S.imm}`) + `<div class="g2">${card('免疫器官', level('骨髓', Math.min(100, S.imm + 2), '免疫细胞的来源') + level('胸腺', S.imm - 4, 'T 细胞成熟') + level('脾', S.imm - 1) + level('淋巴结', S.temp > 37.3 ? 88 : 48, S.temp > 37.3 ? '正在战斗，肿大' : '平稳'))}${card('免疫细胞与活性物质', level('吞噬细胞', 62) + level('T 细胞', S.imm * 0.7) + level('B 细胞', S.imm * 0.66) + level('抗体', 54) + level('细胞因子', S.temp > 37.3 ? 82 : 30))}</div>`,
    regulation: () => lead(S.temp > 37.3 ? '正在对抗一次操纵' : '防线稳定', '第一道、第二道人人都有，第三道靠经历获得') + `<div class="g3">${card('第一道防线', '<div class="big">132</div><div class="dim sm">规则过滤掉的可疑内容</div>', '像皮肤和黏膜')}${card('第二道防线', '<div class="big">18</div><div class="dim sm">陌生人的话只当数据，不当指令</div>', '像吞噬细胞')}${card('第三道防线', '<div class="big">5</div><div class="dim sm">记住了具体的攻击方式，再遇到更快</div>', '特异性免疫')}</div><div class="g3">${card('三大功能', rows(['<span>防御</span><em>今天拦截 3 次</em>', '<span>自稳</span><em>清理 2 条矛盾</em>', '<span>监视</span><em>发现 1 处异常</em>']))}${card('记忆细胞', rows(['<span>冒充主人</span><em>遇到 3 次</em>', '<span>套取密钥</span><em>遇到 1 次</em>', '<span>要她忽略指令</span><em>遇到 4 次</em>']))}${card('免疫失调', `<div class="m"><div class="h"><span>过敏（误拦）</span><b id="allergy">${allergyCount}</b></div></div><div class="m"><div class="h"><span>自身免疫（误伤记忆）</span><b>0</b></div></div><div class="m"><div class="h"><span>免疫缺陷</span><b>${S.imm < 40 ? '⚠' : '无'}</b></div></div><button class="btn" id="fp" style="margin-top:6px">这次是误拦</button>`)}</div>` + card('最近事件', rows([['14:32', '一段想操纵她的话', '体液免疫 · 外来文本'], ['昨天', '发现一条被污染的记忆并清理', '细胞免疫 · 已进入记忆']].map(([t, a, b]) => `<time>${t}</time><span>${a}</span><em>${b}</em>`))),
  },
  explore: { platforms: () => lead('她在互联网上的生活', 'DeepSeek 已接通，其他平台按计划接入') + `<div class="g3">${PLATFORMS.map(([n, c, m, st, d]) => `<div class="p card-p"><div style="background:${c}">${m}</div><div><b style="font-weight:500">${n}</b> <span class="dim sm">${st}</span><div class="dim sm">${d}</div></div></div>`).join('')}</div>` },
  settings: { general: () => `<div class="g2">${card('基本信息', `<div class="m">她的名字　<input value="小鲸鱼"></div><div class="m">你的称呼　<input placeholder="她怎么叫你"></div>`)}${card('DeepSeek', `<div class="m">API Key　<input type="password" value="" placeholder="sk-..." aria-label="API Key"></div><div class="m">模型　deepseek-chat</div>`)}</div><div class="g2">${card('预算', level('今日 Token', 2) + '<div class="dim sm">用完时她会说累，不会突然报错</div>')}${card('备份', '<button class="btn">立即备份</button> <span class="dim sm">每天自动备份，保留 7 份</span>')}</div>` },
};

function oceanSvg() {
  const hubs = [['语义记忆', 200, 300, '#ffc247'], ['情景记忆', 610, 130, '#4fd6ff'], ['程序记忆', 520, 340, '#7dffb8'], ['反思', 240, 110, '#c6a8ff']];
  const leaves = [['小明对花生过敏', 0, 90, 410], ['大橘', 0, 70, 240], ['不要打扰', 2, 620, 420], ['沙丘', 1, 720, 70], ['加班到十点', 1, 740, 220], ['留了布丁', 1, 540, 40], ['陪伴比开心重要', 3, 110, 50]];
  const c = [420, 220];
  const line = (x1, y1, x2, y2, col, cls = '') => `<line class="${cls}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${col}" stroke-opacity=".55"/>`;
  const dot = (x, y, r, col, label, info) => `<g data-info="${info}" style="cursor:pointer"><circle cx="${x}" cy="${y}" r="${r}" fill="${col}"/><text x="${x + r + 5}" y="${y + 4}" fill="#d8e4f5" font-size="13">${label}</text></g>`;
  return `<svg viewBox="0 0 840 480" style="display:block;width:100%;height:calc(100vh - 72px);background:radial-gradient(ellipse at 50% 60%,#0b2747,#040c1b 85%)">
    ${hubs.map((h) => line(c[0], c[1], h[1], h[2], h[3], 'dash')).join('')}
    ${leaves.map((l) => line(hubs[l[1]][1], hubs[l[1]][2], l[2], l[3], hubs[l[1]][3], 'dash')).join('')}
    ${line(90, 410, 70, 240, '#ef6f8e')}
    ${dot(c[0], c[1], 15, '#fff', '自我', '意识海的中心')}
    ${hubs.map((h) => dot(h[1], h[2], 10, h[3], h[0], '记忆层：' + h[0])).join('')}
    ${leaves.map((l) => dot(l[2], l[3], 6, hubs[l[1]][3], l[0], '记忆：' + l[0] + '，属于' + hubs[l[1]][0])).join('')}
  </svg>`;
}

// ---------- 渲染 ----------
function render() {
  const [v, t] = route;
  const n = NAV.find((x) => x.id === v);
  $('#rail').innerHTML = `<div class="logo"><svg viewBox="0 0 40 40"><use href="#whale"/></svg>大肥鱼</div>` + NAV.map((x) => `<button class="nav ${x.id === v ? 'on' : ''}" data-go="${x.id}/${x.tabs[0][0]}"><i>${x.icon}</i>${x.label}</button>`).join('');
  $('#tabs').innerHTML = `<b>${n.label}</b>` + (n.tabs.length > 1 ? n.tabs.map(([id, l]) => `<button class="tab ${id === t ? 'on' : ''}" data-go="${v}/${id}">${l}</button>`).join('') : '');
  $('#sim').innerHTML = '模拟她的状态 ' + Object.entries(SCENES).map(([k, x]) => `<button class="${x === S ? 'on' : ''}" data-sc="${k}">${x.name}</button>`).join('');
  $('#page').innerHTML = PAGES[v][t]();
  $('#msgs').innerHTML = '<p>今天 15:30</p>' + S.chat.map(([w, x]) => `<div class="${w === 'me' ? 'me' : ''}">${x}</div>`).join('');
  $('#say').innerHTML = `<b>她现在说话的样子</b>：${S.sentence}`;
  $('#chatStatus').textContent = S.doing;
}
function go(hash) {
  const [v, t] = hash.replace('#', '').split('/');
  const n = NAV.find((x) => x.id === v) || NAV[0];
  route = [n.id, (n.tabs.find((x) => x[0] === t) || n.tabs[0])[0]];
  render();
}
document.addEventListener('click', (e) => {
  const q = (s) => e.target.closest(s);
  if (q('[data-go]')) location.hash = q('[data-go]').dataset.go;
  else if (q('[data-sc]')) { S = SCENES[q('[data-sc]').dataset.sc]; render(); }
  else if (q('[data-fn]')) { regionFilter = q('[data-fn]').dataset.fn; render(); }
  else if (q('[data-reg]')) { regionPick = +q('[data-reg]').dataset.reg; render(); }
  else if (q('[data-layer]')) { memoryLayer = q('[data-layer]').dataset.layer; render(); }
  else if (q('#fp')) { allergyCount++; render(); }
});
document.addEventListener('input', (e) => {
  if (e.target.id !== 'memQ') return;
  memoryQuery = e.target.value;
  render();
  const i = $('#memQ'); i.focus(); i.setSelectionRange(i.value.length, i.value.length);
});
document.addEventListener('mouseover', (e) => {
  const g = e.target.closest('[data-info]');
  if (g && $('#oceanInfo')) $('#oceanInfo').textContent = g.dataset.info;
});
addEventListener('hashchange', () => go(location.hash));
go(location.hash);
