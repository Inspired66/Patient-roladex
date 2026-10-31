import { NOT_OPENED_MESSAGE } from "./attachment-open.ts";

export type NoticeKind = "prompt" | "success" | "error" | "info";

// `handoff` marks a message that came from an attempt to open the file in another app.
export type RowNotice = { kind: NoticeKind; message: string; handoff: boolean; seq: number };
export type NoticeState = { notice: RowNotice | null; seq: number };

export const INITIAL_NOTICE_STATE: NoticeState = { notice: null, seq: 0 };
export const SUCCESS_NOTICE_MS = 4000;

export type NoticeEvent =
  | { type: "show"; kind: NoticeKind; message: string; handoff?: boolean }
  | { type: "action" }
  | { type: "dismiss" }
  | { type: "expire"; seq: number }
  | { type: "foreground" }
  | { type: "other-row" };

// One notice per row. Returns the same state object when nothing changes.
export function noticeReducer(state: NoticeState, event: NoticeEvent): NoticeState {
  const current = state.notice;
  switch (event.type) {
    case "show": {
      const seq = state.seq + 1;
      return {
        seq,
        notice: { kind: event.kind, message: event.message, handoff: event.handoff ?? false, seq },
      };
    }
    case "action":
    case "dismiss":
      return current ? { ...state, notice: null } : state;
    case "expire":
      return current?.kind === "success" && current.seq === event.seq
        ? { ...state, notice: null }
        : state;
    case "foreground":
      // A prompt waits for the user; stale results of a hand-off do not.
      if (current && (current.kind === "success" || (current.handoff && current.kind !== "prompt"))) {
        return { ...state, notice: null };
      }
      return state;
    case "other-row":
      return current?.kind === "prompt" ? { ...state, notice: null } : state;
  }
}

export function noticeForOpenResult(
  outcome: string,
  message: string,
): { kind: NoticeKind; handoff: boolean } {
  if (message === NOT_OPENED_MESSAGE || outcome === "not-restored") {
    return { kind: "info", handoff: false };
  }
  if (outcome === "opened") return { kind: "success", handoff: true };
  return {
    kind: "error",
    handoff: outcome === "no-app" || outcome === "refused" || outcome === "unavailable",
  };
}

export type NoticeTimers = {
  set: (fn: () => void, ms: number) => unknown;
  clear: (handle: unknown) => void;
};

const realTimers: NoticeTimers = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

// Runs the reducer, owns the one success timer, and goes quiet after dispose().
export function createNoticeController(options: {
  onChange: (notice: RowNotice | null) => void;
  timers?: NoticeTimers;
  successMs?: number;
}) {
  const timers = options.timers ?? realTimers;
  const successMs = options.successMs ?? SUCCESS_NOTICE_MS;
  let state = INITIAL_NOTICE_STATE;
  let timer: unknown = null;
  let disposed = false;

  function cancelTimer() {
    if (timer !== null) timers.clear(timer);
    timer = null;
  }

  function dispatch(event: NoticeEvent) {
    if (disposed) return;
    const next = noticeReducer(state, event);
    if (next === state) return;
    state = next;
    cancelTimer();
    const notice = state.notice;
    if (notice?.kind === "success") {
      timer = timers.set(() => dispatch({ type: "expire", seq: notice.seq }), successMs);
    }
    options.onChange(notice);
  }

  return {
    get: () => state.notice,
    show: (kind: NoticeKind, message: string, handoff = false) =>
      dispatch({ type: "show", kind, message, handoff }),
    action: () => dispatch({ type: "action" }),
    dismiss: () => dispatch({ type: "dismiss" }),
    foreground: () => dispatch({ type: "foreground" }),
    otherRowAction: () => dispatch({ type: "other-row" }),
    dispose() {
      disposed = true;
      cancelTimer();
    },
  };
}

export type NoticeController = ReturnType<typeof createNoticeController>;

type Target = {
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
};

// Fires when the page becomes visible again or the window regains focus, whichever the WebView
// delivers. Returns the cleanup.
export function listenForeground(
  doc: Target & { visibilityState?: string },
  win: Target,
  onForeground: () => void,
) {
  const onVisibility = () => {
    if (doc.visibilityState === "visible") onForeground();
  };
  doc.addEventListener("visibilitychange", onVisibility);
  win.addEventListener("focus", onForeground);
  return () => {
    doc.removeEventListener("visibilitychange", onVisibility);
    win.removeEventListener("focus", onForeground);
  };
}

// Starting an action in one row closes a pending prompt in every other row.
type RowActionListener = (sourceId: number) => void;
const rowActionListeners = new Set<RowActionListener>();
let nextRowId = 0;

export function newRowId() {
  nextRowId += 1;
  return nextRowId;
}

export function subscribeRowActions(listener: RowActionListener) {
  rowActionListeners.add(listener);
  return () => {
    rowActionListeners.delete(listener);
  };
}

export function announceRowAction(sourceId: number) {
  for (const listener of [...rowActionListeners]) listener(sourceId);
}
