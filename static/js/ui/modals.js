import { byId, button, h } from "./dom.js";

let openCount = 0;

/**
 * 打开一个带焦点陷阱的弹窗。body 可以是一个节点或节点数组。
 * 返回 { close, element }。
 */
export function openModal({
  title = "",
  subtitle = "",
  body = null,
  footer = null,
  wide = false,
  table = false,
  onClose = null,
  closeLabel = "关闭"
} = {}) {
  const root = byId("modal-root");
  if (!root) return { close() {}, element: null };
  const previousFocus = document.activeElement;
  openCount += 1;

  let closed = false;
  const close = (reason = "dismiss") => {
    if (closed) return;
    closed = true;
    openCount = Math.max(0, openCount - 1);
    document.removeEventListener("keydown", onKeyDown, true);
    backdrop.remove();
    if (previousFocus && typeof previousFocus.focus === "function") {
      previousFocus.focus({ preventScroll: true });
    }
    onClose?.(reason);
  };

  const closeButton = h("button", {
    class: "modal-close",
    type: "button",
    "aria-label": closeLabel,
    title: closeLabel,
    onClick: () => close("close")
  }, "×");

  const head = h("div", { class: "modal-head" },
    h("div", {},
      h("h2", { class: "modal-title" }, title),
      subtitle ? h("p", { class: "modal-subtitle" }, subtitle) : null
    ),
    closeButton
  );

  const bodyNode = h("div", { class: "modal-body" });
  if (body instanceof Node) bodyNode.append(body);
  else if (Array.isArray(body)) {
    for (const item of body) {
      if (item instanceof Node) bodyNode.append(item);
      else if (item !== null && item !== undefined) bodyNode.append(document.createTextNode(String(item)));
    }
  } else if (body !== null && body !== undefined) {
    bodyNode.append(document.createTextNode(String(body)));
  }

  const footerNode = footer ? h("div", { class: "modal-foot" }) : null;
  if (footerNode) {
    if (Array.isArray(footer)) footerNode.append(...footer.filter(Boolean));
    else if (footer instanceof Node) footerNode.append(footer);
  }

  const modal = h("div", {
    class: `modal${wide ? " modal--wide" : ""}${table ? " modal--table" : ""}`,
    role: "dialog",
    "aria-modal": "true",
    "aria-label": title || "对话框"
  }, head, bodyNode, footerNode);

  const backdrop = h("div", {
    class: "modal-backdrop",
    on: {
      mousedown: (event) => {
        if (event.target === backdrop) close("backdrop");
      }
    }
  }, modal);

  const onKeyDown = (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      close("escape");
      return;
    }
    if (event.key !== "Tab") return;
    const focusables = Array.from(
      modal.querySelectorAll('button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])')
    ).filter((node) => node.offsetParent !== null || node === document.activeElement);
    if (!focusables.length) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  document.addEventListener("keydown", onKeyDown, true);
  root.append(backdrop);

  const autoFocus = bodyNode.querySelector("input, select, textarea, button:not(:disabled)") || footerNode?.querySelector("button") || closeButton;
  requestAnimationFrame(() => {
    if (autoFocus && typeof autoFocus.focus === "function") autoFocus.focus({ preventScroll: true });
  });

  return { close, element: modal, body: bodyNode, footer: footerNode, backdrop };
}

export function confirmDialog({
  title = "确认",
  message = "",
  confirmText = "确认",
  cancelText = "取消",
  danger = false
} = {}) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const body = h("p", { class: "muted" }, message);
    const cancel = button(cancelText, {
      variant: "ghost",
      onClick: () => {
        finish(false);
        modal?.close("cancel");
      }
    });
    const confirm = button(confirmText, {
      variant: danger ? "danger" : "primary",
      onClick: () => {
        finish(true);
        modal?.close("confirm");
      }
    });
    const modal = openModal({
      title,
      body,
      footer: h("div", { class: "modal-actions" }, cancel, confirm),
      onClose: () => finish(false)
    });
  });
}

export function closeAllModals() {
  const root = byId("modal-root");
  if (root) root.replaceChildren();
  openCount = 0;
}
