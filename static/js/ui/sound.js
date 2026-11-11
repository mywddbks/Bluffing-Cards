/** WebAudio 合成音效，不加载任何外部音频。 */

let context = null;
let enabled = true;

try {
  enabled = localStorage.getItem("bluff.sound.v1") !== "off";
} catch {
  enabled = true;
}

function audioContext() {
  if (typeof window === "undefined") return null;
  if (context) return context;
  const Ctor = window.AudioContext || window.webkitAudioContext;
  if (!Ctor) return null;
  try {
    context = new Ctor();
  } catch {
    context = null;
  }
  return context;
}

export function isSoundEnabled() {
  return enabled;
}

export function setSoundEnabled(value) {
  enabled = Boolean(value);
  try {
    localStorage.setItem("bluff.sound.v1", enabled ? "on" : "off");
  } catch {
    // ignore
  }
}

function tone(frequency, duration = 0.08, { type = "sine", gain = 0.035, delay = 0 } = {}) {
  if (!enabled) return;
  const ctx = audioContext();
  if (!ctx) return;
  if (ctx.state === "suspended") ctx.resume().catch(() => {});
  const start = ctx.currentTime + delay;
  const oscillator = ctx.createOscillator();
  const volume = ctx.createGain();
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, start);
  volume.gain.setValueAtTime(0.0001, start);
  volume.gain.exponentialRampToValueAtTime(gain, start + 0.012);
  volume.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  oscillator.connect(volume);
  volume.connect(ctx.destination);
  oscillator.start(start);
  oscillator.stop(start + duration + 0.02);
}

export const sounds = {
  click() {
    tone(520, 0.035, { type: "sine", gain: 0.012 });
  },
  card() {
    tone(420, 0.07, { type: "triangle", gain: 0.03 });
    tone(640, 0.05, { type: "triangle", gain: 0.018, delay: 0.035 });
  },
  challenge() {
    tone(220, 0.12, { type: "sawtooth", gain: 0.025 });
    tone(330, 0.12, { type: "sawtooth", gain: 0.02, delay: 0.06 });
  },
  pass() {
    tone(300, 0.06, { type: "sine", gain: 0.02 });
  },
  win() {
    [523, 659, 784, 1046].forEach((frequency, index) => {
      tone(frequency, 0.22, { type: "triangle", gain: 0.035, delay: index * 0.11 });
    });
  },
  lose() {
    [392, 330, 262].forEach((frequency, index) => {
      tone(frequency, 0.26, { type: "sine", gain: 0.03, delay: index * 0.14 });
    });
  }
};
