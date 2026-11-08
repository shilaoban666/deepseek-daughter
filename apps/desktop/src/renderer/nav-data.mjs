// 两级导航的结构。Node 测试和界面共用这一份。

export const NAV = [
  { id: 'overview', label: '概览', icon: '◉', tabs: [{ id: 'now', label: '此刻' }, { id: 'today', label: '今天' }] },
  { id: 'mind', label: '意识和记忆', icon: '◎', tabs: [{ id: 'ocean', label: '意识海' }, { id: 'thoughts', label: '思想' }, { id: 'persona', label: '人格' }, { id: 'memory', label: '记忆' }, { id: 'emotion', label: '情绪' }] },
  { id: 'us', label: '我们', icon: '♡', tabs: [{ id: 'moments', label: '回忆' }, { id: 'slang', label: '黑话' }, { id: 'relation', label: '关系' }, { id: 'anniversary', label: '纪念日' }] },
  { id: 'neuro', label: '神经活动', icon: '⌬', tabs: [{ id: 'brain', label: '大脑3D' }, { id: 'system', label: '神经系统' }, { id: 'transmitters', label: '神经递质' }] },
  { id: 'metabolism', label: '代谢活动', icon: '◍', tabs: [{ id: 'digestion', label: '消化活动' }, { id: 'breath', label: '呼吸与心率' }, { id: 'fluid', label: '体液系统' }, { id: 'endocrine', label: '内分泌系统' }, { id: 'urinary', label: '泌尿系统' }, { id: 'reproductive', label: '生殖系统' }] },
  { id: 'immunity', label: '免疫活动', icon: '⛨', tabs: [{ id: 'lymph', label: '淋巴系统' }, { id: 'regulation', label: '免疫调节' }] },
  { id: 'explore', label: '发现探索', icon: '✦', tabs: [{ id: 'platforms', label: '平台插件' }] },
  { id: 'settings', label: '设置', icon: '⚙', tabs: [{ id: 'general', label: '通用' }] },
];

export const DEFAULT_ROUTE = 'overview/now';

export const routes = () => NAV.flatMap((n) => n.tabs.map((t) => `${n.id}/${t.id}`));

export function parseRoute(route) {
  const [view, tab] = String(route ?? '').split('/');
  const n = NAV.find((x) => x.id === view);
  if (!n) return { view: 'overview', tab: 'now' };
  return { view: n.id, tab: (n.tabs.find((t) => t.id === tab) || n.tabs[0]).id };
}
