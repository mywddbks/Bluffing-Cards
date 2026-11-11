import { claimText } from "../game/cards.js";
import { playerName } from "../strings.js";
import { createCard } from "./cards.js";
import { button, h } from "./dom.js";
import { openModal } from "./modals.js";

export function openReveal(event, view) {
  if (!event || event.type !== "reveal") return null;
  const target = playerName(view, event.targetPlayerId);
  const challenger = playerName(view, event.challengerId);
  const collector = playerName(view, event.collectorId);
  const truthful = Boolean(event.truthful);

  const cards = (event.cards || []).map((card) => createCard(card));
  const body = h("div", { class: "reveal-panel" },
    h("div", { class: "reveal-target" },
      h("span", {}, challenger),
      h("span", {}, "揭牌"),
      h("strong", {}, target)
    ),
    h("div", { class: "reveal-claim" }, `宣称：${claimText(event.claimRank, event.count)}`),
    h("div", { class: "reveal-cards" }, ...cards),
    h("div", { class: `reveal-result ${truthful ? "is-truth" : "is-lie"}` },
      h("strong", {}, truthful ? "宣称属实" : "虚张声势"),
      h("small", {}, truthful
        ? `${challenger} 揭牌失败，${collector} 收走本轮牌堆。`
        : `${target} 的牌面不实，${collector} 收走本轮牌堆。`
      )
    ),
    h("p", { class: "reveal-footnote" }, "只公开被揭牌的最后一组牌；本轮牌堆中的其他牌不会展示。")
  );

  const close = button("继续", {
    variant: "primary",
    onClick: () => modal?.close("continue")
  });
  const modal = openModal({
    title: "揭牌",
    subtitle: "服务端裁判结果",
    table: true,
    body,
    footer: h("div", { class: "modal-actions" }, close)
  });
  return modal;
}
