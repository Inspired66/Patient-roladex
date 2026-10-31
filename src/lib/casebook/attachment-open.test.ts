import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  audioBlobForAttachment,
  audioFormatLabel,
  audioMimeForAttachment,
  canPlayAudioInWebView,
  isWebViewUnplayableAudio,
} from "./audio-format.ts";
import {
  attachmentKind,
  attachmentOpenLabel,
  AUDIO_UNPLAYABLE_MESSAGE,
  BROWSER_ONLY_MESSAGE,
  EMPTY_TEXT_MESSAGE,
  MISSING_FILE_MESSAGE,
  NOT_RESTORED_MESSAGE,
  OPEN_FAILED_MESSAGE,
  openAttachment,
  openExternally,
  externalMime,
  readTextPreview,
  TEXT_PREVIEW_BYTES,
  type OpenDeps,
} from "./attachment-open.ts";
import { useCasebook } from "./store.ts";
import type { Attachment, Patient } from "./types.ts";

const file = (name: string, mime: string, extra: Partial<Attachment> = {}): Attachment => ({
  id: `id-${name}`,
  name,
  mime,
  size: 2048,
  ...extra,
});

function deps(blobs: Record<string, Blob | Error> = {}) {
  const calls = { reads: [] as string[], external: [] as string[] };
  const d: OpenDeps = {
    async getBlob(id) {
      calls.reads.push(id);
      const blob = blobs[id];
      if (blob instanceof Error) throw blob;
      return blob;
    },
    async openExternally(f) {
      calls.external.push(f.id);
      return openExternally(f);
    },
  };
  return { d, calls };
}

test("kind by MIME type, with odd, missing and uppercase cases", () => {
  const k = (name: string, mime: string) => attachmentKind({ name, mime });
  assert.equal(k("a.bin", "image/jpeg"), "image");
  assert.equal(k("a.bin", "audio/mp4"), "audio");
  assert.equal(k("a.bin", "application/pdf"), "pdf");
  assert.equal(k("a.bin", "text/plain"), "text");
  assert.equal(k("a.bin", "TEXT/Plain; charset=utf-8"), "text");
  assert.equal(k("REPORT.PDF", ""), "pdf");
  assert.equal(k("NOTES.TXT", "application/octet-stream"), "text");
  assert.equal(k("PHOTO.JPG", ""), "image");
  assert.equal(k("VOICE.M4A", ""), "audio");
  assert.equal(k("clip.webm", "video/webm"), "audio");
  assert.equal(k("data.csv", "text/csv"), "other");
  assert.equal(k("noextension", ""), "other");
  assert.equal(k("x.docx", "application/msword"), "other");
});

test("images and audio return the blob; reads happen only on open", async () => {
  const blob = new Blob(["x"]);
  const { d, calls } = deps({ "id-a.jpg": blob, "id-v.m4a": blob });
  assert.equal(calls.reads.length, 0);
  assert.deepEqual(await openAttachment(file("a.jpg", "image/jpeg"), d), { type: "image", blob });
  const audio = await openAttachment(file("v.m4a", ""), d);
  assert.equal(audio.type, "audio");
  if (audio.type === "audio") {
    assert.equal(audio.blob.type, "audio/mp4");
    assert.equal(await audio.blob.text(), "x");
  }
  assert.deepEqual(calls.reads, ["id-a.jpg", "id-v.m4a"]);
});

test("audio blob MIME is retained or derived from the filename", () => {
  const formats = [
    ["clip.m4a", "audio/mp4"],
    ["clip.mp3", "audio/mpeg"],
    ["clip.wav", "audio/wav"],
    ["clip.ogg", "audio/ogg"],
    ["clip.webm", "audio/webm"],
    ["clip.3gp", "audio/3gpp"],
    ["clip.3gpp", "audio/3gpp"],
    ["clip.amr", "audio/amr"],
    ["clip.aac", "audio/aac"],
  ] as const;
  for (const [name, mime] of formats) {
    for (const storedMime of ["", "application/octet-stream"]) {
      assert.equal(audioMimeForAttachment(name, storedMime), mime);
      assert.equal(audioBlobForAttachment(new Blob(["bytes"]), name, storedMime).type, mime);
    }
    const upperName = name.toUpperCase();
    assert.equal(audioMimeForAttachment(upperName, ""), mime);
    assert.equal(audioBlobForAttachment(new Blob(["bytes"]), upperName, "").type, mime);
  }
  assert.equal(audioMimeForAttachment("clip.M4A", "audio/mp4; codecs=mp4a.40.2"), "audio/mp4");
  assert.equal(
    audioBlobForAttachment(new Blob(["bytes"], { type: "audio/mp4" }), "clip.m4a", "").type,
    "audio/mp4",
  );
  assert.equal(audioFormatLabel("Recording.amr", "audio/3gpp"), "AMR");
  assert.equal(audioFormatLabel("Recording.M4A", ""), "M4A");
});

test("AMR and 3GPP encodings never use the WebView player", async () => {
  const { d, calls } = deps();
  for (const [name, mime] of [
    ["voice.amr", "audio/amr"],
    ["voice.3gp", "audio/3gpp"],
    ["voice.3gpp", "audio/3gpp"],
    ["voice.3gpp2", "audio/3gpp2"],
    ["voice.amr", "audio/x-amr"],
    ["voice.bin", "audio/3gpp2"],
  ]) {
    assert.equal(isWebViewUnplayableAudio({ name, mime }), true);
    assert.deepEqual(await openAttachment(file(name, mime), d), { type: "audio-unplayable" });
  }
  for (const name of ["VOICE.AMR", "VOICE.3GP", "VOICE.3GPP"]) {
    assert.equal(isWebViewUnplayableAudio({ name, mime: "" }), true);
    assert.equal(isWebViewUnplayableAudio({ name, mime: "application/octet-stream" }), true);
    assert.equal(attachmentKind({ name, mime: "" }), "audio");
    assert.deepEqual(await openAttachment(file(name, ""), d), { type: "audio-unplayable" });
    assert.deepEqual(await openAttachment(file(name, "application/octet-stream"), d), {
      type: "audio-unplayable",
    });
  }
  assert.deepEqual(calls.reads, []);
  assert.deepEqual(calls.external, []);
  assert.equal(
    AUDIO_UNPLAYABLE_MESSAGE,
    "This recording format can't be played inside Vellum. Open it in another app?",
  );
});

test("generic audio formats use canPlayType and external extension MIME mappings", () => {
  assert.equal(
    canPlayAudioInWebView("audio/mpeg", () => "probably"),
    true,
  );
  assert.equal(
    canPlayAudioInWebView("audio/mp4", () => "maybe"),
    true,
  );
  assert.equal(
    canPlayAudioInWebView("audio/ogg", () => ""),
    false,
  );
  assert.equal(
    canPlayAudioInWebView("", () => "probably"),
    false,
  );
  assert.equal(externalMime(file("voice.3gp", "application/octet-stream")), "audio/3gpp");
  assert.equal(externalMime(file("voice.3gpp", "")), "audio/3gpp");
  assert.equal(externalMime(file("voice.amr", "")), "audio/amr");
  assert.equal(externalMime(file("voice.3gpp2", "")), "audio/3gpp2");
  assert.equal(externalMime(file("voice.amr", "audio/x-amr")), "audio/x-amr");
});

test("PDF and other types go to openExternally without reading the file", async () => {
  const { d, calls } = deps();
  const pdf = await openAttachment(file("r.PDF", "application/pdf"), d);
  assert.deepEqual(pdf, {
    type: "message",
    outcome: "unavailable",
    message: BROWSER_ONLY_MESSAGE,
  });
  const other = await openAttachment(file("x.bin", "application/octet-stream"), d);
  assert.deepEqual(other, {
    type: "message",
    outcome: "unavailable",
    message: BROWSER_ONLY_MESSAGE,
  });
  const heic = await openAttachment(file("p.heic", "image/heic"), d);
  assert.equal(heic.type === "message" && heic.outcome, "unavailable");
  assert.deepEqual(calls.reads, []);
  assert.equal(calls.external.length, 3);
});

test("openExternally outcomes pass straight through, so 2c-2 can plug in", async () => {
  for (const outcome of ["opened", "no-app", "refused", "unavailable"] as const) {
    const d: OpenDeps = {
      async getBlob() {
        throw new Error("must not read");
      },
      async openExternally() {
        return { outcome, message: `m-${outcome}` };
      },
    };
    assert.deepEqual(await openAttachment(file("r.pdf", "application/pdf"), d), {
      type: "message",
      outcome,
      message: `m-${outcome}`,
    });
  }
});

test("Not restored files are never read and show the shared message", async () => {
  const { d, calls } = deps();
  for (const [name, mime] of [
    ["a.jpg", "image/jpeg"],
    ["n.txt", "text/plain"],
    ["r.pdf", "application/pdf"],
  ]) {
    const result = await openAttachment(
      file(name, mime, { notRestored: { sha256: "a".repeat(64), addedAt: "2026-01-01" } }),
      d,
    );
    assert.deepEqual(result, {
      type: "message",
      outcome: "not-restored",
      message: NOT_RESTORED_MESSAGE,
    });
  }
  assert.deepEqual(calls.reads, []);
  assert.deepEqual(calls.external, []);
});

test("a file missing on the device, or a failing read, gives a clear message", async () => {
  const { d } = deps({ "id-bad.jpg": new Error("disk") });
  assert.deepEqual(await openAttachment(file("gone.txt", "text/plain"), d), {
    type: "message",
    outcome: "missing",
    message: MISSING_FILE_MESSAGE,
  });
  assert.deepEqual(await openAttachment(file("bad.jpg", "image/jpeg"), d), {
    type: "message",
    outcome: "failed",
    message: OPEN_FAILED_MESSAGE,
  });
});

test("text viewer: small, empty, cut at the cap, and invalid UTF-8", async () => {
  assert.deepEqual(await readTextPreview(new Blob(["hello\nworld"])), {
    text: "hello\nworld",
    truncated: false,
    empty: false,
  });
  const empty = await readTextPreview(new Blob([]));
  assert.deepEqual([empty.text, empty.empty, empty.truncated], ["", true, false]);

  const big = new Blob(["a".repeat(TEXT_PREVIEW_BYTES + 5000)]);
  const cut = await readTextPreview(big);
  assert.equal(cut.truncated, true);
  assert.equal(cut.text.length, TEXT_PREVIEW_BYTES);

  const exact = await readTextPreview(new Blob(["a".repeat(TEXT_PREVIEW_BYTES)]));
  assert.equal(exact.truncated, false);

  // A 3-byte character split by the cap is dropped, not turned into garbage.
  const split = await readTextPreview(new Blob(["abcé€"]), 6);
  assert.equal(split.text, "abcé");
  assert.equal(split.truncated, true);

  const bad = await readTextPreview(new Blob([new Uint8Array([0x68, 0xff, 0xfe, 0x69, 0xc3])]));
  assert.equal(bad.text, "h\ufffd\ufffdi\ufffd");
  assert.equal(bad.empty, false);
  assert.ok(EMPTY_TEXT_MESSAGE.length > 0);
});

test("openAttachment returns a text preview through the same path", async () => {
  const { d } = deps({ "id-n.txt": new Blob(["<b>not html</b> https://example.com"]) });
  const result = await openAttachment(file("n.txt", "text/plain"), d);
  assert.equal(result.type, "text");
  if (result.type === "text")
    assert.equal(result.preview.text, "<b>not html</b> https://example.com");
});

test("accessible name: type and size, plus Not restored", () => {
  assert.equal(
    attachmentOpenLabel(file("report.pdf", "application/pdf", { size: 2_400_000 })),
    "Open report.pdf, PDF, 2.3 MB",
  );
  assert.equal(
    attachmentOpenLabel(
      file("a.jpg", "image/jpeg", { notRestored: { sha256: "a".repeat(64), addedAt: "x" } }),
    ),
    "Open a.jpg, not restored, Image, 2 KB",
  );
});

test("opening never changes notesModifiedAt or addedAt", async () => {
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: { getItem: () => null, setItem: () => undefined, removeItem: () => undefined },
  });
  try {
    const f = file("n.txt", "text/plain", { addedAt: "2026-02-01T10:00:00.000Z" });
    const p: Patient = {
      id: "p",
      name: "Okoye, Ada",
      dob: "",
      gender: "",
      phone: "",
      email: "",
      notes: "x",
      notesModifiedAt: "2026-10-26T09:00:00.000Z",
      surgeries: [
        {
          id: "s",
          date: "2026-01-01",
          surgeon: "",
          type: "Knee",
          hospital: "",
          notes: "",
          attachments: [f],
        },
      ],
      consults: [],
    };
    useCasebook.setState({ patients: [p] });
    const before = JSON.stringify(useCasebook.getState().patients);
    const { d } = deps({ "id-n.txt": new Blob(["hi"]) });
    await openAttachment(f, d);
    await openAttachment(file("r.pdf", "application/pdf"), d);
    assert.equal(JSON.stringify(useCasebook.getState().patients), before);
  } finally {
    Reflect.deleteProperty(globalThis, "localStorage");
  }
});

test("General notes, procedure and consult audio rows share one opener and fallback", () => {
  const detail = readFileSync(
    new URL("../../components/casebook/detail.tsx", import.meta.url),
    "utf8",
  );
  const row = readFileSync(
    new URL("../../components/casebook/attachment-row.tsx", import.meta.url),
    "utf8",
  );
  const notes = /function GeneralNotes[\s\S]*?\n}\n/.exec(detail)?.[0] ?? "";
  const list = /function FileList[\s\S]*?\n}\n/.exec(detail)?.[0] ?? "";
  assert.match(notes, /<AttachmentRow/);
  assert.match(list, /<AttachmentRow/);
  const lists = detail.match(/<FileList/g) ?? [];
  assert.equal(lists.length, 2); // one for consults, one for procedures
  assert.equal(detail.includes("getBlob"), false);
  assert.equal(detail.includes("createObjectURL"), false);
  assert.match(row, /openAttachment\(file\)/);
  assert.match(row, /AUDIO_UNPLAYABLE_MESSAGE/);
  assert.match(row, /openExternally\(file\)/);
  assert.match(row, /canPlayAudioInWebView/);
  assert.match(row, /onError=\{\(\) =>/);
  assert.match(row, /URL\.revokeObjectURL\(url\)/);
  assert.equal(/innerHTML|dangerouslySetInnerHTML|console\./.test(row), false);
  assert.equal((detail.match(/function AttachmentRow/g) ?? []).length, 0);
  const styles = readFileSync(new URL("../../styles.css", import.meta.url), "utf8");
  assert.match(styles, /\.file-audio\s*\{[^}]*min-height:\s*3rem/s);
});
