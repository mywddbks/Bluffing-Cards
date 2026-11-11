/** 小型 DOM 构造器，避免在各屏散落 innerHTML。 */

export function h(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  if (props) {
    for (const [key, value] of Object.entries(props)) {
      if (value === null || value === undefined || value === false) continue;
      if (key === "class" || key === "className") node.className = value;
      else if (key === "text") node.textContent = value;
      else if (key === "style" && typeof value === "object") {
        for (const [name, styleValue] of Object.entries(value)) {
          if (styleValue !== null && styleValue !== undefined) node.style.setProperty(name, String(styleValue));
        }
      } else if (key === "dataset" && typeof value === "object") {
        for (const [name, datasetValue] of Object.entries(value)) {
          if (datasetValue !== null && datasetValue !== undefined) node.dataset[name] = String(datasetValue);
        }
      } else if (key === "on" && typeof value === "object") {
        for (const [eventName, handler] of Object.entries(value)) {
          if (typeof handler === "function") node.addEventListener(eventName, handler);
        }
      } else if (key.startsWith("on") && typeof value === "function") {
        node.addEventListener(key.slice(2).toLowerCase(), value);
      } else if (key === "attrs" && typeof value === "object") {
        for (const [name, attrValue] of Object.entries(value)) {
          if (attrValue !== null && attrValue !== undefined) node.setAttribute(name, String(attrValue));
        }
      } else if (key in node && key !== "list") {
        try {
          node[key] = value;
        } catch {
          node.setAttribute(key, String(value));
        }
      } else {
        node.setAttribute(key, String(value));
      }
    }
  }
  append(node, children);
  return node;
}

export function append(parent, children) {
  for (const child of flatten(children)) {
    if (child === null || child === undefined || child === false) continue;
    parent.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return parent;
}

function flatten(items) {
  const result = [];
  for (const item of items) {
    if (Array.isArray(item)) result.push(...flatten(item));
    else result.push(item);
  }
  return result;
}

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

export function mount(parent, ...children) {
  clear(parent);
  append(parent, children);
  return parent;
}

export function byId(id) {
  return document.getElementById(id);
}

export function initials(name) {
  const value = String(name || "?").trim();
  if (!value) return "?";
  return Array.from(value).slice(0, 1).join("").toUpperCase();
}

export function button(label, { variant = "", size = "", className = "", onClick, disabled = false, type = "button", title, sub, attrs = {} } = {}) {
  const classes = ["button"];
  if (variant) classes.push(`button--${variant}`);
  if (size) classes.push(`button--${size}`);
  if (className) classes.push(className);
  const props = {
    class: classes.join(" "),
    type,
    disabled,
    title,
    attrs,
    onClick
  };
  return h("button", props, sub ? h("span", {}, label) : label, sub ? h("span", { class: "button__sub" }, sub) : null);
}

export function iconButton(label, onClick, title) {
  return h("button", {
    class: "icon-button",
    type: "button",
    title: title || label,
    "aria-label": title || label,
    onClick
  }, label);
}
