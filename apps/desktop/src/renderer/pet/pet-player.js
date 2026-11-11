// 鲸鱼娘的视频播放器：两个 <video> 叠在一起交替播放，0.2 秒交叉淡入，切换时没有空白帧。
// 做法参考 dsh-pet（https://github.com/PC2005-cloud/dsh-pet，MIT，Copyright (c) 2026 PC2005-cloud）：
//   - 双缓冲交叉淡入；
//   - 素材“透明”背景实测是 1/255 的透明度，用 SVG 滤镜把透明度整体减一档，背景归零、角色本体看不出变化；
//   - 点击时纵向压扁到 55% 再弹回（Q 弹）。
// 代码是本项目自己写的。

const ALPHA_FIX_ID = 'pet-alpha-fix';

function ensureAlphaFilter() {
  if (document.getElementById(ALPHA_FIX_ID)) return;
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('width', '0');
  svg.setAttribute('height', '0');
  svg.setAttribute('aria-hidden', 'true');
  svg.style.position = 'absolute';
  const filter = document.createElementNS(NS, 'filter');
  filter.id = ALPHA_FIX_ID;
  filter.setAttribute('color-interpolation-filters', 'sRGB');
  const transfer = document.createElementNS(NS, 'feComponentTransfer');
  const fa = document.createElementNS(NS, 'feFuncA');
  fa.setAttribute('type', 'linear');
  fa.setAttribute('slope', '1');
  fa.setAttribute('intercept', '-0.0039215686');
  transfer.appendChild(fa);
  filter.appendChild(transfer);
  svg.appendChild(filter);
  document.body.appendChild(svg);
}

/**
 * @param {HTMLElement} host 播放器挂在这里，host 需要定好宽高
 * @param {{ baseUrl: string, reducedMotion?: boolean, onError?: (clip:string)=>void }} opts
 */
export function createPlayer(host, { baseUrl, reducedMotion = false, onError } = {}) {
  ensureAlphaFilter();
  const wrap = document.createElement('div');
  wrap.className = 'pet-videos';
  const videos = [0, 1].map(() => {
    const v = document.createElement('video');
    v.muted = true;
    v.playsInline = true;
    v.preload = 'auto';
    v.crossOrigin = 'anonymous'; // 端到端测试要读像素检查背景是不是透明
    v.className = 'pet-video';
    wrap.appendChild(v);
    return v;
  });
  host.appendChild(wrap);

  let front = 0;
  let current = null;
  let token = 0;
  let paused = false;
  let failures = 0;

  const urlOf = (clip) => `${baseUrl}/${encodeURIComponent(clip)}.webm`;

  /**
   * 播一段。loop 为真时循环播放；否则播完调用 onEnded。
   * 返回一个 Promise，开始播放后兑现。
   */
  function play(clip, { loop = false, onEnded } = {}) {
    const my = ++token;
    const back = videos[1 - front];
    back.loop = loop;
    back.onended = null;
    back.onerror = () => {
      if (my !== token) return;
      failures += 1;
      onError?.(clip, failures);
    };
    back.src = urlOf(clip);
    back.currentTime = 0;
    current = clip;
    return new Promise((resolve) => {
      back.oncanplay = async () => {
        back.oncanplay = null;
        if (my !== token) return resolve(false);
        try {
          if (!paused && !reducedMotion) await back.play();
          else if (reducedMotion) back.currentTime = Math.min(1, (back.duration || 2) / 2); // 减少动态效果：只停在一帧
        } catch {
          /* 页面不可见时 play 会被拒绝，resume 时再播 */
        }
        failures = 0;
        back.classList.add('front');
        videos[front].classList.remove('front');
        const old = videos[front];
        front = 1 - front;
        setTimeout(() => { if (my === token) { old.pause(); old.removeAttribute('src'); old.load(); } }, 260);
        if (!loop) back.onended = () => { if (my === token) onEnded?.(); };
        resolve(true);
      };
    });
  }

  return {
    play,
    /** Q 弹：纵向压扁到 55% 再回弹 */
    squash() {
      wrap.classList.remove('squash');
      void wrap.offsetWidth;
      wrap.classList.add('squash');
    },
    setTint(name) {
      wrap.dataset.tint = name || '';
    },
    pause() {
      paused = true;
      videos.forEach((v) => v.pause());
    },
    resume() {
      paused = false;
      if (!reducedMotion) videos[front].play().catch(() => {});
    },
    current: () => current,
    video: () => videos[front],
    videos: () => videos,
  };
}
