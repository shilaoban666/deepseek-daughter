// 设置页：DeepSeek、名字、备份、关于。平台插件在「发现探索」（views/explore.js）。

import { esc } from './util.js';

const MODELS = [
  ['deepseek-chat', 'deepseek-chat（日常聊天，推荐）'],
  ['deepseek-reasoner', 'deepseek-reasoner（深度思考，更慢更贵）'],
];

/** 关于：各组件版本，排查问题时看这里 */
function aboutCard(v, petSkin) {
  if (!v) return '';
  const pet = petSkin
    ? `<p>角色动画：dsh-pet 的鲸鱼娘，作者 PC2005-cloud（github.com/PC2005-cloud/dsh-pet${petSkin.source?.version ? ` · ${esc(petSkin.source.version)}` : ''}）。素材禁止商用。</p>`
    : '<p>角色：内置的原创 3D 鲸鱼。</p>';
  return `<div class="card plat" id="about">
      <div class="plat-head"><div class="plat-icon" style="background:linear-gradient(135deg,#4fd6ff,#2a3fb0)">i</div>
        <div><b>关于</b><small>大肥鱼 ${esc(v.app)}</small></div></div>
      <div class="stats set-ver"><div class="stat"><b>${esc(v.app)}</b><span>大肥鱼</span></div><div class="stat"><b>${esc(v.electron)}</b><span>Electron</span></div><div class="stat"><b>${esc(v.node)}</b><span>Node</span></div><div class="stat"><b>${esc(String(v.chrome).split('.')[0])}</b><span>Chromium</span></div>${v.dsh ? `<div class="stat"><b>${esc(v.dsh)}</b><span>DSH 内核</span></div>` : ''}</div>
      <p class="mono faint sm">Electron ${esc(v.electron)} · Node ${esc(v.node)} · Chromium ${esc(v.chrome)}</p>
      ${pet}
      <p>大脑皮层网格：Anderson Winkler，Brain for Blender，CC BY-SA 3.0。</p>
      ${v.dsh ? `<p>内核：DeepSeek Harness ${esc(v.dsh)}，BSD-3-Clause，Copyright (c) 2026 DeepSeek。各组件的许可证原文随程序一起分发；完整清单见项目仓库的 docs/第三方许可.md。</p>` : ''}
    </div>`;
}

export function renderLinks(root, S, actions) {
  const st = S.settings;
  const bal = S.vitals?.balance;
  const mem = S.memory?.stats || {};
  const backups = S.backups || null;
  let status = '<span class="status">未连接</span>';
  if (st.hasKey && bal && !bal.error) status = `<span class="status ok">● 已连接 · 余额 ${bal.total.toFixed(2)} 元</span>`;
  else if (st.hasKey && bal?.error) status = `<span class="status err">${esc(bal.error)}</span>`;
  else if (st.hasKey) status = '<span class="status">已填写，检查中…</span>';
  const modelKnown = MODELS.some(([v]) => v === st.model);
  const u = S.vitals?.usageToday || { prompt: 0, completion: 0, calls: 0 };
  const budget = S.vitals?.budget || { ratio: 0, used: 0, limit: 0 };
  const pct = Math.round(Math.min(1, budget.ratio || 0) * 100);
  const named = !!(st.userName || st.userTitle);
  const talked = (S.history || []).some((m) => m.role === 'user');
  const steps = [[st.hasKey, '填上 DeepSeek Key', '她才能思考和说话'], [named, '告诉她你是谁', '名字和她怎么叫你'], [talked, '跟她说第一句话', '在右边的聊天栏']];
  const done = steps.filter((x) => x[0]).length;

  root.innerHTML = `
    
    <div class="p set-start${done === 3 ? ' all' : ''}">
      <div class="set-start-t"><b>${done === 3 ? '都准备好了' : '三步开始'}</b><span>${done} / 3</span></div>
      <div class="set-steps">${steps.map(([ok, t, d], i) => `<div class="set-step${ok ? ' ok' : ''}"><i>${ok ? '✓' : i + 1}</i><div><b>${t}</b><span>${d}</span></div></div>`).join('')}</div>
    </div>
    <div class="set-grid">
    <div class="card plat">
      <div class="plat-head"><div class="plat-icon" style="background:linear-gradient(135deg,#4d6bfe,#2a3fb0)">D</div>
        <div><b>DeepSeek</b><small>她的大脑 · 每次思考都会调用</small></div>${status}</div>
      <label class="field">API Key
        <input id="lk-key" type="password" autocomplete="off" spellcheck="false" placeholder="${st.hasKey ? '已保存（加密存在本机）。要更换就粘贴新的' : 'sk-...'}">
      </label>
      <label class="field">模型
        <select id="lk-model">${MODELS.map(([v, n]) => `<option value="${v}" ${v === st.model ? 'selected' : ''}>${n}</option>`).join('')}${modelKnown ? '' : `<option value="${esc(st.model)}" selected>${esc(st.model)}</option>`}</select>
      </label>
      <div class="row">
        <button class="primary" id="lk-save">保存并连接</button>
        <button class="ghost" id="lk-refresh" ${st.hasKey ? '' : 'disabled'}>刷新余额</button>
        <button class="link" id="lk-get">去 DeepSeek 开放平台获取 Key</button>
      </div>
      <p>🔒 Key 只保存在这台电脑上，用系统加密；只会发给 DeepSeek。</p>
      <div class="set-usage"><div class="set-meter"><div class="h"><span>今天的饭钱用了</span><b>${pct}%</b></div><div class="tr"><i style="width:${pct}%"></i></div></div>
        <div class="stats"><div class="stat"><b>${bal && !bal.error ? `¥${bal.total.toFixed(2)}` : '—'}</b><span>余额</span></div><div class="stat"><b>${u.calls}</b><span>今天调用</span></div><div class="stat"><b>${((u.prompt + u.completion) / 1000).toFixed(1)}k</b><span>今天的 Token</span></div></div></div>
    </div>

    <div class="card plat">
      <div class="plat-head"><div class="plat-icon" style="background:linear-gradient(135deg,#f5c242,#c9853f)">你</div>
        <div><b>她和你</b><small>她的名字，以及她怎么认识你</small></div></div>
      <label class="field">她叫什么<input id="lk-dname" value="${esc(st.daughterName || '')}" maxlength="12" placeholder="给她取个名字"></label>
      <label class="field">你的名字<input id="lk-name" value="${esc(st.userName || '')}" placeholder="她会记住"></label>
      <label class="field">她叫你什么<input id="lk-title" value="${esc(st.userTitle || '')}" placeholder="比如：老爸、老妈、名字"></label>
      <div class="row"><button class="primary" id="lk-save-me">保存</button></div>
    </div>

    <div class="card plat">
      <div class="plat-head"><div class="plat-icon" style="background:linear-gradient(135deg,#a98bff,#4d6bfe)">记</div>
        <div><b>记忆与备份</b><small>${mem.active || 0} 条在记着 · ${mem.archived || 0} 条归档 · ${mem.conflicts || 0} 条待求证</small></div></div>
      <div class="stats"><div class="stat"><b>${mem.active || 0}</b><span>在记着</span></div><div class="stat"><b>${mem.archived || 0}</b><span>归档</span></div><div class="stat"><b class="${mem.conflicts ? 'warn' : ''}">${mem.conflicts || 0}</b><span>待求证</span></div></div>
      <p>她每晚睡觉时会回放当天、提炼事实、写日记、微调性格；六层记忆和每天一次的备份都只存在这台电脑上。</p>
      <div class="row">
        <button class="ghost" id="lk-consolidate">现在整理一次</button>
        <button class="ghost" id="lk-backup">立即备份</button>
        <button class="link" id="lk-backups">查看备份</button>
      </div>
      ${backups && backups.length ? `<ul class="intake-list">${backups.map((b) => `<li><span class="mono">${esc(b.day)}</span><span>${b.files} 个文件</span><b>${(b.bytes / 1024).toFixed(1)} KB</b></li>`).join('')}</ul>` : ''}
    </div>
    ${aboutCard(S.versions, S.petSkin)}
    </div>`;

  const q = (s) => root.querySelector(s);
  q('#lk-save').addEventListener('click', () => {
    const key = q('#lk-key').value.trim();
    if (key && !/^sk-[A-Za-z0-9_-]{10,}$/.test(key)) {
      alert('这看起来不像 DeepSeek 的 API Key（应该以 sk- 开头）。');
      return;
    }
    actions.save({ apiKey: key, model: q('#lk-model').value });
  });
  q('#lk-refresh').addEventListener('click', () => actions.refreshBalance());
  q('#lk-get').addEventListener('click', () => actions.openExternal('https://platform.deepseek.com/api_keys'));
  q('#lk-save-me').addEventListener('click', () => actions.save({ daughterName: q('#lk-dname').value, userName: q('#lk-name').value, userTitle: q('#lk-title').value }));
  q('#lk-consolidate').addEventListener('click', () => actions.consolidate());
  q('#lk-backup').addEventListener('click', () => actions.backup());
  q('#lk-backups').addEventListener('click', () => actions.loadBackups());
}
