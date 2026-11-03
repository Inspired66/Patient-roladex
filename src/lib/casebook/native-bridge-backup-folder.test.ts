import assert from "node:assert/strict";
import test from "node:test";
import {
  createBackupFolderClient,
  deliverBackupFolderStatus,
  subscribeBackupFolderStatus,
  type BackupFolderStatusCode,
} from "./native-bridge.ts";

type Call = { action: string; payload: unknown };

function fakeBridge(options: { replies?: Record<string, unknown>; fail?: string } = {}) {
  const calls: Call[] = [];
  const call = async <T>(action: string, payload?: unknown): Promise<T | null> => {
    calls.push({ action, payload });
    if (options.fail === action) throw new Error("The backup folder is not available.");
    return (options.replies?.[action] ?? {}) as T;
  };
  return { calls, client: createBackupFolderClient(call) };
}

test("backup folder wrappers send exact action names and payloads", async () => {
  const { calls, client } = fakeBridge({
    replies: {
      armBackupFolder: { picked: true },
      listBackupFolder: { entries: [{ ref: 1, size: 12 }], nextCursor: null },
    },
  });
  assert.deepEqual(await client.arm("write"), { picked: true });
  assert.deepEqual(await client.list(0), {
    entries: [{ ref: 1, size: 12 }],
    nextCursor: null,
  });
  await client.beginFile({
    kind: "attachment",
    name: `vellum-${"a".repeat(26)}.vea`,
    size: 12,
  });
  await client.writeChunk(0, btoa("hello"));
  await client.finishFile();
  await client.abortFile();
  await client.readChunk(1, 0, 5);
  await client.close();
  assert.deepEqual(
    calls.map(({ action }) => action),
    [
      "armBackupFolder",
      "listBackupFolder",
      "beginBackupFile",
      "writeBackupChunk",
      "finishBackupFile",
      "abortBackupFile",
      "readBackupChunk",
      "closeBackupFolder",
    ],
  );
  assert.deepEqual(calls.map(({ payload }) => payload), [
    { mode: "write" },
    { cursor: 0 },
    { kind: "attachment", name: `vellum-${"a".repeat(26)}.vea`, size: 12 },
    { seq: 0, data: btoa("hello") },
    undefined,
    undefined,
    { ref: 1, offset: 0, length: 5 },
    undefined,
  ]);
});

test("folder status callback accepts only the fixed status codes", () => {
  const priorWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const target: { __vellumBackupStatus?: (code: unknown) => void } = {};
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: target,
  });
  const received: BackupFolderStatusCode[] = [];
  const unsubscribe = subscribeBackupFolderStatus((code) => received.push(code));
  const codes: BackupFolderStatusCode[] = [
    "paused",
    "folder-lost",
    "no-space",
    "cancelled",
    "done",
    "name-changed",
  ];
  try {
    for (const code of codes) target.__vellumBackupStatus?.(code);
    target.__vellumBackupStatus?.("patient-name");
    target.__vellumBackupStatus?.({ code: "done" });
    assert.deepEqual(received, codes);
    unsubscribe();
    assert.equal(target.__vellumBackupStatus, undefined);
    deliverBackupFolderStatus("done");
    assert.deepEqual(received, codes);
  } finally {
    unsubscribe();
    if (priorWindow) Object.defineProperty(globalThis, "window", priorWindow);
    else Reflect.deleteProperty(globalThis, "window");
  }
});

test("bad input is refused locally without calling the bridge", async () => {
  const { calls, client } = fakeBridge();
  const expectInvalid = async (promise: Promise<unknown>, message: string) => {
    await assert.rejects(promise, { message });
    assert.equal(calls.length, 0);
  };

  await expectInvalid(client.arm("other" as "read"), "That backup folder request is invalid.");
  await expectInvalid(client.list(-1), "That backup folder request is invalid.");
  await expectInvalid(client.list(20_002), "That backup folder request is invalid.");
  await expectInvalid(
    client.beginFile({ kind: "attachment", name: "patient.pdf", size: 12 }),
    "That backup file request is invalid.",
  );
  await expectInvalid(
    client.beginFile({
      kind: "attachment",
      name: `vellum-${"a".repeat(26)}.vellum`,
      size: 12,
    }),
    "That backup file request is invalid.",
  );
  await expectInvalid(
    client.beginFile({
      kind: "data",
      name: `vellum-${"a".repeat(26)}.vellum`,
      size: 0,
    }),
    "That backup file request is invalid.",
  );
  await expectInvalid(
    client.beginFile({
      kind: "data",
      name: `vellum-${"a".repeat(26)}.vellum`,
      size: 12,
      extra: true,
    } as never),
    "That backup file request is invalid.",
  );
  await expectInvalid(client.writeChunk(-1, btoa("x")), "That backup chunk is invalid.");
  await expectInvalid(client.writeChunk(0, "not base64"), "That backup chunk is invalid.");
  await expectInvalid(
    client.writeChunk(0, btoa("x".repeat(96 * 1024 + 1))),
    "That backup chunk is invalid.",
  );
  await expectInvalid(client.readChunk(0, 0, 1), "That backup read request is invalid.");
  await expectInvalid(client.readChunk(1, 0, 96 * 1024 + 1), "That backup read request is invalid.");
});

test("native fixed failures are surfaced without rewriting their messages", async () => {
  const { calls, client } = fakeBridge({ fail: "listBackupFolder" });
  await assert.rejects(client.list(0), { message: "The backup folder is not available." });
  assert.equal(calls.length, 1);
});
