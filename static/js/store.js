/** 极简发布订阅 store。状态只在 main.js 一处写入。 */

export function createStore(initialState = {}) {
  let state = { ...initialState };
  const listeners = new Set();

  return {
    get() {
      return state;
    },
    set(patch) {
      const next = typeof patch === "function" ? patch(state) : patch;
      if (!next || typeof next !== "object") return state;
      state = { ...state, ...next };
      for (const listener of listeners) listener(state);
      return state;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }
  };
}
