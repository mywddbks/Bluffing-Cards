import { RANKS, claimText, rankLabel } from "../game/cards.js";
import { actionReason, playerName } from "../strings.js";
import { handCard, pileStack } from "./cards.js";
import { button, h, iconButton, initials } from "./dom.js";
import { confirmDialog } from "./modals.js";
import { sounds } from "./sound.js";

const ui = {
  gameId: null,
  roundKey: null,
  selected: new Set(),
  pendingRank: null
};

function syncUi(view) {
  if (ui.gameId !== view.gameId) {
    ui.gameId = view.gameId;
    ui.selected = new Set();
    ui.pendingRank = null;
  }
  const roundKey = view.round ? `${view.gameId}:${view.round.number}:${view.round.leaderId}` : `${view.gameId}:result`;
  if (ui.roundKey !== roundKey) {
    ui.roundKey = roundKey;
    ui.selected = new Set();
    ui.pendingRank = null;
  }
  const handIds = new Set((view.you.hand || []).map((card) => card.id));
  ui.selected = new Set([...ui.selected].filter((id) => handIds.has(id)));
  if (view.you.actions?.play?.claimMode !== "choose") ui.pendingRank = null;
}

function passPips(player) {
  const pips = h("span", { class: "pass-pips", title: `过牌计数 ${player.passCount || 0}/2` });
  for (let index = 0; index < 2; index += 1) {
    const filled = (player.passCount || 0) > index;
    const final = (player.passCount || 0) >= 2;
    pips.append(h("span", {
      class: `pass-pip${filled ? " is-filled" : ""}${final && index === 1 ? " is-final" : ""}`
    }));
  }
  return pips;
}

function seatBadges(view, player) {
  const badges = [];
  if (player.isAI) badges.push(h("span", { class: "badge badge--ai" }, "AI"));
  if (player.status === "pending") badges.push(h("span", { class: "badge badge--muted" }, "待确认"));
  if (player.status === "locked") badges.push(h("span", { class: "badge badge--gold" }, `第 ${player.rank} 名`));
  if (view.round?.stage === "finalConfirm" && player.status === "active" && player.passCount >= 2) {
    badges.push(h("span", { class: "badge badge--green" }, "已确认"));
  }
  return badges;
}

function opponentSeat(view, player) {
  const isTurn = view.turn?.playerId === player.playerId;
  return h("div", {
    class: `seat${isTurn ? " is-turn" : ""}${player.status === "pending" ? " is-pending" : ""}${player.status === "locked" ? " is-locked" : ""}`
  },
    isTurn ? h("span", { class: "seat-turnnote" }, "行动中") : null,
    h("span", { class: "seat-avatar avatar" }, initials(player.name)),
    h("div", { class: "seat-main" },
      h("div", { class: "seat-name-row" },
        h("span", { class: "seat-name" }, player.name),
        h("span", { class: "seat-badges" }, ...seatBadges(view, player))
      ),
      h("div", { class: "seat-meta" },
        h("span", {}, player.status === "locked" ? `第 ${player.rank} 名` : player.status === "pending" ? "已出完，待确认" : "剩余"),
        h("span", { class: "seat-card-count" }, h("strong", {}, player.cardCount), " 张")
      ),
      passPips(player)
    ),
    h("div", { class: "seat-cards" },
      h("div", { class: "seat-card-count" }, h("strong", {}, player.cardCount)),
      h("div", { class: "seat-badges" }, ...seatBadges(view, player))
    )
  );
}

function roundClaim(view) {
  const round = view.round;
  if (!round) return null;
  const rank = round.claimRank;
  const label = rank ? rankLabel(rank) : "待定";
  return h("div", { class: "round-claim" },
    h("span", {}, "本轮牌面"),
    h("span", { class: `round-claim__rank${rank && (rank === "H" || rank === "D") ? "" : ""}` }, label),
    h("span", { class: "round-claim__sep" }),
    h("span", { class: "round-claim__hint" },
      rank ? `必须宣称 ${label}` : "先手选择牌面"
    )
  );
}

function centerBoard(view) {
  const round = view.round;
  const last = round?.lastPlay;
  const turnName = view.turn ? playerName(view, view.turn.playerId) : null;
  return h("div", { class: "center-board" },
    h("div", { class: "pile-column" },
      pileStack(round?.pileCount || 0),
      h("div", { class: "pile-count" }, "累计 ", h("strong", {}, round?.pileCount || 0), " 张")
    ),
    last ? h("div", { class: "last-play" },
      h("div", { class: "last-play__label" }, "最后一次出牌"),
      h("div", { class: "last-play__who" }, playerName(view, last.playerId)),
      h("div", { class: "last-play__claim" }, claimText(last.claimRank, last.count))
    ) : h("div", { class: "last-play" },
      h("div", { class: "last-play__label" }, "本轮"),
      h("div", { class: "last-play__who" }, "还没有人出牌"),
      h("div", { class: "last-play__claim" }, "等待先手")
    ),
    h("div", { class: "turn-indicator" },
      turnName ? h("span", {}, "轮到 ", h("strong", {}, turnName)) : "等待结算"
    )
  );
}

function finalBanner(view) {
  const round = view.round;
  if (!round || round.stage !== "finalConfirm") return null;
  return h("div", { class: "final-banner", role: "status" },
    h("span", {}, "最终确认"),
    h("strong", {}, `${round.confirmedCount}/${round.activeCount}`),
    h("span", {}, "人已确认 · 再出牌或揭牌会重置"),
    h("span", { class: "final-banner__pips" },
      ...Array.from({ length: Math.max(1, round.activeCount) }, (_, index) =>
        h("span", { class: `pass-pip${index < round.confirmedCount ? " is-filled" : ""}` })
      )
    )
  );
}

function rankPicker(view, actions, onChange) {
  const play = actions.play;
  if (!play?.allowed) return null;
  if (play.claimMode === "fixed") {
    return h("div", { class: "rank-locked" },
      "本轮必须宣称 ",
      h("strong", {}, rankLabel(play.fixedRank))
    );
  }
  const picker = h("div", { class: "rank-picker", role: "radiogroup", "aria-label": "选择宣称牌面" },
    h("span", { class: "rank-picker__label" }, "宣称牌面")
  );
  for (const rank of RANKS) {
    picker.append(h("button", {
      class: `rank-key${ui.pendingRank === rank ? " is-active" : ""}`,
      type: "button",
      role: "radio",
      "aria-checked": ui.pendingRank === rank ? "true" : "false",
      onClick: () => {
        ui.pendingRank = rank;
        onChange();
      }
    }, rankLabel(rank)));
  }
  return picker;
}

function helperText(view, actions) {
  const me = view.players.find((player) => player.playerId === view.you.playerId);
  if (me?.status === "pending") return "你已出完手牌，等待本轮结算后确认名次。";
  if (me?.status === "locked") return `你已锁定第 ${me.rank} 名，等待牌局结束。`;
  if (view.phase === "finished") return "牌局已结束。";
  if (view.round?.stage === "finalConfirm") {
    return "最终确认阶段：再确认一次将结束本轮；出牌或揭牌会让所有人重新确认。";
  }
  if (actions.play?.mustPlay) return "本轮你先手，必须出牌；先选择牌面和要扣下的牌。";
  if (!actions.play?.allowed && actions.play?.reason) return actions.play.reason;
  if (actions.challenge?.allowed) return "你可以揭牌上一位玩家的最后一组牌，或继续跟牌/过牌。";
  return "选择要扣下的牌；宣称数量会自动等于实际牌数。";
}

export function renderTable({
  view,
  send,
  onChange = () => {},
  onLeave,
  onHistory,
  onRules,
  onSettings,
  onToast
}) {
  syncUi(view);
  const me = view.players.find((player) => player.playerId === view.you.playerId) || view.players[0];
  const others = view.players.filter((player) => player.playerId !== view.you.playerId);
  const actions = view.you.actions || {};
  const play = actions.play || {};
  const challenge = actions.challenge || {};
  const pass = actions.pass || {};
  const myTurn = Boolean(play.allowed);
  const selectedCards = (view.you.hand || []).filter((card) => ui.selected.has(card.id));
  const selectedCount = selectedCards.length;
  const effectiveRank = play.claimMode === "fixed" ? play.fixedRank : ui.pendingRank;
  const canPlay = Boolean(play.allowed && selectedCount > 0 && effectiveRank);
  const handDisabled = !myTurn;

  const screen = h("main", { class: "screen table-screen" },
    h("div", { class: "table-shell" },
      h("header", { class: "table-topbar" },
        h("div", { class: "table-meta" },
          h("a", { class: "brand", href: "./", "aria-label": "唬牌首页" },
            h("span", { class: "brand-mark" }, "唬")
          ),
          h("strong", {}, view.roomCode || "LOCAL"),
          h("span", {}, "·"),
          h("span", {}, `第 ${view.round?.number || 0} 轮`)
        ),
        h("div", { class: "table-tools" },
          button("记录", { variant: "quiet", size: "small", onClick: onHistory }),
          button("规则", { variant: "quiet", size: "small", onClick: onRules }),
          iconButton("⚙", onSettings, "设置"),
          button("离开", { variant: "quiet", size: "small", onClick: onLeave })
        )
      ),
      h("div", { class: "opponents" }, ...others.map((player) => opponentSeat(view, player))),
      h("div", { class: "table-stage" },
        roundClaim(view),
        centerBoard(view),
        finalBanner(view)
      ),
      h("div", { class: "table-bottom" },
        h("div", { class: "you-strip" },
          h("span", { class: "avatar avatar--sm" }, initials(me.name)),
          h("span", { class: "you-strip__name" }, me.name, "（你）"),
          h("span", { class: "you-strip__meta" }, `${me.cardCount} 张 · ${me.status === "active" ? (myTurn ? "轮到你" : "等待") : me.status === "pending" ? "待确认" : `第 ${me.rank} 名`}`),
          h("span", { class: "you-strip__spacer" }),
          h("span", { class: "selection-readout" },
            "已选 ",
            h("strong", {}, selectedCount),
            " 张",
            effectiveRank ? ` · 宣称 ${claimText(effectiveRank, selectedCount)}` : ""
          )
        ),
        h("div", { class: "hand-area" },
          (view.you.hand || []).length
            ? h("div", { class: "hand-scroller" },
                h("div", { class: "hand", role: "listbox", "aria-label": "你的手牌", "aria-multiselectable": "true" },
                  ...view.you.hand.map((card) => handCard(card, {
                    selected: ui.selected.has(card.id),
                    disabled: handDisabled,
                    onClick: () => {
                      if (handDisabled) return;
                      if (ui.selected.has(card.id)) ui.selected.delete(card.id);
                      else ui.selected.add(card.id);
                      sounds.click?.();
                      onChange();
                    }
                  }))
                )
              )
            : h("div", { class: "hand-empty" }, "手牌已出完，等待本轮结算。")
        ),
        h("div", { class: "hand-toolbar" },
          h("span", { class: "hand-toolbar__label" }, "出牌"),
          rankPicker(view, actions, onChange)
        ),
        h("div", { class: "action-dock" },
          h("div", { class: "action-buttons" },
            button(play.claimMode === "fixed" ? "跟牌" : "出牌", {
              variant: "primary",
              sub: effectiveRank ? `宣称 ${claimText(effectiveRank, selectedCount)}` : "先选择牌面",
              disabled: !canPlay,
              title: actionReason(play),
              onClick: async () => {
                if (!canPlay) return;
                if (play.claimMode === "choose") {
                  const confirmed = await confirmDialog({
                    title: "确认宣称",
                    message: `你将扣下 ${selectedCount} 张牌，并宣称是 ${selectedCount} 张 ${rankLabel(effectiveRank)}。确认后不能修改。`,
                    confirmText: "确认出牌"
                  });
                  if (!confirmed) return;
                }
                sounds.card();
                send("play", {
                  cards: selectedCards.map((card) => card.id),
                  claim: { rank: effectiveRank, count: selectedCount }
                });
              }
            }),
            button("揭牌", {
              variant: "danger",
              sub: challenge.targetPlayerId && view.round?.lastPlay
                ? `${playerName(view, challenge.targetPlayerId)}：${claimText(view.round.lastPlay.claimRank, view.round.lastPlay.count)}`
                : "没有可揭牌的出牌",
              disabled: !challenge.allowed,
              title: actionReason(challenge),
              onClick: () => {
                if (!challenge.allowed) return;
                sounds.challenge();
                send("challenge", { targetPlayerId: challenge.targetPlayerId });
              }
            }),
            button(pass.kind === "final" ? "最终确认过牌" : pass.kind === "special" ? "保留最后一张" : "暂过", {
              variant: "ghost",
              sub: pass.kind === "final" ? "确认结束本轮" : pass.kind === "special" ? "2 人局特殊过牌" : "把行动交给下一位",
              disabled: !pass.allowed,
              title: actionReason(pass),
              onClick: async () => {
                if (!pass.allowed) return;
                if (pass.kind === "final") {
                  const confirmed = await confirmDialog({
                    title: "最终确认过牌",
                    message: "确认后本轮将结束，牌堆移出游戏。若还有玩家未确认，会继续等待。",
                    confirmText: "确认过牌"
                  });
                  if (!confirmed) return;
                }
                sounds.pass();
                send("pass", {});
              }
            })
          ),
          h("div", { class: "dock-helper" }, helperText(view, actions))
        )
      )
    )
  );

  requestAnimationFrame(() => layoutHand(screen));
  return screen;
}

function layoutHand(scope) {
  const scroller = scope.querySelector(".hand-scroller");
  const hand = scope.querySelector(".hand");
  if (!scroller || !hand) return;
  const cards = hand.querySelectorAll(".hand-card");
  if (!cards.length) return;
  const cardWidth = cards[0].getBoundingClientRect().width || 64;
  const available = Math.max(280, scroller.clientWidth - 18);
  const count = cards.length;
  const minStep = Math.max(16, cardWidth * 0.34);
  const step = count <= 1 ? cardWidth : Math.max(minStep, Math.min(cardWidth, (available - cardWidth) / (count - 1)));
  hand.style.setProperty("--hand-step", `${step}px`);
}
