import { actionReason } from "../strings.js";
import { button, h, iconButton, initials } from "./dom.js";

function seatBadges(player, view) {
  const badges = [];
  if (player.playerId === view.hostId) badges.push(h("span", { class: "badge badge--gold" }, "房主"));
  if (player.isAI) badges.push(h("span", { class: "badge badge--ai" }, "AI"));
  if (player.ready) badges.push(h("span", { class: "badge badge--green" }, "已准备"));
  if (player.connected === false) badges.push(h("span", { class: "badge badge--muted" }, "离线"));
  return badges;
}

function playerSeat(player, { view, me, isHost, onSend }) {
  const isYou = player.playerId === me.playerId;
  const isAI = player.isAI;
  const actions = [];
  if (isHost && isAI) {
    actions.push(button("移除", {
      variant: "quiet",
      size: "small",
      onClick: () => onSend("removeAI", { playerId: player.playerId })
    }));
  }
  return h("div", { class: `lobby-seat${isYou ? " is-you" : ""}` },
    h("div", { class: "lobby-seat-head" },
      h("span", { class: "avatar" }, initials(player.name)),
      h("div", { style: { minWidth: "0" } },
        h("div", { class: "lobby-seat-name" }, player.name, isYou ? "（你）" : ""),
        h("div", { class: "lobby-seat-meta" }, isAI ? "演示机器人" : player.connected === false ? "连接中断" : "真人玩家")
      )
    ),
    h("div", { class: "lobby-seat-meta", style: { marginTop: "4px" } }, player.ready ? "准备就绪" : "等待准备"),
    h("div", { class: "lobby-seat-actions" }, ...seatBadges(player, view), ...actions)
  );
}

function emptySeat(seat, { isHost, onAddAI }) {
  if (!isHost) {
    return h("div", { class: "lobby-seat is-empty" },
      h("div", {}, "空座位"),
      h("div", { class: "lobby-seat-meta" }, "等待玩家加入")
    );
  }
  return h("div", { class: "lobby-seat is-empty" },
    h("div", {}, "空座位"),
    button("添加 AI 补位", {
      variant: "ghost",
      size: "small",
      onClick: () => onAddAI(seat)
    })
  );
}

export function renderLobby({
  view,
  onSend,
  onLeave,
  onRules,
  onSettings,
  onToast
}) {
  const me = view.players.find((player) => player.playerId === view.you.playerId) || view.players[0];
  const isHost = Boolean(view.you.isHost || view.hostId === me.playerId);
  const actions = view.you.actions || {};
  const occupied = new Map(view.players.map((player) => [player.seat, player]));
  const seats = [];
  for (let seat = 0; seat < view.maxPlayers; seat += 1) {
    const player = occupied.get(seat);
    if (player) seats.push(playerSeat(player, { view, me, isHost, onSend }));
    else {
      seats.push(emptySeat(seat, {
        isHost,
        onAddAI: (seatNumber) => onSend("addAI", { seat: seatNumber, persona: "balanced" })
      }));
    }
  }

  const readyValue = actions.ready?.value ?? me.ready;
  const readyAction = actions.ready;
  const startAction = actions.start;
  const startDisabled = startAction ? !startAction.allowed : !isHost || view.players.length < view.maxPlayers;
  const startReason = startAction ? actionReason(startAction) : "等待所有座位坐满";
  const readyDisabled = readyAction ? !readyAction.allowed : false;

  const roomChip = h("div", { class: "room-chip" },
    h("span", {}, "房间"),
    h("strong", {}, view.roomCode || "LOCAL"),
    h("button", {
      type: "button",
      onClick: async () => {
        try {
          await navigator.clipboard.writeText(view.roomCode || "");
          onToast?.("房间码已复制。", "success");
        } catch {
          onToast?.("复制失败，请手动选择房间码。", "error");
        }
      }
    }, "复制")
  );

  return h("main", { class: "screen lobby-screen" },
    h("header", { class: "app-header" },
      h("a", { class: "brand", href: "./" },
        h("span", { class: "brand-mark" }, "唬"),
        h("span", {}, "唬牌")
      ),
      h("div", { class: "header-spacer" }),
      h("div", { class: "header-cluster" },
        roomChip,
        button("规则", { variant: "quiet", size: "small", onClick: onRules }),
        iconButton("⚙", onSettings, "设置")
      )
    ),
    h("div", { class: "lobby-main" },
      h("div", { class: "lobby-panel" },
        h("div", { class: "lobby-heading" },
          h("div", {},
            h("h1", {}, "等待开局"),
            h("p", {}, `${view.maxPlayers} 人局 · ${view.players.length}/${view.maxPlayers} 已入座`)
          ),
          h("div", { class: "badge badge--muted" }, isHost ? "你是房主" : "你是玩家")
        ),
        h("div", { class: "seat-grid" }, ...seats),
        h("div", { class: "lobby-help" },
          "房主可以添加演示 AI 补位。所有真人玩家准备后，房主点击“开始牌局”。联机对局的出牌与揭牌结果全部由服务端裁判。"
        ),
        h("div", { class: "lobby-actions" },
          button("离开房间", { variant: "quiet", onClick: onLeave }),
          button(readyValue ? "取消准备" : "准备", {
            variant: readyValue ? "ghost" : "primary",
            disabled: readyDisabled,
            title: actionReason(readyAction),
            onClick: () => onSend("ready", { ready: !readyValue })
          }),
          isHost ? button("开始牌局", {
            variant: "primary",
            disabled: startDisabled,
            title: startReason,
            onClick: () => onSend("start", {})
          }) : h("div", { class: "lobby-seat-meta" }, "等待房主开始牌局")
        )
      )
    )
  );
}
