// 设置：名字、DeepSeek、记忆与备份。

import { renderLinks } from '../links.js';

export function render(el, _tab, ctx) {
  renderLinks(el, ctx.S, ctx.linkActions);
}
