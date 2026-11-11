import { byId, h } from "./dom.js";

let counter = 0;

export function showToast(message, { type = "info", duration = 3200 } = {}) {
  const root = byId("toast-root");
  if (!root) return null;
  const id = `toast-${++counter}`;
  const node = h("div", {
    class: `toast${type === "error" ? " is-error" : type === "success" ? " is-success" : ""}`,
    role: "status",
    id
  }, message);
  root.append(node);

  const remove = () => {
    if (!node.isConnected) return;
    node.classList.add("is-leaving");
    setTimeout(() => node.remove(), 260);
  };
  const timer = setTimeout(remove, Math.max(1200, duration));
  node.addEventListener("click", () => {
    clearTimeout(timer);
    remove();
  });
  return remove;
}
