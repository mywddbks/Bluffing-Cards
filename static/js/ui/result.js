import { button, h, initials } from "./dom.js";

function podium(ranking, youId) {
  const place = h("div", { class: "podium" });
  const ordered = ranking.slice().sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99));
  for (const entry of ordered.slice(0, 3)) {
    const rank = entry.rank ?? 99;
    place.append(h("div", { class: `podium-place podium-place--${Math.min(3, Math.max(1, rank))}` },
      h("span", { class: "podium-rank" }, rank <= 3 ? String(rank) : "—"),
      h("span", { class: "avatar" }, initials(entry.name)),
      h("span", { class: "podium-name" }, entry.name, entry.playerId === youId ? "（你）" : ""),
      h("span", { class: "podium-meta" }, rank === 1 ? "唬牌赢家" : `第 ${rank} 名`)
    ));
  }
  return place;
}

export function renderResult({ view, onRematch, onHome, onHistory }) {
  const result = view.result;
  const ranking = result?.ranking || [];
  const winner = ranking.find((entry) => entry.rank === 1);
  const youWon = result?.winnerId === view.you.playerId;
  const rematch = view.you.actions?.rematch;
  const title = youWon ? "你赢下了这局" : "本局结束";
  const subtitle = winner ? `${winner.name} 率先锁定第 1 名` : "牌局已结束";
  const reasonText = result?.reason === "aborted"
    ? "牌局被中途终止。"
    : view.maxPlayers === 2
      ? "2 人局：第 1 名锁定后立即结束。"
      : "3 人局：第 1 名锁定后剩余两人继续，第 2 名锁定后结束。";

  return h("main", { class: "screen result-screen" },
    h("div", { class: "result-wrap" },
      h("div", { class: "result-eyebrow" }, "ROUND OVER · 唬牌"),
      h("h1", { class: "result-title" }, title),
      h("p", { class: "result-subtitle" }, subtitle),
      h("div", { class: "result-card" },
        podium(ranking, view.you.playerId),
        h("p", { class: "result-reason" }, reasonText),
        h("div", { class: "result-actions" },
          rematch?.allowed
            ? button("再来一局", { variant: "primary", onClick: onRematch })
            : h("div", { class: "result-note" }, "等待房主发起再来一局"),
          button("返回首页", { variant: "ghost", onClick: onHome }),
          button("查看记录", { variant: "quiet", onClick: onHistory })
        ),
        h("p", { class: "result-note" }, "出牌、揭牌与名次判定均由服务端/本地规则引擎计算；前端只负责展示。")
      )
    )
  );
}
