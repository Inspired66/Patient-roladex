import assert from "node:assert/strict";
import test from "node:test";
import { classifyBackupFile, commitBackup, openEncryptedBackup } from "./restore-flow.ts";
import {
  DATA_V2_MAX_ITERATIONS,
  DATA_V2_MIN_ITERATIONS,
  MAX_DATA_FILE_BYTES,
  decryptDataArchive,
  encryptDataArchive,
  isDataArchive,
  readEncryptedArchive,
} from "./archive.ts";

const OPEN_ERROR = "That password did not open the file, or the file is damaged or incomplete.";
const SETTINGS_ERROR = "The backup settings are invalid.";

async function bytesOf(blob: Blob) {
  return new Uint8Array(await blob.arrayBuffer());
}

async function makeD2(iterations?: number) {
  const blob = await encryptDataArchive([], [], "pw", undefined, undefined, undefined, [], {
    format: "d2",
    iterations,
  });
  return bytesOf(blob);
}

async function opens(bytes: Uint8Array, password = "pw") {
  return decryptDataArchive(bytes.slice().buffer, password);
}

function countDerive<T>(run: () => Promise<T>) {
  const subtle = crypto.subtle as unknown as { deriveKey: (...args: unknown[]) => unknown };
  const original = subtle.deriveKey;
  let calls = 0;
  subtle.deriveKey = function (this: unknown, ...args: unknown[]) {
    calls += 1;
    return original.apply(this, args);
  };
  return run().then(
    (value) => ({ value, calls, restore: () => (subtle.deriveKey = original) }),
    (error) => {
      subtle.deriveKey = original;
      throw Object.assign(new Error("x"), { inner: error, calls });
    },
  );
}

test("D2 round trip at 600,000 iterations with the documented header", async () => {
  const bytes = await makeD2();
  assert.equal(new TextDecoder().decode(bytes.slice(0, 8)), "VELLUMD2");
  assert.equal(new DataView(bytes.buffer).getUint32(8, false), 600_000);
  assert.equal(DATA_V2_MIN_ITERATIONS, 600_000);
  assert.ok(isDataArchive(bytes.slice().buffer));
  const opened = await opens(bytes);
  assert.deepEqual(opened.attachments, []);
  const viaReader = await readEncryptedArchive(bytes.slice().buffer, "pw");
  assert.equal(viaReader.kind, "data");
  await assert.rejects(opens(bytes, "wrong"), { message: OPEN_ERROR });
});

test("D1 stays the default and still decrypts", async () => {
  const bytes = await bytesOf(await encryptDataArchive([], [], "pw"));
  assert.equal(new TextDecoder().decode(bytes.slice(0, 8)), "VELLUMD1");
  await opens(bytes);
});

test("the Part 1 restore path imports D2 data and marks indexed attachments Not restored", async () => {
  const patient = [
    {
      id: "p-test",
      name: "Test, Pat",
      dob: "",
      gender: "",
      phone: "",
      email: "",
      notes: "",
      surgeries: [
        {
          id: "s-test",
          date: "2026-01-01",
          surgeon: "Dr Example",
          type: "Test procedure",
          hospital: "Example Hospital",
          notes: "",
          attachments: [],
        },
      ],
      consults: [],
    },
  ] as never[];
  const index = [
    {
      id: "f-test",
      patientId: "p-test",
      ownerKind: "procedure" as const,
      ownerId: "s-test",
      name: "invented.pdf",
      mime: "application/pdf",
      size: 12,
      sha256: "ab".repeat(32),
      addedAt: "2026-01-01T00:00:00.000Z",
    },
  ];
  const data = await encryptDataArchive(patient, [], "pw", undefined, undefined, undefined, index, {
    format: "d2",
  });
  const picked = classifyBackupFile(await data.arrayBuffer());
  assert.equal(picked.needsPassword, true);
  if (!picked.needsPassword) assert.fail("D2 must ask for a password");
  const opened = await openEncryptedBackup(picked.buffer, "pw");
  assert.equal(opened.kind, "data");
  assert.equal(opened.drafts.length, 1);
  assert.equal(opened.index.length, 1);

  let restored: never[] = [];
  let blobWrites = 0;
  await commitBackup(
    opened,
    (records) => {
      restored = records as never[];
    },
    {
      getBlob: async () => undefined,
      putBlob: async () => {
        blobWrites += 1;
      },
      deleteBlob: async () => {},
    },
  );
  const attachment = (restored[0] as unknown as { surgeries: { attachments: never[] }[] })
    .surgeries[0].attachments[0] as unknown as {
    id: string;
    size: number;
    notRestored: { sha256: string; addedAt: string };
  };
  assert.equal(attachment.id, "f-test");
  assert.equal(attachment.size, 12);
  assert.deepEqual(attachment.notRestored, {
    sha256: "ab".repeat(32),
    addedAt: "2026-01-01T00:00:00.000Z",
  });
  assert.equal(blobWrites, 0);
});

test("D2 refuses tampering with magic, iterations, salt, iv or ciphertext", async () => {
  const bytes = await makeD2();
  const positions = [0, 7, 8, 9, 11, 12, 27, 28, 39, 40, bytes.length - 1];
  for (const position of positions) {
    const copy = bytes.slice();
    copy[position] ^= 1;
    await assert.rejects(opens(copy), (error: Error) => {
      assert.ok(!/\d/.test(error.message));
      return true;
    });
  }
});

test("a D1 file is not read as D2 and the reverse", async () => {
  const d1 = await bytesOf(await encryptDataArchive([], [], "pw"));
  const d2 = await makeD2();
  const asD2 = d1.slice();
  asD2.set(new TextEncoder().encode("VELLUMD2"), 0);
  await assert.rejects(opens(asD2));
  const asD1 = d2.slice();
  asD1.set(new TextEncoder().encode("VELLUMD1"), 0);
  await assert.rejects(opens(asD1));
});

test("out-of-range iterations are refused before any key derivation", async () => {
  const bytes = await makeD2();
  for (const value of [599_999, 2_000_001, 0, 0xffffffff]) {
    const copy = bytes.slice();
    new DataView(copy.buffer).setUint32(8, value, false);
    const started = Date.now();
    const result = await countDerive(() => opens(copy)).then(
      () => assert.fail("should refuse"),
      (error: { inner: Error; calls: number }) => error,
    );
    assert.equal(result.calls, 0);
    assert.equal(result.inner.message, OPEN_ERROR);
    assert.ok(Date.now() - started < 500);
  }
  const edges = [DATA_V2_MIN_ITERATIONS, DATA_V2_MAX_ITERATIONS];
  assert.equal(edges.length, 2);
});

test("writing refuses iterations outside the allowed range with the fixed error", async () => {
  for (const iterations of [599_999, 2_000_001, 1.5, Number.NaN]) {
    await assert.rejects(makeD2(iterations), { message: SETTINGS_ERROR });
  }
  await assert.rejects(
    encryptDataArchive([], [], "pw", undefined, undefined, undefined, [], { iterations: 600_000 }),
    { message: SETTINGS_ERROR },
  );
});

test("the 64 MiB cap counts the whole file including the 40-byte header", async () => {
  assert.equal(MAX_DATA_FILE_BYTES, 64 * 1024 * 1024);
  const big = (bytes: number) =>
    [
      {
        id: "p-1",
        name: "Test, Pat",
        dob: "",
        gender: "",
        phone: "",
        email: "",
        notes: "x".repeat(bytes),
        surgeries: [],
        consults: [],
      },
    ] as never;
  const options = { format: "d2" as const };
  await assert.rejects(
    encryptDataArchive(
      big(MAX_DATA_FILE_BYTES),
      [],
      "pw",
      undefined,
      undefined,
      undefined,
      [],
      options,
    ),
    { message: "The backup is too large to save." },
  );
  const ok = await encryptDataArchive(
    big(1024 * 1024),
    [],
    "pw",
    undefined,
    undefined,
    undefined,
    [],
    options,
  );
  assert.ok(ok.size < MAX_DATA_FILE_BYTES);
});

test("the cap is exact: a file of exactly 64 MiB is allowed and one byte more is refused", async () => {
  const options = { format: "d2" as const };
  const make = (notes: number) =>
    encryptDataArchive(
      [
        {
          id: "p-1",
          name: "Test, Pat",
          dob: "",
          gender: "",
          phone: "",
          email: "",
          notes: "x".repeat(notes),
          surgeries: [],
          consults: [],
        },
      ] as never,
      [],
      "pw",
      undefined,
      undefined,
      undefined,
      [],
      options,
    );
  const probe = await make(1000);
  const overhead = probe.size - 1000;
  const exact = await make(MAX_DATA_FILE_BYTES - overhead);
  assert.equal(exact.size, MAX_DATA_FILE_BYTES);
  await assert.rejects(make(MAX_DATA_FILE_BYTES - overhead + 1), {
    message: "The backup is too large to save.",
  });
});

test("the restore picker treats a D2 file as a password-protected backup", async () => {
  const bytes = await makeD2();
  assert.equal(classifyBackupFile(bytes.slice().buffer).needsPassword, true);
});
