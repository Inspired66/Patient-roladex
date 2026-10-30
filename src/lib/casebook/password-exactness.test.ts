import assert from "node:assert/strict";
import test from "node:test";
import {
  decryptArchive,
  decryptDataArchive,
  encryptArchive,
  encryptDataArchive,
  type ArchiveFileStore,
} from "./archive.ts";
import type { Patient } from "./types.ts";

const files: ArchiveFileStore = {
  async getBlob() {
    return undefined;
  },
  async putBlob() {},
  async deleteBlob() {},
};

const patients: Patient[] = [
  {
    id: "p-1",
    name: "Okoye, Ada",
    dob: "1990-03-04",
    gender: "Female",
    phone: "",
    email: "",
    notes: "",
    surgeries: [],
    consults: [],
  },
];

const tricky = "Élan Ünïcode 🔐 ";
const OPEN_FAIL = /password did not open/;

test("capital, trailing space, accents and emoji round-trip in a data backup", async () => {
  const blob = await encryptDataArchive(patients, [], tricky, files);
  const opened = await decryptDataArchive(await blob.arrayBuffer(), tricky);
  assert.match(opened.csv, /Okoye/);
});

test("capital, trailing space, accents and emoji round-trip in a full archive", async () => {
  const blob = await encryptArchive("a,b\n1,2", tricky);
  assert.equal(await decryptArchive(await blob.arrayBuffer(), tricky), "a,b\n1,2");
});

test("passwords differing by case or a trailing space do not open each other's files", async () => {
  const data = await (await encryptDataArchive(patients, [], "Secret pass1", files)).arrayBuffer();
  const full = await (await encryptArchive("x", "Secret pass1")).arrayBuffer();
  for (const wrong of ["secret pass1", "Secret pass1 ", " Secret pass1", "Secret Pass1"]) {
    await assert.rejects(decryptDataArchive(data, wrong), OPEN_FAIL);
    await assert.rejects(decryptArchive(full, wrong), OPEN_FAIL);
  }
  await decryptDataArchive(data, "Secret pass1");
});
