// 鲸鱼娘总入口：把状态机（pet-state）、选片（pet-director）、播放器（pet-player）串起来。
// 整个角色是一个常驻的 DOM 元素，页面重画时只是被挪到新的位置，视频不会重新开始。

import { initial, reduce, derive } from './pet-state.mjs';
import { nextClip, reactionClip, decorations, referencedClips } from './pet-director.mjs';
import { createPlayer } from './pet-player.js';
import { renderIcons } from './pet-icons.js';
import { lineFor } from './pet-lines.mjs';

const INTERRUPTING = new Set(['think', 'talk']);
const FALLBACK_MS = 12000; // 万一视频的 ended 事件没来，最多 12 秒换下一段

/**
 * @param {object} deps
 * @param {{manifest:object, baseUrl:string, available:string[]}} deps.info  主进程给的皮肤信息
 * @param {() => object} deps.getVitals         当前的 S.vitals
 * @param {() => boolean} [deps.anniversaryToday]
 * @param {{greetAfterHours?:number, bubbleSeconds?:number, pokeCooldownMs?:number, balanceTiers?:number[]}} [deps.config]
 * @param {() => void} [deps.onBroken]          素材坏了、播不了时调用（上层换回 3D 鲸鱼）
 */
export function createPet({ info, getVitals, anniversaryToday = () => false, config = {}, onBroken }) {
  const manifest = info.manifest;
  const opts = { greetAfterHours: config.greetAfterHours ?? 3, balanceTiers: config.balanceTiers || manifest.balance.tiers };
  const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  const root = document.createElement('div');
  root.className = 'pet-root';
  root.innerHTML = '<div class="pet-bubble" hidden></div><div class="pet-stage" title="点一下摸摸她，按住拎起来，右键选动作"><div class="pet-icons"></div></div><div class="pet-why"></div>';
  const stage = root.querySelector('.pet-stage');
  const bubbleEl = root.querySelector('.pet-bubble');
  const iconsEl = root.querySelector('.pet-icons');
  const whyEl = root.querySelector('.pet-why');
  stage.style.aspectRatio = `${manifest.aspect[0]} / ${manifest.aspect[1]}`;

  let broken = false;
  const player = createPlayer(stage, {
    baseUrl: info.baseUrl,
    reducedMotion,
    onError: (clip, n) => {
      console.error(`[pet] 播不了 ${clip}`);
      if (n >= 3 && !broken) { broken = true; onBroken?.(); return; }
      if (clip !== manifest.fallbackClip) player.play(manifest.fallbackClip, { onEnded: playNext });
    },
  });

  let machine = initial();
  let derived = { action: 'idle', mood: '平静', reaction: null, missYou: false, why: '' };
  let playing = { kind: null, action: null, clip: null };
  let sleepState = 'awake'; // awake / starting / loop / ending
  const recent = [];
  let fallbackTimer = 0;
  let running = false;
  let bubbleTimer = 0;
  let lastPoke = 0;

  const now = () => Date.now();
  const rnd = Math.random;

  function remember(clip) {
    recent.push(clip);
    if (recent.length > 6) recent.shift();
  }

  function start(kind, action, clip, { loop = false, after } = {}) {
    clearTimeout(fallbackTimer);
    playing = { kind, action, clip };
    remember(clip);
    const onEnded = () => { clearTimeout(fallbackTimer); (after || playNext)(); };
    player.play(clip, { loop, onEnded });
    if (!loop && running) fallbackTimer = setTimeout(onEnded, FALLBACK_MS);
  }

  /** 按此刻的状态选下一段 */
  function playNext() {
    if (!running || broken) return;
    derived = derive(getVitals(), machine, now());
    paint();
    if (derived.reaction) return playReaction(derived.reaction);
    if (derived.action === 'sleep') {
      if (sleepState === 'awake') {
        sleepState = 'starting';
        return start('action', 'sleep', manifest.sleep.start, { after: () => { sleepState = 'loop'; playNext(); } });
      }
      sleepState = 'loop';
      return start('action', 'sleep', manifest.sleep.loop, { loop: true });
    }
    if (sleepState === 'loop' || sleepState === 'starting') {
      sleepState = 'ending';
      return start('action', 'wake', manifest.sleep.end, { after: () => { sleepState = 'awake'; playNext(); } });
    }
    const { clip } = nextClip(manifest, derived, { now: now(), rnd, recent, anniversaryToday: anniversaryToday() });
    start('action', derived.action, clip || manifest.fallbackClip);
  }

  function playReaction(name) {
    const clip = reactionClip(manifest, name, derived, { rnd, recent, balanceTier: machine.balanceTier });
    const done = () => {
      machine = reduce(machine, { type: 'reaction-done', at: now() });
      playNext();
    };
    if (name === 'hold') return start('reaction', 'hold', clip, { loop: true });
    start('reaction', name, clip, { after: done });
  }

  /** 状态变了：该打断的立刻换，不该打断的等这段播完 */
  function evaluate() {
    const next = derive(getVitals(), machine, now());
    const prevAction = derived.action;
    derived = next;
    paint();
    if (!running || broken) return;
    if (next.reaction && playing.kind !== 'reaction') return playReaction(next.reaction);
    if (playing.kind === 'reaction' || playing.kind === 'manual') return;
    if (sleepState === 'starting' || sleepState === 'ending') return;
    const sleeping = sleepState === 'loop';
    if ((next.action === 'sleep') !== sleeping) return playNext(); // 入睡、醒来立刻换
    if (next.action !== prevAction && (INTERRUPTING.has(next.action) || INTERRUPTING.has(playing.action))) return playNext();
  }

  function paint() {
    const deco = decorations(manifest, derived);
    renderIcons(iconsEl, deco.icons);
    player.setTint(deco.tint);
    whyEl.textContent = derived.why || '';
  }

  function say(text) {
    bubbleEl.textContent = text;
    bubbleEl.hidden = !text;
    clearTimeout(bubbleTimer);
    bubbleTimer = setTimeout(showThought, (config.bubbleSeconds ?? 3) * 1000);
  }

  /** 平时气泡里是她最新的念头（1 小时以内的） */
  function showThought() {
    const t = (getVitals()?.body?.thoughts || []).slice(-1)[0];
    const fresh = t && now() - t.at < 3600000;
    bubbleEl.textContent = fresh ? t.text : '';
    bubbleEl.hidden = !fresh;
  }

  function poke() {
    if (now() - lastPoke < (config.pokeCooldownMs ?? 400)) return;
    lastPoke = now();
    player.squash();
    say(lineFor(derived.action, rnd));
    onEvent({ type: 'poke' });
  }

  // ---------- 鼠标 ----------
  let holdTimer = 0, holding = false;
  stage.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    holdTimer = setTimeout(() => { holding = true; onEvent({ type: 'hold' }); }, 400);
  });
  const release = () => {
    clearTimeout(holdTimer);
    if (holding) {
      holding = false;
      machine = reduce(machine, { type: 'reaction-done', at: now() });
      playNext();
      return true;
    }
    return false;
  };
  stage.addEventListener('pointerup', (e) => { if (e.button === 0 && !release()) poke(); });
  stage.addEventListener('pointerleave', release);
  stage.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    openMenu(e.clientX, e.clientY);
  });

  // ---------- 右键菜单：按组列出全部动画 ----------
  let menuEl = null;
  function closeMenu() {
    menuEl?.remove();
    menuEl = null;
  }
  function openMenu(x, y) {
    closeMenu();
    menuEl = document.createElement('div');
    menuEl.className = 'pet-menu';
    const groups = manifest.menu.map((g, i) => `<div class="pet-menu-group"><button class="pet-menu-head" data-g="${i}">${g.name}<span>${g.clips.length}</span></button><div class="pet-menu-items" hidden>${g.clips.map((c) => `<button data-clip="${c}">${c}</button>`).join('')}</div></div>`).join('');
    menuEl.innerHTML = `${groups}<button class="pet-menu-why" data-why>她为什么这样</button>`;
    document.body.appendChild(menuEl);
    const r = menuEl.getBoundingClientRect();
    menuEl.style.left = `${Math.min(x, innerWidth - r.width - 8)}px`;
    menuEl.style.top = `${Math.min(y, innerHeight - r.height - 8)}px`;
    menuEl.addEventListener('click', (e) => {
      const head = e.target.closest('[data-g]');
      if (head) {
        const items = head.nextElementSibling;
        menuEl.querySelectorAll('.pet-menu-items').forEach((el) => { if (el !== items) el.hidden = true; });
        items.hidden = !items.hidden;
        return;
      }
      const item = e.target.closest('[data-clip]');
      if (item) { playClip(item.dataset.clip); closeMenu(); return; }
      if (e.target.closest('[data-why]')) { say(derived.why || '没什么，就是在发呆'); closeMenu(); }
    });
    setTimeout(() => document.addEventListener('pointerdown', (e) => { if (menuEl && !menuEl.contains(e.target)) closeMenu(); }, { once: true }), 0);
  }

  function playClip(name) {
    start('manual', 'manual', name, { after: playNext });
  }

  function onEvent(e) {
    machine = reduce(machine, { ...e, at: e.at ?? now() }, opts);
    evaluate();
  }

  return {
    root,
    attach(host) {
      host.appendChild(root);
      this.resume();
    },
    setSnapshot() { evaluate(); },
    onEvent,
    playClip,
    poke,
    /** 按钮：跳支舞、看钱包、换一个 */
    act(name) {
      if (name === 'poke') return poke();
      if (name === 'wallet') return onEvent({ type: 'wallet' });
      if (name === 'dance') return playClip(manifest.moods['兴奋'].clips[Math.floor(rnd() * manifest.moods['兴奋'].clips.length)]);
      if (name === 'next') return playNext();
    },
    now: () => ({ action: derived.action, mood: derived.mood, reaction: playing.kind === 'reaction' ? playing.action : null, clip: player.current(), why: derived.why, sleepState }),
    coverage() {
      const have = new Set(info.available);
      return referencedClips(manifest).filter((c) => !have.has(c));
    },
    pause() {
      running = false;
      clearTimeout(fallbackTimer);
      player.pause();
      closeMenu();
    },
    resume() {
      if (running) return;
      running = true;
      player.resume(); // 先清掉播放器的暂停标记，否则新选的那段会停在第一帧
      showThought();
      playNext(); // 回到页面时按此刻的状态重新选一段

    },
    videos: () => player.videos(),
  };
}
