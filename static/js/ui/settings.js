import { h } from "./dom.js";
import { openModal } from "./modals.js";
import { isSoundEnabled, setSoundEnabled, sounds } from "./sound.js";

const STORAGE_KEY = "bluff.settings.v1";

function readSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { sound: isSoundEnabled(), reducedMotion: false };
    const value = JSON.parse(raw);
    return {
      sound: value.sound !== false,
      reducedMotion: Boolean(value.reducedMotion)
    };
  } catch {
    return { sound: isSoundEnabled(), reducedMotion: false };
  }
}

let current = readSettings();

export function getSettings() {
  return { ...current };
}

export function applySettings() {
  document.documentElement.classList.toggle("reduce-motion", current.reducedMotion);
  setSoundEnabled(current.sound);
}

export function setSettings(patch) {
  current = { ...current, ...patch };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
  } catch {
    // ignore
  }
  applySettings();
  return getSettings();
}

function switchRow(title, hint, checked, onChange) {
  const button = h("button", {
    class: "switch",
    type: "button",
    role: "switch",
    "aria-checked": checked ? "true" : "false",
    "aria-label": title,
    onClick: () => {
      const next = button.getAttribute("aria-checked") !== "true";
      button.setAttribute("aria-checked", next ? "true" : "false");
      onChange(next);
    }
  });
  return h("div", { class: "settings-row" },
    h("div", {},
      h("div", { class: "settings-row__label" }, title),
      h("div", { class: "settings-row__hint" }, hint)
    ),
    button
  );
}

export function openSettings() {
  const modal = openModal({
    title: "设置",
    subtitle: "偏好只保存在本机浏览器",
    body: h("div", {},
      switchRow("音效", "出牌、揭牌与结束时的合成提示音。", current.sound, (value) => {
        setSettings({ sound: value });
        if (value) sounds.card();
      }),
      switchRow("减少动画", "关闭大部分过渡与动画，适合低性能设备。", current.reducedMotion, (value) => {
        setSettings({ reducedMotion: value });
      }),
      h("div", { class: "modal-section" },
        h("h3", { class: "modal-section-title" }, "关于本地演示"),
        h("p", { class: "muted" }, "本地人机使用前端内置规则引擎和演示机器人；正式 AI 与联机裁判由 C++ 后端实现。")
      )
    )
  });
  return modal;
}

applySettings();
