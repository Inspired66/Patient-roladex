import assert from "node:assert/strict";
import test from "node:test";
import { decryptDataArchive, type ArchiveFileStore } from "./archive.ts";
import {
  checkBackupPassword,
  dataBackupFileName,
  LAST_DATA_BACKUP_KEY,
  readLastDataBackup,
  runDataBackup,
} from "./data-backup.ts";
import type { Patient } from "./types.ts";

const password = "correct horse battery";
const FILENAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,120}$/;

function patient(): Patient {
  return {
    id: "p-1",
    name: "Okoye, Ada",
    dob: "1990-03-04",
    gender: "Female",
    phone: "",
    email: "",
    notes: "",
    surgeries: [
      {
        id: "s-1",
        date: "2026-01-10",
        surgeon: "Dr Imaginary",
        type: "Knee",
        hospital: "Example",
        notes: "",
        attachments: [
          { id: "f-1", name: "scan.pdf", mime: "application/pdf", size: 11 },
          {
            id: "f-2",
            name: "kept.pdf",
            mime: "application/pdf",
            size: 12,
            notRestored: { sha256: "c".repeat(64), addedAt: "2026-01-11" },
          },
        ],
      },
    ],
    consults: [],
  };
}

const files: ArchiveFileStore = {
  async getBlob(id) {
    return id === "f-1" ? new Blob(["hello-world"]) : undefined;
  },
  async putBlob() {},
  async deleteBlob() {},
};

function memoryDates() {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
  };
}

test("file name is neutral: prefix and date only", () => {
  const name = dataBackupFileName("2026-10-29");
  assert.equal(name, "vellum-data-2026-10-29.vellum");
  assert.match(name, FILENAME);
  assert.throws(() => dataBackupFileName("Okoye-Ada"), /Invalid/);
});

test("password needs 8+ characters and a matching repeat", () => {
  assert.match(checkBackupPassword("short", "short"), /at least 8/);
  assert.match(checkBackupPassword("longenough", "different1"), /do not match/);
  assert.equal(checkBackupPassword("longenough", "longenough"), "");
});

test("last backup date is set only after the save succeeds", async () => {
  const storage = memoryDates();
  assert.equal(readLastDataBackup(storage as unknown as Storage), null);

  await assert.rejects(
    runDataBackup([patient()], [], password, "2026-10-29", {
      fileStore: files,
      storage,
      save: async () => {
        throw new Error("Could not write that file where you chose.");
      },
    }),
    /Could not write/,
  );
  assert.equal(storage.map.size, 0);

  const cancelled = new Error("Save cancelled.");
  cancelled.name = "AbortError";
  await assert.rejects(
    runDataBackup([patient()], [], password, "2026-10-29", {
      fileStore: files,
      storage,
      save: async () => {
        throw cancelled;
      },
    }),
    /cancelled/,
  );
  assert.equal(storage.map.size, 0);

  let saved: { name: string; mime: string; blob: Blob } | undefined;
  await runDataBackup([patient()], [], password, "2026-10-29", {
    fileStore: files,
    storage,
    save: async (blob, name, mime) => {
      saved = { blob, name, mime };
    },
  });
  assert.equal(saved?.name, "vellum-data-2026-10-29.vellum");
  assert.equal(saved?.mime, "application/octet-stream");
  assert.deepEqual([...storage.map], [[LAST_DATA_BACKUP_KEY, "2026-10-29"]]);
  assert.equal(readLastDataBackup(storage as unknown as Storage), "2026-10-29");
});

test("a corrupt stored date reads as never", () => {
  const storage = memoryDates();
  storage.map.set(LAST_DATA_BACKUP_KEY, "Okoye, Ada");
  assert.equal(readLastDataBackup(storage as unknown as Storage), null);
});

test("an empty casebook is refused before anything is built or saved", async () => {
  let saves = 0;
  await assert.rejects(
    runDataBackup([], [], password, "2026-10-29", {
      save: async () => void saves++,
    }),
    /nothing to back up/,
  );
  assert.equal(saves, 0);
});

test("verify-before-save: a backup that fails its check is not saved and the date is not set", async () => {
  const storage = memoryDates();
  let saves = 0;
  // A patient with no name is dropped by the reader, so counts differ and the check must fail.
  const unreadable = { ...patient(), name: "" };
  await assert.rejects(
    runDataBackup([unreadable], [], password, "2026-10-29", {
      fileStore: files,
      storage,
      save: async () => void saves++,
    }),
    /did not pass its check, so it was not saved/,
  );
  assert.equal(saves, 0);
  assert.equal(storage.map.size, 0);
});

test("not-restored attachments are carried through the backup unchanged", async () => {
  let blob: Blob | undefined;
  const progress: Array<[number, number]> = [];
  await runDataBackup([patient()], [], password, "2026-10-29", {
    fileStore: files,
    storage: memoryDates(),
    onProgress: (d, t) => progress.push([d, t]),
    save: async (b) => {
      blob = b;
    },
  });
  const opened = await decryptDataArchive(await blob!.arrayBuffer(), password);
  const kept = opened.attachments.find((e) => e.id === "f-2");
  assert.equal(kept?.sha256, "c".repeat(64));
  assert.equal(kept?.addedAt, "2026-01-11");
  assert.equal(opened.attachments.length, 2);
  assert.deepEqual(progress.at(-1), [2, 2]);
});

test("the backup bytes contain no patient text and the file name has none", async () => {
  let blob: Blob | undefined;
  let name = "";
  await runDataBackup([patient()], [], password, "2026-10-29", {
    fileStore: files,
    storage: memoryDates(),
    save: async (b, n) => {
      blob = b;
      name = n;
    },
  });
  const text = new TextDecoder("latin1").decode(await blob!.arrayBuffer());
  assert.ok(!text.includes("Okoye") && !text.includes("scan.pdf"));
  assert.ok(!name.includes("Okoye"));
});
