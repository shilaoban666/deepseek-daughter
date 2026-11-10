// 设置页：DeepSeek、名字、备份。平台列表 PLATFORMS 给「发现探索」用。

import { esc } from './util.js';

export const PLATFORMS = [
  { name: 'QQ', color: '#1d9bf0', mark: 'Q', stage: '阶段 3', desc: '通过 OneBot（NapCat / LLOneBot）住进 QQ：私聊、群聊、主动找你。', field: { key: 'onebotUrl', label: 'OneBot WebSocket 地址', ph: 'ws://127.0.0.1:3001' } },
  { name: '微信', color: '#07c160', mark: '微', stage: '阶段 3', desc: '在微信里和你聊天、发朋友圈评论（需要你同意才发）。' },
  { name: 'B 站', color: '#fb7299', mark: 'B', stage: '阶段 4', desc: '自己刷视频、看字幕“吃饭”，把看到的有意思的东西讲给你听。' },
  { name: '小说', color: '#c9853f', mark: '书', stage: '阶段 4', desc: '读你推荐的小说，读完写读后感，记住剧情和人物。' },
  { name: '抖音', color: '#25f4ee', mark: '抖', stage: '阶段 5', desc: '刷短视频，偶尔留言。' },
  { name: '小红书', color: '#ff2442', mark: '红', stage: '阶段 5', desc: '看笔记、收藏喜欢的东西。' },
  { name: 'X', color: '#8899a6', mark: 'X', stage: '阶段 5', desc: '关注感兴趣的话题。' },
  { name: 'YouTube', color: '#ff0033', mark: '▶', stage: '阶段 5', desc: '看视频、学东西。' },
];

const MODELS = [
  ['deepseek-chat', 'deepseek-chat（日常聊天，推荐）'],
  ['deepseek-reasoner', 'deepseek-reasoner（深度思考，更慢更贵）'],
];

/** 关于：各组件版本，排查问题时看这里 */
function aboutCard(v) {
  if (!v) return '';
  return `<div class="card plat" id="about">
      <div class="plat-head"><div class="plat-icon" style="background:linear-gradient(135deg,#4fd6ff,#2a3fb0)">i</div>
        <div><b>关于</b><small>大肥鱼 ${esc(v.app)}</small></div></div>
      <p class="mono">Electron ${esc(v.electron)} · Node ${esc(v.node)} · Chromium ${esc(v.chrome)}</p>
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

  root.innerHTML = `
    
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
      <p>Key 只保存在这台电脑上，用系统加密；只会发给 DeepSeek。</p>
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
      <p>她每晚睡觉时会回放当天、提炼事实、写日记、微调性格；六层记忆和每天一次的备份都只存在这台电脑上。</p>
      <div class="row">
        <button class="ghost" id="lk-consolidate">现在整理一次</button>
        <button class="ghost" id="lk-backup">立即备份</button>
        <button class="link" id="lk-backups">查看备份</button>
      </div>
      ${backups && backups.length ? `<ul class="intake-list">${backups.map((b) => `<li><span class="mono">${esc(b.day)}</span><span>${b.files} 个文件</span><b>${(b.bytes / 1024).toFixed(1)} KB</b></li>`).join('')}</ul>` : ''}
    </div>
    ${aboutCard(S.versions)}`;

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
