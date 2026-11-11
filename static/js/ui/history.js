import { historyText } from "../strings.js";
import { h, iconButton } from "./dom.js";

const ICONS = {
  play: "牌",
  pass: "过",
  challenge: "揭",
  reveal: "翻",
  collect: "收",
  rankLocked: "名",
  roundEnded: "轮",
  gameOver: "终",
  gameStarted: "始",
  roundStarted: "始",
  playerJoined: "入",
  playerLeft: "离",
  readyChanged: "备",
  aiAdded: "AI",
  aiRemoved: "AI"
};

export function openHistory(view, { onClose = null } = {}) {
  const previousFocus = document.activeElement;
  const backdrop = h("div", { class: "drawer-backdrop" });
  let closed = false;

  const close = () => {
    if (closed) return;
    closed = true;
    document.removeEventListener("keydown", onKeyDown, true);
    backdrop.remove();
    drawer.remove();
    document.body.classList.remove("no-scroll");
    if (previousFocus && typeof previousFocus.focus === "function") previousFocus.focus({ preventScroll: true });
    onClose?.();
  };

  const onKeyDown = (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
    }
  };

  const events = Array.isArray(view.history) ? view.history.slice().reverse() : [];
  const list = h("div", { class: "history-list" },
    ...(events.length
      ? events.map((event) => h("div", { class: "history-item" },
          h("span", { class: "history-item__icon" }, ICONS[event.type] || "·"),
          h("div", { class: "history-item__body" },
            historyText(event, view),
            h("span", { class: "history-item__time" }, new Date(event.at || Date.now()).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }))
          )
        ))
      : [h("div", { class: "history-empty" }, "还没有记录。")]
  ));

  const closeButton = iconButton("×", close, "关闭记录");
  const drawer = h("aside", {
    class: "history-drawer",
    role: "dialog",
    "aria-modal": "true",
    "aria-label": "对局记录"
  },
    h("div", { class: "drawer-head" },
      h("h2", {}, "对局记录"),
      closeButton
    ),
    h("div", { class: "drawer-body" },
      view.historyTruncated ? h("p", { class: "muted" }, "较早的记录已省略。") : null,
      list
    )
  );

  backdrop.addEventListener("click", close);
  document.body.append(backdrop, drawer);
  document.body.classList.add("no-scroll");
  document.addEventListener("keydown", onKeyDown, true);
  requestAnimationFrame(() => closeButton.focus({ preventScroll: true }));

  return { close };
}
