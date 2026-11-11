// 角色头顶的小图标（内联 SVG，自己画的）。动画里的脸改不了，神情靠这些图标补充。

const svg = (body, color = 'currentColor') => `<svg viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

export const ICONS = {
  zzz: { label: '睡着了', svg: svg('<path d="M4 6h6l-6 7h6"/><path d="M13 3h5l-5 6h5"/><path d="M15 15h4l-4 5h4"/>', '#a98bff') },
  sweat: { label: '着急', svg: svg('<path d="M12 3c3 4.5 5 7.2 5 9.5a5 5 0 0 1-10 0C7 10.2 9 7.5 12 3z"/>', '#7fd0ff') },
  tear: { label: '委屈', svg: svg('<path d="M12 4c2.5 3.8 4 6 4 8a4 4 0 0 1-8 0c0-2 1.5-4.2 4-8z"/><path d="M10 13.5a2 2 0 0 0 2 2"/>', '#7fb2ff') },
  heart: { label: '想你了', svg: svg('<path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/>', '#ff7aa8') },
  note: { label: '开心', svg: svg('<path d="M9 18V5l11-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/>', '#f5c242') },
  icepack: { label: '发烧了', svg: svg('<rect x="4" y="8" width="16" height="9" rx="3"/><path d="M8 8V6m8 2V6M8 12.5h8"/>', '#9fe8ff') },
  cup: { label: '在喝水', svg: svg('<path d="M5 8h12v6a5 5 0 0 1-5 5h-2a5 5 0 0 1-5-5z"/><path d="M17 10h2a2 2 0 0 1 0 4h-2"/><path d="M9 3c0 1 1 1 1 2m3-2c0 1 1 1 1 2"/>', '#c9e7ff') },
  phone: { label: '在看手机', svg: svg('<rect x="7" y="3" width="10" height="18" rx="2"/><path d="M11 18h2"/>', '#9fe8ff') },
  book: { label: '在看书', svg: svg('<path d="M4 5a2 2 0 0 1 2-2h5v17H6a2 2 0 0 0-2 1z"/><path d="M20 5a2 2 0 0 0-2-2h-5v17h5a2 2 0 0 1 2 1z"/>', '#f0a35e') },
  dots: { label: '在想', svg: svg('<path d="M4 12a8 7 0 1 1 3 5.4L4 19z"/><circle cx="9" cy="11.5" r=".6"/><circle cx="12" cy="11.5" r=".6"/><circle cx="15" cy="11.5" r=".6"/>', '#c6d6ee') },
  bang: { label: '吓了一跳', svg: svg('<path d="M12 4v10"/><circle cx="12" cy="19" r=".8"/>', '#ff9a3c') },
};

/** 把图标画进 el，已经在的不重画，免得动画每秒闪一下 */
export function renderIcons(el, ids) {
  const want = ids.filter((id) => ICONS[id]).join(',');
  if (el.dataset.icons === want) return;
  el.dataset.icons = want;
  el.innerHTML = ids.filter((id) => ICONS[id]).map((id) => `<span class="pet-icon" title="${ICONS[id].label}">${ICONS[id].svg}</span>`).join('');
}
