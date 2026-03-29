// ============================================================
// AUDIO ENGINE — Pre-rendered AudioBuffer approach (no crackle)
// 移植自 mizpath.fluoro.fun，扩展了 gold/lose/tick/go 音效
// ============================================================

let ctx: AudioContext | null = null;
let masterGain: GainNode | null = null;
let compressor: DynamicsCompressorNode | null = null;
let inited = false;
let muted = false;
let volume = 0.6;

const buffers: Record<string, AudioBuffer> = {};

function ensure(): AudioContext {
  if (!ctx) {
    ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = -6;
    compressor.knee.value = 12;
    compressor.ratio.value = 8;
    compressor.attack.value = 0.002;
    compressor.release.value = 0.05;
    compressor.connect(ctx.destination);
    masterGain = ctx.createGain();
    masterGain.gain.value = volume;
    masterGain.connect(compressor);
  }
  if (!inited) {
    inited = true;
    renderBuffers();
  }
  return ctx;
}

// 逐样本写入波形，预渲染所有音效 buffer
function renderBuffers(): void {
  if (!ctx) { return; }
  const sr = ctx.sampleRate;

  // ── Move: 五声音阶正弦波 blip ──
  const moveFreqs = [523, 587, 659, 784, 880, 988, 1047, 988, 880, 784, 659, 587];
  moveFreqs.forEach((freq, i) => {
    const dur = 0.06;
    const len = Math.ceil(sr * dur);
    const buf = ctx!.createBuffer(1, len, sr);
    const data = buf.getChannelData(0);
    for (let s = 0; s < len; s++) {
      const t = s / sr;
      const wave = Math.sin(2 * Math.PI * freq * t);
      const attack = Math.min(1, t / 0.003);
      const decay = Math.exp(-t * 50);
      data[s] = wave * attack * decay * 0.12;
    }
    buffers["move_" + i] = buf;

    // Shimmer: 高八度，更轻柔
    const shimDur = 0.04;
    const shimLen = Math.ceil(sr * shimDur);
    const shimBuf = ctx!.createBuffer(1, shimLen, sr);
    const shimData = shimBuf.getChannelData(0);
    for (let s = 0; s < shimLen; s++) {
      const t = s / sr;
      const wave = Math.sin(2 * Math.PI * freq * 2 * t);
      const attack = Math.min(1, t / 0.002);
      const decay = Math.exp(-t * 80);
      shimData[s] = wave * attack * decay * 0.02;
    }
    buffers["shimmer_" + i] = shimBuf;
  });

  // ── Bump: 低频三角波闷响，频率从 100Hz 下降到 50Hz ──
  {
    const dur = 0.09;
    const len = Math.ceil(sr * dur);
    const buf = ctx.createBuffer(1, len, sr);
    const data = buf.getChannelData(0);
    for (let s = 0; s < len; s++) {
      const t = s / sr;
      const freq = 100 - (50 * t / dur);
      const phase = (2 * freq * t) % 1;
      const wave = phase < 0.5 ? (4 * phase - 1) : (3 - 4 * phase);
      const attack = Math.min(1, t / 0.002);
      const decay = Math.exp(-t * 35);
      data[s] = wave * attack * decay * 0.1;
    }
    buffers["bump"] = buf;
  }

  // ── Win: 欢快上行琶音 (C5-E5-G5-C6) + 高八度泛音 + 长尾音 ──
  {
    const notes = [523, 659, 784, 1047];
    const noteDur = 0.4;
    const noteGap = 0.1;
    const totalDur = (notes.length - 1) * noteGap + noteDur + 0.3;
    const len = Math.ceil(sr * totalDur);
    const buf = ctx.createBuffer(1, len, sr);
    const data = buf.getChannelData(0);
    notes.forEach((freq, i) => {
      const startSample = Math.floor(i * noteGap * sr);
      const endSample = Math.min(len, startSample + Math.ceil((noteDur + 0.2) * sr));
      for (let s = startSample; s < endSample; s++) {
        const t = (s - startSample) / sr;
        // 基频 + 高八度 + 五度泛音，明亮丰满
        const wave = Math.sin(2 * Math.PI * freq * t) * 0.5
                   + Math.sin(2 * Math.PI * freq * 2 * t) * 0.3
                   + Math.sin(2 * Math.PI * freq * 1.5 * t) * 0.2;
        const attack = Math.min(1, t / 0.008);
        const decay = Math.exp(-t * 4);
        data[s] += wave * attack * decay * 0.13;
      }
    });
    buffers["win"] = buf;
  }

  // ── Gold: 明亮的金币/星星音效 — 快速上行双音 + 泛音闪烁 ──
  {
    const notes = [1319, 1568, 2093]; // E6-G6-C7
    const noteDur = 0.12;
    const noteGap = 0.06;
    const totalDur = (notes.length - 1) * noteGap + noteDur;
    const len = Math.ceil(sr * totalDur);
    const buf = ctx.createBuffer(1, len, sr);
    const data = buf.getChannelData(0);
    notes.forEach((freq, i) => {
      const startSample = Math.floor(i * noteGap * sr);
      const endSample = Math.min(len, startSample + Math.ceil(noteDur * sr));
      for (let s = startSample; s < endSample; s++) {
        const t = (s - startSample) / sr;
        // 基频 + 高八度泛音营造"闪烁感"
        const wave = Math.sin(2 * Math.PI * freq * t) * 0.7
                   + Math.sin(2 * Math.PI * freq * 2 * t) * 0.3;
        const attack = Math.min(1, t / 0.005);
        const decay = Math.exp(-t * 15);
        data[s] += wave * attack * decay * 0.14;
      }
    });
    buffers["gold"] = buf;
  }

  // ── Lose: 低沉下行 + 颤音效果，沉闷失落感 ──
  {
    const notes = [330, 277, 233, 196]; // E4-Db4-Bb3-G3 更低沉
    const noteDur = 0.4;
    const noteGap = 0.2;
    const totalDur = (notes.length - 1) * noteGap + noteDur;
    const len = Math.ceil(sr * totalDur);
    const buf = ctx.createBuffer(1, len, sr);
    const data = buf.getChannelData(0);
    notes.forEach((freq, i) => {
      const startSample = Math.floor(i * noteGap * sr);
      const endSample = Math.min(len, startSample + Math.ceil(noteDur * sr));
      for (let s = startSample; s < endSample; s++) {
        const t = (s - startSample) / sr;
        // 三角波 + 颤音（vibrato），沉闷区别于 win 的明亮正弦波
        const vibrato = 1 + 0.02 * Math.sin(2 * Math.PI * 6 * t);
        const phase = (2 * freq * vibrato * t) % 1;
        const wave = phase < 0.5 ? (4 * phase - 1) : (3 - 4 * phase);
        const attack = Math.min(1, t / 0.015);
        const decay = Math.exp(-t * 3.5);
        data[s] += wave * attack * decay * 0.1;
      }
    });
    buffers["lose"] = buf;
  }

  // ── Tick: 短促的高频嘀嗒声 ──
  {
    const dur = 0.03;
    const len = Math.ceil(sr * dur);
    const buf = ctx.createBuffer(1, len, sr);
    const data = buf.getChannelData(0);
    for (let s = 0; s < len; s++) {
      const t = s / sr;
      const freq = 1800;
      const wave = Math.sin(2 * Math.PI * freq * t);
      const attack = Math.min(1, t / 0.001);
      const decay = Math.exp(-t * 120);
      data[s] = wave * attack * decay * 0.15;
    }
    buffers["tick"] = buf;
  }

  // ── Go: 短促上行双音 fanfare ──
  {
    const notes = [784, 1047]; // G5-C6
    const noteDur = 0.15;
    const noteGap = 0.08;
    const totalDur = (notes.length - 1) * noteGap + noteDur;
    const len = Math.ceil(sr * totalDur);
    const buf = ctx.createBuffer(1, len, sr);
    const data = buf.getChannelData(0);
    notes.forEach((freq, i) => {
      const startSample = Math.floor(i * noteGap * sr);
      const endSample = Math.min(len, startSample + Math.ceil(noteDur * sr));
      for (let s = startSample; s < endSample; s++) {
        const t = (s - startSample) / sr;
        const wave = Math.sin(2 * Math.PI * freq * t) * 0.8
                   + Math.sin(2 * Math.PI * freq * 1.5 * t) * 0.2; // 五度泛音
        const attack = Math.min(1, t / 0.005);
        const decay = Math.exp(-t * 10);
        data[s] += wave * attack * decay * 0.16;
      }
    });
    buffers["go"] = buf;
  }
}

// 播放预渲染 buffer，无爆音
function playBuffer(name: string, vol: number): void {
  if (!ctx || !buffers[name] || !masterGain) { return; }
  const src = ctx.createBufferSource();
  const gain = ctx.createGain();
  src.buffer = buffers[name];
  gain.gain.value = vol;
  src.connect(gain);
  gain.connect(masterGain);
  src.start(0);
}

// move 音效的音阶循环状态
let moveIndex = 0;
let lastMoveTime = 0;

function playSound(type: string): void {
  if (muted) { return; }
  try {
    const c = ensure();
    const now = c.currentTime;

    if (type === "move") {
      const gap = now - lastMoveTime;
      lastMoveTime = now;
      if (gap > 0.3) { moveIndex = 0; } else { moveIndex = (moveIndex + 1) % 12; }
      const isRapid = gap < 0.15;
      const vol = isRapid ? 0.5 : 1;
      playBuffer("move_" + moveIndex, vol);
      playBuffer("shimmer_" + moveIndex, vol);
    } else if (type === "bump") {
      moveIndex = 0;
      playBuffer("bump", 1);
    } else if (type === "win") {
      playBuffer("win", 1);
    } else if (type === "gold") {
      playBuffer("gold", 1);
    } else if (type === "lose") {
      playBuffer("lose", 1);
    } else if (type === "tick") {
      playBuffer("tick", 1);
    } else if (type === "go") {
      playBuffer("go", 1);
    }
  } catch {
    // 忽略 AudioContext 异常
  }
}

// 保持与原有接口一致：SFX.xxx.play()
function createSynthSound(type: string): { play: () => void } {
  return { play: () => playSound(type) };
}

/** 预定义的游戏音效（纯代码合成，无需音频文件） */
export const SFX = {
  move: createSynthSound("move"),
  bump: createSynthSound("bump"),
  gold: createSynthSound("gold"),
  win: createSynthSound("win"),
  lose: createSynthSound("lose"),
  tick: createSynthSound("tick"),
  go: createSynthSound("go"),
};

/** 保留 createSound 导出以兼容可能的外部引用 */
export function createSound(_src: string, _volume = 0.5): { play: () => void } {
  return { play: () => {} };
}
