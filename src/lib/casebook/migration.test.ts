import assert from "node:assert/strict";
import test from "node:test";
import { decryptArchive, type ArchiveFileStore } from "./archive.ts";
import { createVerifiedMigrationArchive } from "./migration.ts";
import { CASEBOOK_STORAGE_KEY } from "./store.ts";

test("migration backup encrypts and verifies casebook data and attachments", async () => {
  const storage = {
    version: 1,
    state: {
      patients: [
        {
          id: "legacy-patient",
          name: "Legacy Patient",
          dob: "1980-01-02",
          gender: "Other",
          phone: "555-0100",
          email: "legacy@example.test",
          notes: "Private notes",
          sample: false,
          attachments: [{ id: "legacy-file", name: "scan.pdf", mime: "application/pdf", size: 4 }],
          surgeries: [],
          consults: [],
        },
      ],
      contacts: [
        {
          id: "legacy-contact",
          kind: "surgeon",
          name: "Dr Example",
          phone: "",
          email: "",
          specialty: "Surgery",
          notes: "",
          sample: false,
        },
      ],
    },
  };
  const fileStore: ArchiveFileStore = {
    async getBlob(id) {
      return id === "legacy-file" ? new Blob(["PDF!"], { type: "application/pdf" }) : undefined;
    },
    async putBlob() {},
    async deleteBlob() {},
  };

  const encrypted = await createVerifiedMigrationArchive(
    JSON.stringify(storage),
    "migration-password",
    fileStore,
  );
  const encryptedBytes = await encrypted.arrayBuffer();
  assert.equal(new TextDecoder().decode(encryptedBytes).includes("Legacy Patient"), false);
  const csv = await decryptArchive(encryptedBytes, "migration-password");
  assert.match(csv, /Legacy/);
  assert.match(csv, /Patient/);
  assert.match(csv, /UERGIQ==/);
  assert.equal(CASEBOOK_STORAGE_KEY, "vellum-casebook-v1");
});

test("migration backup fails closed when any legacy attachment is missing", async () => {
  const storage = {
    version: 1,
    state: {
      patients: [
        {
          id: "legacy-patient",
          name: "Legacy Patient",
          surgeries: [],
          attachments: [{ id: "missing", name: "scan.pdf", mime: "application/pdf", size: 4 }],
        },
      ],
    },
  };
  const fileStore: ArchiveFileStore = {
    async getBlob() {
      return undefined;
    },
    async putBlob() {},
    async deleteBlob() {},
  };

  await assert.rejects(
    createVerifiedMigrationArchive(JSON.stringify(storage), "migration-password", fileStore),
    /missing from local storage/,
  );
});
