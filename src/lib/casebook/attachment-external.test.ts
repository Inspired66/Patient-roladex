import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  BROWSER_ONLY_MESSAGE,
  EMPTY_TEXT_MESSAGE,
  EXTERNAL_BUSY_MESSAGE,
  EXTERNAL_FAILED_MESSAGE,
  externalMime,
  MISSING_FILE_MESSAGE,
  NO_APP_MESSAGE,
  NOT_OPENED_MESSAGE,
  OPEN_CHUNK_BYTES,
  OPENED_MESSAGE,
  openExternally,
  REFUSED_MESSAGE,
  toBase64,
  type ExternalDeps,
} from "./attachment-open.ts";
import {
  EXTERNAL_NOTICE_BODY,
  EXTERNAL_NOTICE_KEY,
  hasAcceptedExternalNotice,
  registerExternalNoticeHost,
  rememberExternalNotice,
  requestExternalNotice,
  resetExternalNotice,
} from "./external-notice.ts";
import { MAX_FILE_BYTES } from "./files.ts";

type Call = { action: string; payload: Record<string, unknown> | undefined };

const input = (name = "r.pdf", mime = "application/pdf", size = 10) => ({ id: "a1", name, mime, size });

function setup(
  options: {
    blob?: Blob | undefined;
    bridge?: boolean;
    accepted?: boolean;
    ask?: boolean;
    replies?: Record<string, unknown>;
    throwOn?: string;
  } = {},
) {
  const calls: Call[] = [];
  const state = { reads: 0, asked: 0, remembered: 0, accepted: options.accepted ?? true };
  const blob = "blob" in options ? options.blob : new Blob([new Uint8Array(10)]);
  const deps: ExternalDeps = {
    hasBridge: () => options.bridge ?? true,
    async call<T>(action: string, payload?: unknown) {
      calls.push({ action, payload: payload as Record<string, unknown> | undefined });
      if (options.throwOn === action) throw new Error("bridge failed");
      const reply = options.replies?.[action];
      if (reply !== undefined) return reply as T;
      if (action === "finishOpenFile") return { outcome: "opened" } as T;
      return { accepted: true } as T;
    },
    async getBlob() {
      state.reads += 1;
      return blob;
    },
    noticeAccepted: () => state.accepted,
    async askNotice() {
      state.asked += 1;
      return options.ask ?? true;
    },
    rememberNotice() {
      state.remembered += 1;
      state.accepted = true;
    },
    newTransferId: () => "transfer-test-1",
  };
  return { deps, calls, state };
}

test("browser fallback: no bridge means unavailable, no read, no notice", async () => {
  const { deps, calls, state } = setup({ bridge: false });
  const result = await openExternally(input(), deps);
  assert.deepEqual(result, { outcome: "unavailable", message: BROWSER_ONLY_MESSAGE });
  assert.equal(BROWSER_ONLY_MESSAGE, "Opening files in another app only works in the Vellum app.");
  assert.equal(state.reads, 0);
  assert.equal(state.asked, 0);
  assert.equal(calls.length, 0);
});

test("MIME mapping sent to native: exact types, extension fallback, uppercase, refusals", () => {
  assert.equal(externalMime({ name: "a", mime: "application/pdf" }), "application/pdf");
  assert.equal(externalMime({ name: "a", mime: "Application/PDF; x=1" }), "application/pdf");
  assert.equal(externalMime({ name: "SCAN.PDF", mime: "" }), "application/pdf");
  assert.equal(externalMime({ name: "p.HEIC", mime: "application/octet-stream" }), "image/heic");
  assert.equal(externalMime({ name: "n.txt", mime: "" }), "text/plain");
  assert.equal(externalMime({ name: "v.m4a", mime: "" }), "audio/mp4");
  assert.equal(externalMime({ name: "x.html", mime: "text/html" }), null);
  assert.equal(externalMime({ name: "x.pdf", mime: "text/html" }), null);
  assert.equal(externalMime({ name: "x.exe", mime: "" }), null);
  assert.equal(externalMime({ name: "noext", mime: "" }), null);
  assert.equal(externalMime({ name: "data.csv", mime: "text/csv" }), null);
});

test("AMR and 3GPP MIME mappings are passed unchanged through the native handoff", async () => {
  for (const [name, storedMime, expectedMime] of [
    ["voice.3gp", "", "audio/3gpp"],
    ["voice.3gpp", "application/octet-stream", "audio/3gpp"],
    ["voice.amr", "", "audio/amr"],
    ["voice.amr", "audio/3gpp", "audio/3gpp"],
    ["voice.3gpp2", "", "audio/3gpp2"],
    ["voice.amr", "audio/x-amr", "audio/x-amr"],
  ]) {
    const { deps, calls } = setup();
    const result = await openExternally(input(name, storedMime, 10), deps);
    assert.equal(result.outcome, "opened");
    assert.equal(calls[0].action, "beginOpenFile");
    assert.equal(calls[0].payload?.mime, expectedMime);
  }
});

test("disallowed types are refused before any read", async () => {
  const { deps, calls, state } = setup();
  const result = await openExternally(input("x.exe", "application/x-msdownload"), deps);
  assert.deepEqual(result, { outcome: "refused", message: REFUSED_MESSAGE });
  assert.equal(state.reads, 0);
  assert.equal(calls.length, 0);
});

test("chunking: sequential, bounded, exact total, begin then chunks then finish", async () => {
  const size = OPEN_CHUNK_BYTES * 2 + 123;
  const bytes = new Uint8Array(size);
  for (let i = 0; i < size; i += 1) bytes[i] = i % 251;
  const { deps, calls } = setup({ blob: new Blob([bytes]) });
  const result = await openExternally(input("big.pdf", "application/pdf", size), deps);
  assert.deepEqual(result, { outcome: "opened", message: OPENED_MESSAGE });
  assert.deepEqual(
    calls.map((c) => c.action),
    ["beginOpenFile", "writeOpenChunk", "writeOpenChunk", "writeOpenChunk", "finishOpenFile"],
  );
  assert.deepEqual(calls[0].payload, { transferId: "transfer-test-1", mime: "application/pdf", size });
  const chunks = calls.filter((c) => c.action === "writeOpenChunk");
  assert.deepEqual(
    chunks.map((c) => c.payload?.seq),
    [0, 1, 2],
  );
  const joined: number[] = [];
  for (const chunk of chunks) {
    const data = chunk.payload?.data as string;
    assert.ok(data.length <= Math.ceil(OPEN_CHUNK_BYTES / 3) * 4, "base64 within the native limit");
    for (const byte of Buffer.from(data, "base64")) joined.push(byte);
    assert.deepEqual(Object.keys(chunk.payload ?? {}).sort(), ["data", "seq", "transferId"]);
  }
  assert.equal(joined.length, size);
  assert.deepEqual(Buffer.from(joined), Buffer.from(bytes));
  assert.deepEqual(calls[4].payload, { transferId: "transfer-test-1" });
});

test("no file name or path is ever sent to native", async () => {
  const { deps, calls } = setup();
  await openExternally(input("Jane Doe discharge.pdf", "application/pdf"), deps);
  assert.equal(JSON.stringify(calls).includes("Jane"), false);
  assert.equal(JSON.stringify(calls).includes("discharge"), false);
  assert.equal(
    calls.every((c) => !("name" in (c.payload ?? {})) && !("path" in (c.payload ?? {}))),
    true,
  );
});

test("toBase64 round-trips binary data", () => {
  const bytes = Uint8Array.from({ length: 70000 }, (_, i) => (i * 7) % 256);
  assert.deepEqual(Buffer.from(toBase64(bytes), "base64"), Buffer.from(bytes));
});

test("missing and empty files, and the size cap", async () => {
  let r = setup({ blob: undefined });
  assert.deepEqual(await openExternally(input(), r.deps), {
    outcome: "unavailable",
    message: MISSING_FILE_MESSAGE,
  });
  assert.equal(r.state.asked, 0);
  assert.equal(r.calls.length, 0);

  r = setup({ blob: new Blob([]) });
  assert.deepEqual(await openExternally(input(), r.deps), {
    outcome: "refused",
    message: EMPTY_TEXT_MESSAGE,
  });
  assert.equal(r.calls.length, 0);

  r = setup({ blob: new Blob([new Uint8Array(MAX_FILE_BYTES + 1)]) });
  assert.deepEqual(await openExternally(input(), r.deps), {
    outcome: "refused",
    message: REFUSED_MESSAGE,
  });
  assert.equal(r.calls.length, 0);

  r = setup({ blob: new Blob([new Uint8Array(MAX_FILE_BYTES)]) });
  assert.equal((await openExternally(input(), r.deps)).outcome, "opened");
});

test("outcome mapping from native replies", async () => {
  const map = async (replies: Record<string, unknown>, throwOn?: string) => {
    const r = setup({ replies, throwOn });
    return { result: await openExternally(input(), r.deps), calls: r.calls };
  };
  assert.deepEqual((await map({ finishOpenFile: { outcome: "no-app" } })).result, {
    outcome: "no-app",
    message: NO_APP_MESSAGE,
  });
  assert.deepEqual((await map({ finishOpenFile: { outcome: "failed" } })).result, {
    outcome: "unavailable",
    message: EXTERNAL_FAILED_MESSAGE,
  });
  assert.deepEqual((await map({ beginOpenFile: { accepted: false, reason: "busy" } })).result, {
    outcome: "refused",
    message: EXTERNAL_BUSY_MESSAGE,
  });
  for (const reason of ["mime", "size", "id", "payload", "origin"]) {
    const { result } = await map({ beginOpenFile: { accepted: false, reason } });
    assert.deepEqual(result, { outcome: "refused", message: REFUSED_MESSAGE });
  }
  for (const reason of ["io", "order", "expired", "none"]) {
    const { result } = await map({ beginOpenFile: { accepted: false, reason } });
    assert.deepEqual(result, { outcome: "unavailable", message: EXTERNAL_FAILED_MESSAGE });
  }
});

test("failure after begin aborts cleanly: refused chunk, thrown bridge error, refused finish", async () => {
  // Native refused a chunk: it has already discarded the copy, so no cancel is needed.
  let r = setup({ replies: { writeOpenChunk: { accepted: false, reason: "order" } } });
  let result = await openExternally(input(), r.deps);
  assert.equal(result.outcome, "unavailable");
  assert.deepEqual(
    r.calls.map((c) => c.action),
    ["beginOpenFile", "writeOpenChunk"],
  );

  // The bridge itself failed mid-transfer: ask native to cancel.
  r = setup({ throwOn: "writeOpenChunk" });
  result = await openExternally(input(), r.deps);
  assert.deepEqual(result, { outcome: "unavailable", message: EXTERNAL_FAILED_MESSAGE });
  assert.deepEqual(
    r.calls.map((c) => c.action),
    ["beginOpenFile", "writeOpenChunk", "cancelOpenFile"],
  );

  // Failure on finish never leaves a dangling cancel.
  r = setup({ throwOn: "finishOpenFile" });
  result = await openExternally(input(), r.deps);
  assert.equal(result.outcome, "unavailable");

  r = setup({ replies: { finishOpenFile: { accepted: false, reason: "size" } } });
  result = await openExternally(input(), r.deps);
  assert.deepEqual(result, { outcome: "refused", message: REFUSED_MESSAGE });
  assert.equal(r.calls.at(-1)?.action, "finishOpenFile");
});

test("a thrown error from begin sends no cancel", async () => {
  const r = setup({ throwOn: "beginOpenFile" });
  const result = await openExternally(input(), r.deps);
  assert.equal(result.outcome, "unavailable");
  assert.deepEqual(
    r.calls.map((c) => c.action),
    ["beginOpenFile"],
  );
});

test("one-time notice: shown first time, remembered, declined means nothing is sent", async () => {
  let r = setup({ accepted: false, ask: true });
  assert.equal((await openExternally(input(), r.deps)).outcome, "opened");
  assert.equal(r.state.asked, 1);
  assert.equal(r.state.remembered, 1);
  assert.equal((await openExternally(input(), r.deps)).outcome, "opened");
  assert.equal(r.state.asked, 1, "not asked again after it was accepted");

  r = setup({ accepted: false, ask: false });
  assert.deepEqual(await openExternally(input(), r.deps), {
    outcome: "refused",
    message: NOT_OPENED_MESSAGE,
  });
  assert.equal(r.state.remembered, 0);
  assert.equal(r.calls.length, 0, "declining sends nothing to the phone");

  r = setup({ accepted: true });
  await openExternally(input(), r.deps);
  assert.equal(r.state.asked, 0, "already accepted opens directly");
});

test("notice storage stores one boolean, can be reset, and survives broken storage", () => {
  const data = new Map<string, string>();
  const storage = {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  };
  assert.equal(hasAcceptedExternalNotice(storage), false);
  rememberExternalNotice(storage);
  assert.deepEqual([...data.entries()], [[EXTERNAL_NOTICE_KEY, "1"]]);
  assert.equal(hasAcceptedExternalNotice(storage), true);
  resetExternalNotice(storage);
  assert.equal(hasAcceptedExternalNotice(storage), false);
  data.set(EXTERNAL_NOTICE_KEY, "true");
  assert.equal(hasAcceptedExternalNotice(storage), false);

  const broken = {
    getItem: () => {
      throw new Error("denied");
    },
    setItem: () => {
      throw new Error("denied");
    },
    removeItem: () => {
      throw new Error("denied");
    },
  };
  assert.equal(hasAcceptedExternalNotice(broken), false);
  rememberExternalNotice(broken);
  resetExternalNotice(broken);
  assert.equal(hasAcceptedExternalNotice(null), false);
});

test("notice wording", () => {
  assert.equal(
    EXTERNAL_NOTICE_BODY,
    "This file will open in another app on your phone. That app is outside Vellum's protections: it may keep a copy, show it in recent apps, or sync it online. Vellum deletes its temporary copy afterwards.",
  );
});

test("notice request: no host or a second request resolves false, host answers pass through", async () => {
  assert.equal(await requestExternalNotice(), false);
  let answer: ((accepted: boolean) => void) | null = null;
  const unregister = registerExternalNoticeHost((resolve) => {
    answer = resolve;
  });
  const first = requestExternalNotice();
  assert.equal(await requestExternalNotice(), false, "second request while one is showing");
  answer!(true);
  assert.equal(await first, true);
  const second = requestExternalNotice();
  answer!(false);
  assert.equal(await second, false);
  unregister();
  assert.equal(await requestExternalNotice(), false);
});

test("the web code adds no network use, logging, or file-name leaks", () => {
  const source = readFileSync(new URL("./attachment-open.ts", import.meta.url), "utf8");
  const notice = readFileSync(new URL("./external-notice.ts", import.meta.url), "utf8");
  for (const text of [source, notice]) {
    assert.equal(/console\.|fetch\(|XMLHttpRequest|WebSocket|sendBeacon/.test(text), false);
  }
  const start = source.indexOf("async function transfer");
  const end = source.indexOf("export type TextPreview");
  assert.equal(/file\.name|\.name\b/.test(source.slice(start, end)), false);
});
