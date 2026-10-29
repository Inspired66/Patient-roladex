import {
  csvToDrafts,
  decryptArchive,
  encryptArchive,
  patientsToCsv,
  type ArchiveFileStore,
} from "./archive.ts";
import { migrateStoredCasebook } from "./store.ts";

function attachmentCount(patients: ReturnType<typeof migrateStoredCasebook>["patients"]) {
  return patients.reduce(
    (total, patient) =>
      total +
      patient.surgeries.reduce((sum, surgery) => sum + surgery.attachments.length, 0) +
      patient.consults.reduce((sum, consult) => sum + consult.attachments.length, 0),
    0,
  );
}

export async function createVerifiedMigrationArchive(
  rawCasebook: string,
  password: string,
  fileStore?: ArchiveFileStore,
) {
  const source = migrateStoredCasebook(rawCasebook);
  const csv = await patientsToCsv(source.patients, source.contacts, fileStore);
  const encrypted = await encryptArchive(csv, password);
  const decrypted = await decryptArchive(await encrypted.arrayBuffer(), password);
  if (decrypted !== csv) {
    throw new Error("The encrypted backup could not be verified. The original casebook is unchanged.");
  }
  const restored = csvToDrafts(decrypted);
  if (
    restored.drafts.length !== source.patients.length ||
    restored.contacts.length !== source.contacts.length ||
    restored.drafts.reduce(
      (sum, patient) =>
        sum +
        patient.surgeries.reduce((subtotal, surgery) => subtotal + surgery.files.length, 0) +
        patient.consults.reduce((subtotal, consult) => subtotal + consult.files.length, 0),
      0,
    ) !== attachmentCount(source.patients)
  ) {
    throw new Error("The encrypted backup is incomplete. The original casebook is unchanged.");
  }
  return encrypted;
}
