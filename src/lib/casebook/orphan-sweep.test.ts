import assert from "node:assert/strict";
import test from "node:test";
import {
  ORPHAN_GRACE_MS,
  sweepOrphanBlobs,
  withBlobWriteInProgress,
  withRestoreInProgress,
} from "./files.ts";

function fakeStore(initial: string[], clock = { t: ORPHAN_GRACE_MS * 10 }) {
  const blobs = new Set(initial);
  const marks = new Map<string, number>();
  const removed: string[] = [];
  return {
    blobs,
    marks,
    removed,
    clock,
    ops: {
      list: async () => [...blobs],
      remove: async (id: string) => {
        removed.push(id);
        blobs.delete(id);
      },
      marks: async () => new Map(marks),
      mark: async (id: string, t: number) => {
        marks.set(id, t);
      },
      unmark: async (id: string) => {
        marks.delete(id);
      },
      now: () => clock.t,
    },
  };
}

test("first sighting only marks; nothing is deleted before the grace period", async () => {
  const f = fakeStore(["orphan"]);
  assert.equal(await sweepOrphanBlobs(new Set(), { store: f.ops }), 0);
  assert.deepEqual(f.removed, []);
  assert.equal(f.marks.get("orphan"), f.clock.t);
  f.clock.t += ORPHAN_GRACE_MS - 1;
  assert.equal(await sweepOrphanBlobs(new Set(), { store: f.ops }), 0);
  assert.ok(f.blobs.has("orphan"));
});

test("a blob unreferenced for the full grace period is deleted and its mark cleared", async () => {
  const f = fakeStore(["orphan", "kept"]);
  await sweepOrphanBlobs(new Set(["kept"]), { store: f.ops });
  f.clock.t += ORPHAN_GRACE_MS;
  assert.equal(await sweepOrphanBlobs(new Set(["kept"]), { store: f.ops }), 1);
  assert.deepEqual(f.removed, ["orphan"]);
  assert.ok(f.blobs.has("kept"));
  assert.equal(f.marks.size, 0);
});

test("a blob that becomes referenced again loses its mark and is kept", async () => {
  const f = fakeStore(["late"]);
  await sweepOrphanBlobs(new Set(), { store: f.ops });
  f.clock.t += ORPHAN_GRACE_MS * 2;
  assert.equal(await sweepOrphanBlobs(new Set(["late"]), { store: f.ops }), 0);
  assert.equal(f.marks.size, 0);
  f.clock.t += ORPHAN_GRACE_MS * 2;
  assert.equal(await sweepOrphanBlobs(new Set(), { store: f.ops }), 0);
  assert.ok(f.blobs.has("late"));
});

test("a mark dated in the future is treated as new", async () => {
  const f = fakeStore(["x"]);
  f.marks.set("x", f.clock.t + ORPHAN_GRACE_MS * 10);
  assert.equal(await sweepOrphanBlobs(new Set(), { store: f.ops }), 0);
  assert.ok(f.blobs.has("x"));
  assert.equal(f.marks.get("x"), f.clock.t);
});

test("does nothing while a restore or an add is in progress", async () => {
  const f = fakeStore(["old"]);
  f.marks.set("old", 0);
  await withRestoreInProgress(async () => {
    assert.equal(await sweepOrphanBlobs(new Set(), { store: f.ops }), 0);
  });
  await withBlobWriteInProgress(async () => {
    assert.equal(await sweepOrphanBlobs(new Set(), { store: f.ops }), 0);
  });
  assert.deepEqual(f.removed, []);
});

test("aborts when a restore or add starts after the blobs were listed", async () => {
  for (const wrap of [withRestoreInProgress, withBlobWriteInProgress]) {
    const f = fakeStore(["old"]);
    f.marks.set("old", 0);
    let started: Promise<unknown> = Promise.resolve();
    const racing = {
      ...f.ops,
      list: async () => {
        started = wrap(async () => undefined);
        return [...f.blobs];
      },
    };
    assert.equal(await sweepOrphanBlobs(new Set(), { store: racing }), 0);
    await started;
    assert.deepEqual(f.removed, []);
  }
});

test("a record saved after listing is respected right before deleting", async () => {
  const f = fakeStore(["old"]);
  f.marks.set("old", 0);
  const live = new Set<string>();
  let calls = 0;
  const referenced = () => {
    calls += 1;
    if (calls > 1) live.add("old");
    return live;
  };
  assert.equal(await sweepOrphanBlobs(referenced, { store: f.ops }), 0);
  assert.ok(f.blobs.has("old"));
});

test("never runs before the store has loaded, or when stored data is unreadable", async () => {
  const f = fakeStore(["old"]);
  f.marks.set("old", 0);
  assert.equal(await sweepOrphanBlobs(new Set(), { store: f.ops, ready: () => false }), 0);
  assert.deepEqual(f.removed, []);
  assert.deepEqual([...f.marks.keys()], ["old"]);
  await assert.rejects(
    sweepOrphanBlobs(
      () => {
        throw new Error("unreadable");
      },
      { store: f.ops },
    ),
  );
  assert.deepEqual(f.removed, []);
});

test("a failing delete leaves the mark so it is retried, and never throws data away", async () => {
  const f = fakeStore(["old"]);
  f.marks.set("old", 0);
  const failing = {
    ...f.ops,
    remove: async () => {
      throw new Error("blocked");
    },
  };
  await assert.rejects(sweepOrphanBlobs(new Set(), { store: failing }));
  assert.ok(f.blobs.has("old"));
  assert.ok(f.marks.has("old"));
});

test("a failing mark write still deletes nothing", async () => {
  const f = fakeStore(["old"]);
  const failing = {
    ...f.ops,
    mark: async () => {
      throw new Error("no space");
    },
  };
  await assert.rejects(sweepOrphanBlobs(new Set(), { store: failing }));
  assert.deepEqual(f.removed, []);
});

test("Not restored ids stay referenced, and blobs of the swept store stay intact", async () => {
  const f = fakeStore(["a", "b"]);
  f.marks.set("a", 0);
  f.marks.set("b", 0);
  assert.equal(await sweepOrphanBlobs(new Set(["a", "b", "not-restored"]), { store: f.ops }), 0);
  assert.equal(f.blobs.size, 2);
  assert.equal(f.marks.size, 0);
});
