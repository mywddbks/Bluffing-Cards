import { cardAriaLabel, getSuit, isJoker, isRedCard, rankLabel } from "../game/cards.js";
import { h } from "./dom.js";

function corner(card, position) {
  const suit = getSuit(card.suit);
  const isJ = isJoker(card);
  return h("span", { class: `card-corner card-corner--${position}`, "aria-hidden": "true" },
    h("span", { class: "card-rank" }, isJ ? (card.rank === "SJ" ? "小" : "大") : card.rank),
    h("span", { class: "card-suit" }, isJ ? "王" : suit.symbol)
  );
}

/**
 * 返回一张牌的 DOM。默认是 div；点击交互由 handCard 包装成 button。
 */
export function createCard(card, { selected = false, back = false, className = "", asButton = false, onClick, disabled = false } = {}) {
  const node = document.createElement(asButton ? "button" : "div");
  const classes = ["playing-card"];
  if (back) classes.push("is-back");
  if (!back && isRedCard(card)) classes.push("is-red");
  if (!back && isJoker(card)) {
    classes.push("is-joker");
    if (card.rank === "SJ") classes.push("is-black-joker");
  }
  if (selected) classes.push("is-selected");
  if (className) classes.push(className);
  node.className = classes.join(" ");
  if (asButton) {
    node.type = "button";
    node.disabled = disabled;
    if (onClick) node.addEventListener("click", onClick);
  }
  if (back) return node;

  node.setAttribute("aria-hidden", "false");
  node.append(corner(card, "tl"));
  if (isJoker(card)) {
    node.append(h("span", { class: "joker-center", "aria-hidden": "true" },
      rankLabel(card.rank),
      h("small", {}, "WILD")
    ));
  } else {
    const suit = getSuit(card.suit);
    node.append(h("span", { class: "card-center", "aria-hidden": "true" },
      h("span", { class: "card-center-suit" }, suit.symbol),
      h("span", { class: "card-center-mark" }, "BLUFF")
    ));
  }
  node.append(corner(card, "br"));
  return node;
}

export function handCard(card, { selected = false, disabled = false, onClick } = {}) {
  const wrapper = h("button", {
    class: `hand-card${selected ? " is-selected" : ""}${disabled ? " is-unavailable" : ""}`,
    type: "button",
    "aria-pressed": selected ? "true" : "false",
    "aria-label": `${cardAriaLabel(card)}${selected ? "，已选中" : ""}`,
    disabled,
    onClick
  });
  wrapper.append(createCard(card, { selected }));
  return wrapper;
}

export function miniCards(count) {
  const visible = Math.min(5, Math.max(0, Number(count) || 0));
  const wrap = h("span", { class: "mini-cards", "aria-hidden": "true" });
  for (let index = 0; index < visible; index += 1) wrap.append(h("span", { class: "mini-card" }));
  return wrap;
}

export function pileStack(count) {
  const visible = Math.min(3, Math.max(0, Number(count) || 0));
  const stack = h("div", { class: `pile-stack${count ? "" : " is-empty"}`, "aria-label": count ? `牌堆 ${count} 张` : "牌堆为空" });
  for (let index = 0; index < visible; index += 1) stack.append(createCard(null, { back: true }));
  return stack;
}
