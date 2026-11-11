import { errorText } from "../strings.js";
import { createCard } from "./cards.js";
import { button, h } from "./dom.js";
import { openModal } from "./modals.js";
import { openRules } from "./rules.js";
import { openSettings } from "./settings.js";

const SHOWCASE = [
  { id: "S-A", rank: "A", suit: "S" },
  { id: "H-K", rank: "K", suit: "H" },
  { id: "D-7", rank: "7", suit: "D" },
  { id: "C-Q", rank: "Q", suit: "C" },
  { id: "J-SJ", rank: "SJ", suit: "J" }
];

function brandHeader({ onRules, onSettings } = {}) {
  return h("header", { class: "app-header app-header--floating" },
    h("a", { class: "brand", href: "./", "aria-label": "唬牌首页" },
      h("span", { class: "brand-mark" }, "唬"),
      h("span", {}, "唬牌")
    ),
    h("div", { class: "header-spacer" }),
    h("div", { class: "header-cluster" },
      button("规则", { variant: "quiet", size: "small", onClick: onRules }),
      button("设置", { variant: "quiet", size: "small", onClick: onSettings })
    )
  );
}

function homeArt() {
  return h("div", { class: "home-art", "aria-hidden": "true" },
    h("div", { class: "table-shadow" }),
    h("div", { class: "art-ring" }),
    h("div", { class: "home-card-fan" },
      ...SHOWCASE.map((card) => createCard(card, { className: "showcase-card" }))
    ),
    h("div", { class: "art-caption" }, " bluff · 心理博弈 ")
  );
}

function createRoomDialog({ nickname, onCreate }) {
  const nicknameInput = h("input", {
    class: "input",
    type: "text",
    maxlength: 16,
    value: nickname || "",
    placeholder: "你的昵称",
    autocomplete: "nickname"
  });
  const error = h("div", { class: "form-error", role: "alert" });
  let maxPlayers = 2;
  const radios = [2, 3].map((count) => h("span", {},
    h("input", {
      type: "radio",
      name: "maxPlayers",
      id: `create-max-${count}`,
      value: String(count),
      checked: count === maxPlayers,
      onChange: () => { maxPlayers = count; }
    }),
    h("label", { for: `create-max-${count}` }, `${count} 人局`)
  ));

  const submit = button("创建房间", {
    variant: "primary",
    onClick: async () => {
      const name = nicknameInput.value.trim();
      if (!name) {
        error.textContent = "请先填写昵称。";
        nicknameInput.focus();
        return;
      }
      submit.disabled = true;
      submit.textContent = "创建中…";
      error.textContent = "";
      try {
        await onCreate({ maxPlayers, nickname: name });
        modal.close("created");
      } catch (cause) {
        error.textContent = errorText(cause);
        submit.disabled = false;
        submit.textContent = "创建房间";
      }
    }
  });

  const form = h("form", {
    onSubmit: (event) => {
      event.preventDefault();
      submit.click();
    }
  },
    h("div", { class: "form-field" },
      h("label", { class: "form-label" }, "昵称"),
      nicknameInput
    ),
    h("div", { class: "form-field" },
      h("span", { class: "form-label" }, "人数"),
      h("div", { class: "segmented" }, ...radios)
    ),
    h("p", { class: "form-hint" }, "房间创建后，把房间码发给朋友；房主可以添加 AI 补位并开始。"),
    error
  );

  const modal = openModal({
    title: "创建房间",
    subtitle: "联机模式 · 2～3 人",
    body: form,
    footer: h("div", { class: "modal-actions" },
      button("取消", { variant: "ghost", onClick: () => modal.close("cancel") }),
      submit
    )
  });
  return modal;
}

function joinRoomDialog({ nickname, roomCode, onJoin }) {
  const codeInput = h("input", {
    class: "input input--code",
    type: "text",
    maxlength: 8,
    value: roomCode || "",
    placeholder: "房间码",
    autocomplete: "off",
    spellcheck: false,
    inputmode: "text",
    onInput: () => {
      codeInput.value = codeInput.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
    }
  });
  const nicknameInput = h("input", {
    class: "input",
    type: "text",
    maxlength: 16,
    value: nickname || "",
    placeholder: "你的昵称",
    autocomplete: "nickname"
  });
  const error = h("div", { class: "form-error", role: "alert" });
  const submit = button("加入房间", {
    variant: "primary",
    onClick: async () => {
      const code = codeInput.value.trim().toUpperCase();
      const name = nicknameInput.value.trim();
      if (!code) {
        error.textContent = "请输入房间码。";
        codeInput.focus();
        return;
      }
      if (!name) {
        error.textContent = "请先填写昵称。";
        nicknameInput.focus();
        return;
      }
      submit.disabled = true;
      submit.textContent = "加入中…";
      error.textContent = "";
      try {
        await onJoin({ roomCode: code, nickname: name });
        modal.close("joined");
      } catch (cause) {
        error.textContent = errorText(cause);
        submit.disabled = false;
        submit.textContent = "加入房间";
      }
    }
  });

  const form = h("form", {
    onSubmit: (event) => {
      event.preventDefault();
      submit.click();
    }
  },
    h("div", { class: "form-field" },
      h("label", { class: "form-label" }, "房间码"),
      codeInput,
      h("p", { class: "form-hint" }, "房间码由创建者提供，不区分大小写。")
    ),
    h("div", { class: "form-field" },
      h("label", { class: "form-label" }, "昵称"),
      nicknameInput
    ),
    error
  );

  const modal = openModal({
    title: "加入房间",
    subtitle: "联机模式 · 输入朋友发来的房间码",
    body: form,
    footer: h("div", { class: "modal-actions" },
      button("取消", { variant: "ghost", onClick: () => modal.close("cancel") }),
      submit
    )
  });
  return modal;
}

export function renderHome({
  nickname = "",
  roomCode = "",
  onNicknameChange,
  onQuick,
  onCreate,
  onJoin,
  onRules = openRules,
  onSettings = openSettings
} = {}) {
  const nicknameInput = h("input", {
    type: "text",
    maxlength: 16,
    value: nickname,
    placeholder: "你的昵称",
    "aria-label": "昵称",
    autocomplete: "nickname",
    onInput: () => {
      const value = nicknameInput.value.trim();
      onNicknameChange?.(value);
    }
  });

  const screen = h("main", { class: "screen home-screen" },
    brandHeader({ onRules, onSettings }),
    h("div", { class: "home-main" },
      h("div", { class: "home-copy" },
        h("div", { class: "eyebrow" }, "BLUFFING CARDS · 2–3 PLAYERS"),
        h("h1", { class: "home-title" }, "唬", h("span", {}, "牌")),
        h("p", { class: "home-subtitle" }, "扣下牌，说一个数字。"),
        h("p", { class: "home-subtitle" }, "信，还是不信？"),
        h("div", { class: "home-actions" },
          button("快速人机 · 2 人", { variant: "primary", onClick: () => onQuick?.(2) }),
          button("快速人机 · 3 人", { variant: "ghost", onClick: () => onQuick?.(3) })
        ),
        h("div", { class: "home-actions", style: { marginTop: "10px" } },
          button("创建联机房间", { variant: "ghost", onClick: () => createRoomDialog({ nickname, onCreate }) }),
          button("加入房间", { variant: "ghost", onClick: () => joinRoomDialog({ nickname, roomCode, onJoin }) })
        ),
        h("div", { class: "home-secondary" },
          h("label", { class: "nickname-field" },
            h("span", {}, "昵称"),
            nicknameInput
          ),
          button("规则", { variant: "quiet", onClick: onRules }),
          button("设置", { variant: "quiet", onClick: onSettings })
        ),
        h("p", { class: "home-note" }, "本地人机不需要后端；联机模式需要 C++ 服务端提供 REST 与 WebSocket。")
      ),
      homeArt()
    ),
    h("footer", { class: "home-footer" },
      h("span", {}, "唬牌 · 前端原型"),
      h("span", {}, "零构建 HTML5 + CSS3 + ES Modules"),
      h("span", {}, "2～3 人 · 54 张 · 大小王万能")
    )
  );

  if (roomCode) {
    const note = h("div", { class: "home-note", role: "status" }, `房间 ${roomCode} 已在链接中，点击“加入房间”继续。`);
    screen.querySelector(".home-copy")?.append(note);
  }

  return screen;
}

export { createRoomDialog, joinRoomDialog };
