// 发现探索：她能住进的平台。新平台只需要在 links.js 的 PLATFORMS 里加一项。

import { esc } from '../util.js';
import { lead } from './ui.js';
import { PLATFORMS } from '../links.js';

export function render(el, _tab, { S }) {
  const connected = S.settings.hasKey;
  el.innerHTML = lead('她在互联网上的生活', connected ? 'DeepSeek 已接通，其他平台按计划接入' : '先在设置里接通 DeepSeek') +
    `<div class="g3">${PLATFORMS.map((p) => `<div class="p card-p"><div style="background:${p.color}">${esc(p.mark)}</div><div><b>${esc(p.name)}</b> <span class="dim sm">${esc(p.stage)}接入</span><div class="dim sm">${esc(p.desc)}</div></div></div>`).join('')}</div>`;
}
