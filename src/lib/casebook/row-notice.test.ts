import assert from "node:assert/strict";
import test from "node:test";
import {
  createNoticeController,
  INITIAL_NOTICE_STATE,
  listenForeground,
  noticeForOpenResult,
  noticeReducer,
  type NoticeTimers,
  type RowNotice,
} from "./row-notice.ts";

function fakeTimers() {
  const pending = new Map<number, { fn: () => void; ms: number }>();
  let id = 0;
  const timers: NoticeTimers = {
    set: (fn, ms) => {
      id += 1;
      pending.set(id, { fn, ms });
      return id;
    },
    clear: (h) => void pending.delete(h as number),
  };
  return { timers, pending, fire: () => [...pending.values()].forEach((t) => t.fn()) };
}

function setup() {
  const t = fakeTimers();
  const seen: (RowNotice | null)[] = [];
  const c = createNoticeController({ onChange: (n) => seen.push(n), timers: t.timers });
  return { t, seen, c };
}

test("prompt clears on action, dismiss and other row", () => {
  for (const type of ["action", "dismiss", "other-row"] as const) {
    let s = noticeReducer(INITIAL_NOTICE_STATE, { type: "show", kind: "prompt", message: "p" });
    s = noticeReducer(s, { type });
    assert.equal(s.notice, null);
  }
});

test("prompt survives foreground return", () => {
  const s = noticeReducer(INITIAL_NOTICE_STATE, { type: "show", kind: "prompt", message: "p" });
  assert.equal(noticeReducer(s, { type: "foreground" }), s);
});

test("success replaces prompt and auto-clears after 4s", () => {
  const { t, c } = setup();
  c.show("prompt", "p");
  c.show("success", "ok", true);
  assert.equal(c.get()?.kind, "success");
  assert.equal([...t.pending.values()][0].ms, 4000);
  t.fire();
  assert.equal(c.get(), null);
});

test("success clears on foreground and cancels its timer", () => {
  const { t, c } = setup();
  c.show("success", "ok", true);
  c.foreground();
  assert.equal(c.get(), null);
  assert.equal(t.pending.size, 0);
});

test("stale timer cannot clear a newer notice", () => {
  const s1 = noticeReducer(INITIAL_NOTICE_STATE, { type: "show", kind: "success", message: "a" });
  const s2 = noticeReducer(s1, { type: "show", kind: "error", message: "b" });
  assert.equal(noticeReducer(s2, { type: "expire", seq: 1 }), s2);
});

test("errors persist until dismissed; hand-off errors clear on foreground", () => {
  const { t, c } = setup();
  c.show("error", "missing");
  c.foreground();
  assert.equal(c.get()?.message, "missing");
  assert.equal(t.pending.size, 0);
  c.dismiss();
  assert.equal(c.get(), null);
  c.show("error", "no app", true);
  c.foreground();
  assert.equal(c.get(), null);
});

test("info persists through foreground unless from a hand-off", () => {
  const { c } = setup();
  c.show("info", "Not restored");
  c.foreground();
  assert.equal(c.get()?.kind, "info");
  c.show("info", "Not opened.", true);
  c.foreground();
  assert.equal(c.get(), null);
});

test("a new action replaces the old notice; one notice at a time", () => {
  const { c } = setup();
  c.show("error", "a");
  c.show("info", "b");
  assert.equal(c.get()?.message, "b");
  c.action();
  assert.equal(c.get(), null);
});

test("dispose cancels timers and silences updates", () => {
  const { t, seen, c } = setup();
  c.show("success", "ok", true);
  const count = seen.length;
  c.dispose();
  assert.equal(t.pending.size, 0);
  c.show("error", "late");
  c.dismiss();
  assert.equal(seen.length, count);
});

test("result mapping", () => {
  assert.deepEqual(noticeForOpenResult("opened", "x"), { kind: "success", handoff: true });
  assert.deepEqual(noticeForOpenResult("no-app", "x"), { kind: "error", handoff: true });
  assert.deepEqual(noticeForOpenResult("missing", "x"), { kind: "error", handoff: false });
  assert.deepEqual(noticeForOpenResult("not-restored", "x"), { kind: "info", handoff: false });
});

test("foreground listeners fire on visible/focus and are removed", () => {
  const handlers = new Map<string, Set<() => void>>();
  const target = (extra: { visibilityState?: string } = {}) => ({
    ...extra,
    addEventListener: (t: string, f: () => void) =>
      handlers.set(t, (handlers.get(t) ?? new Set()).add(f)),
    removeEventListener: (t: string, f: () => void) => handlers.get(t)?.delete(f),
  });
  const doc = target({ visibilityState: "hidden" }) as ReturnType<typeof target> & { visibilityState: string };
  let n = 0;
  const off = listenForeground(doc, target(), () => (n += 1));
  handlers.get("visibilitychange")!.forEach((f) => f());
  assert.equal(n, 0);
  doc.visibilityState = "visible";
  handlers.get("visibilitychange")!.forEach((f) => f());
  handlers.get("focus")!.forEach((f) => f());
  assert.equal(n, 2);
  off();
  assert.equal(handlers.get("focus")!.size + handlers.get("visibilitychange")!.size, 0);
});
