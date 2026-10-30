import { useEffect, useMemo, useRef, useState } from "react";
import { Confirm } from "@/components/casebook/forms";
import { PASSWORD_INPUT_PROPS, PasswordNote } from "@/components/casebook/password-input";
import {
  csvToDrafts,
  decryptArchive,
  encryptArchive,
  patientsToCsv,
  restoreDrafts,
  saveBlob,
  type DraftPatient,
} from "@/lib/casebook/archive";
import { createVerifiedMigrationArchive } from "@/lib/casebook/migration";
import { getBlob } from "@/lib/casebook/files";
import { todayISO } from "@/lib/casebook/format";
import { callNative, hasNativeMessageBridge } from "@/lib/casebook/native-bridge";
import { bootstrapCasebook, CASEBOOK_STORAGE_KEY, migrateStoredCasebook, useCasebook } from "@/lib/casebook/store";
import type { Contact } from "@/lib/casebook/types";

type MigrationStatus = {
  legacyOrigins: Array<{ port: number }>;
  archives: Array<{ port: number; bytes: number }>;
};

type RestoredCasebook = {
  drafts: DraftPatient[];
  contacts: Contact[];
};

function encodeBase64(bytes: Uint8Array) {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

function decodeBase64(value: string) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function attachmentList(patients: ReturnType<typeof migrateStoredCasebook>["patients"]) {
  return patients.flatMap((patient) => [
    ...patient.surgeries.flatMap((surgery) => surgery.attachments),
    ...patient.consults.flatMap((consult) => consult.attachments),
  ]);
}

async function readNativeArchive(port: number) {
  const info = await callNative<{ bytes: number }>("migrationArchiveInfo", { port });
  if (!info || !Number.isSafeInteger(info.bytes) || info.bytes < 43 || info.bytes > 512 * 1024 * 1024) {
    throw new Error("The encrypted migration archive is unavailable or exceeds the supported size.");
  }
  const bytes = new Uint8Array(info.bytes);
  const chunkSize = 48 * 1024;
  for (let offset = 0; offset < info.bytes; offset += chunkSize) {
    const chunk = await callNative<{ data: string; offset: number }>("readMigrationChunk", {
      port,
      offset,
    });
    if (!chunk || chunk.offset !== offset) throw new Error("The migration archive could not be read.");
    const decoded = decodeBase64(chunk.data);
    bytes.set(decoded, offset);
  }
  return bytes.buffer;
}

export function MigrationNotice() {
  const [status, setStatus] = useState<MigrationStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("migration") === "source") return;
    if (!hasNativeMessageBridge()) return;
    void callNative<MigrationStatus>("migrationStatus")
      .then((next) => setStatus(next))
      .catch(() => setError("Older casebook storage could not be checked."));
  }, []);

  const origins = status?.legacyOrigins ?? [];
  const archives = status?.archives ?? [];
  if (!hasNativeMessageBridge() || (!origins.length && !archives.length && !error)) return null;

  async function openLegacy(port: number) {
    setBusy(true);
    setError("");
    try {
      const result = await callNative<{ started: string }>("beginLegacyMigration", { port });
      if (!result) throw new Error("The older casebook could not be opened.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The older casebook could not be opened.");
      setBusy(false);
    }
  }

  async function exportBackup(port: number, index: number) {
    setBusy(true);
    setError("");
    try {
      const buffer = await readNativeArchive(port);
      await saveBlob(
        new Blob([buffer], { type: "application/octet-stream" }),
        `vellum-migration-${index + 1}-${todayISO()}.vellum`,
        "application/octet-stream",
      );
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The encrypted backup could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  function resumeRestore(port: number) {
    window.location.assign(`/?migration=restore&port=${port}`);
  }

  return (
    <section className="stack" aria-label="Casebook migration">
      <p className="eyebrow">Storage migration</p>
      <p className="slip-who">
        Older casebooks remain untouched. Each is backed up and verified separately before it can
        be restored here.
      </p>
      {origins.map((origin, index) => (
        <button
          key={origin.port}
          type="button"
          className="btn-ghost"
          disabled={busy}
          onClick={() => void openLegacy(origin.port)}
        >
          {busy ? "Opening older casebook…" : `Prepare older casebook ${index + 1}`}
        </button>
      ))}
      {archives.map((archive, index) => (
        <div className="stack" key={archive.port}>
          <button
            type="button"
            className="btn-ghost"
            disabled={busy}
            onClick={() => resumeRestore(archive.port)}
          >
            Continue verified backup {index + 1}
          </button>
          <button
            type="button"
            className="btn-ghost"
            disabled={busy}
            onClick={() => void exportBackup(archive.port, index)}
          >
            Save encrypted backup {index + 1}
          </button>
        </div>
      ))}
      {error ? <p className="form-error" role="alert">{error}</p> : null}
    </section>
  );
}

export function MigrationPage({ mode, port }: { mode: "source" | "restore"; port: number }) {
  const replaceCasebook = useCasebook((state) => state.replaceCasebook);
  const currentPatients = useCasebook((state) => state.patients);
  const currentContacts = useCasebook((state) => state.contacts);
  const hydrated = useCasebook((state) => state.hydrated);
  const storageError = useCasebook((state) => state.storageError);
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [restored, setRestored] = useState<RestoredCasebook | null>(null);
  const [confirmRestore, setConfirmRestore] = useState(false);
  const [targetBackupSaved, setTargetBackupSaved] = useState(false);
  const restorePassword = useRef("");
  const realCurrentCount = useMemo(
    () =>
      currentPatients.filter((patient) => !patient.sample).length +
      currentContacts.filter((contact) => !contact.sample).length,
    [currentPatients, currentContacts],
  );

  useEffect(() => {
    if (mode === "restore") bootstrapCasebook();
  }, [mode]);

  async function prepareBackup(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    setMessage("");
    if (password.length < 8 || password !== repeat) {
      setError(password.length < 8 ? "Use a password with at least 8 characters." : "Passwords do not match.");
      return;
    }
    setBusy(true);
    try {
      const raw = localStorage.getItem(CASEBOOK_STORAGE_KEY);
      if (!raw) throw new Error("No saved casebook was found at this origin.");
      const archive = await createVerifiedMigrationArchive(raw, password);
      const bytes = new Uint8Array(await archive.arrayBuffer());
      const started = await callNative<{ started: string }>("beginMigrationArchive", {
        port,
        bytes: bytes.length,
      });
      if (!started) throw new Error("Private encrypted-backup storage is unavailable.");
      const step = 48 * 1024;
      for (let offset = 0; offset < bytes.length; offset += step) {
        const chunk = await callNative<{ written: boolean }>("writeMigrationChunk", {
          port,
          data: encodeBase64(bytes.subarray(offset, offset + step)),
        });
        if (!chunk?.written) throw new Error("The encrypted backup transfer did not complete.");
      }
      const verified = await callNative<{ verified: string }>("finishMigrationArchive", { port });
      if (!verified) throw new Error("The encrypted backup could not be finalized.");
      setPassword("");
      setRepeat("");
      setMessage("Encrypted backup verified. Opening the new casebook to restore it.");
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "The encrypted backup could not be created. The original casebook is unchanged.",
      );
      setBusy(false);
    }
  }

  async function unlockBackup(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    setMessage("");
    setBusy(true);
    try {
      const archive = await readNativeArchive(port);
      const csv = await decryptArchive(archive, password);
      const parsed = csvToDrafts(csv);
      setRestored(parsed);
      restorePassword.current = password;
      setPassword("");
      setMessage(
        `Verified ${parsed.drafts.length} patient record${parsed.drafts.length === 1 ? "" : "s"}, ` +
          `${parsed.contacts.length} contacts, and ${parsed.drafts.reduce(
            (sum, patient) =>
              sum +
              patient.surgeries.reduce((subtotal, surgery) => subtotal + surgery.files.length, 0) +
              patient.consults.reduce((subtotal, consult) => subtotal + consult.files.length, 0),
            0,
          )} attachments.`,
      );
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The encrypted backup could not be opened.");
    } finally {
      setBusy(false);
    }
  }

  async function saveCurrentBackup() {
    setBusy(true);
    setError("");
    try {
      const csv = await patientsToCsv(currentPatients, currentContacts);
      const encrypted = await encryptArchive(csv, restorePassword.current);
      if (await decryptArchive(await encrypted.arrayBuffer(), restorePassword.current) !== csv) {
        throw new Error("The current casebook backup could not be verified.");
      }
      await saveBlob(
        encrypted,
        `vellum-before-migration-${todayISO()}.vellum`,
        "application/octet-stream",
      );
      setTargetBackupSaved(true);
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "The current casebook backup could not be saved.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function restoreBackup() {
    if (!restored) return;
    if (realCurrentCount > 0 && !targetBackupSaved) {
      setError("Save and verify a separate encrypted backup of the current casebook first.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await restoreDrafts(restored.drafts, (patients) =>
        replaceCasebook(patients, restored.contacts),
      );
      const serialized = localStorage.getItem(CASEBOOK_STORAGE_KEY);
      if (!serialized) throw new Error("The restored casebook was not saved.");
      const persisted = migrateStoredCasebook(serialized);
      const expectedFiles = attachmentList(persisted.patients);
      const blobs = await Promise.all(expectedFiles.map((attachment) => getBlob(attachment.id)));
      if (
        persisted.patients.length !== restored.drafts.length ||
        persisted.contacts.length !== restored.contacts.length ||
        blobs.some((blob, index) => !blob || blob.size !== expectedFiles[index]?.size)
      ) {
        throw new Error("Restore verification failed. Keep the encrypted backup and try again.");
      }
      const completed = await callNative<{ ok: boolean }>("completeMigration", { port });
      if (!completed) throw new Error("The restored casebook could not be marked complete.");
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "The casebook could not be restored. The encrypted backup is still available.",
      );
      setBusy(false);
    }
  }

  async function cancelSource() {
    setBusy(true);
    try {
      await callNative("cancelMigration");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The older casebook remains open.");
      setBusy(false);
    }
  }

  if (!hasNativeMessageBridge()) {
    return (
      <main className="app-frame">
        <section className="form-error" role="alert">
          <h1>Migration is unavailable</h1>
          <p>This transfer can only be completed inside the Vellum Android app.</p>
        </section>
      </main>
    );
  }

  return (
    <main className="app-frame">
      <p className="eyebrow">Storage migration</p>
      <h1 className="wordmark">Vellum</h1>
      {mode === "source" ? (
        <>
          <p className="slip-who">
            Create a password-protected backup of this entire casebook, including attachments.
            The old copy stays unchanged until you verify the restore.
          </p>
          <form className="stack" onSubmit={(event) => void prepareBackup(event)}>
            <label className="field-block">
              <span className="lbl">Backup password</span>
              <input
                className="field"
                type="password"
                autoComplete="new-password"
                {...PASSWORD_INPUT_PROPS}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                disabled={busy}
              />
            </label>
            <label className="field-block">
              <span className="lbl">Repeat password</span>
              <input
                className="field"
                type="password"
                autoComplete="new-password"
                {...PASSWORD_INPUT_PROPS}
                value={repeat}
                onChange={(event) => setRepeat(event.target.value)}
                disabled={busy}
              />
            </label>
            <PasswordNote />
            <button type="submit" className="btn-ink" disabled={busy}>
              {busy ? "Verifying encrypted backup…" : "Create verified backup"}
            </button>
            <button type="button" className="btn-ghost" disabled={busy} onClick={() => void cancelSource()}>
              Cancel and keep this copy
            </button>
          </form>
        </>
      ) : (
        <>
          <p className="slip-who">
            Unlock the encrypted backup. It is verified before the casebook is restored. Your
            original older-origin data and this encrypted backup are retained.
          </p>
          {!restored ? (
            <form className="stack" onSubmit={(event) => void unlockBackup(event)}>
              <label className="field-block">
                <span className="lbl">Backup password</span>
                <input
                  className="field"
                  type="password"
                  autoComplete="current-password"
                  {...PASSWORD_INPUT_PROPS}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  disabled={busy}
                />
              </label>
              <PasswordNote />
              <button type="submit" className="btn-ink" disabled={busy || !password}>
                {busy ? "Verifying backup…" : "Verify encrypted backup"}
              </button>
            </form>
          ) : (
            <div className="stack">
              <button
                type="button"
                className="btn-ink"
                disabled={
                  busy ||
                  !hydrated ||
                  Boolean(storageError) ||
                  (realCurrentCount > 0 && !targetBackupSaved)
                }
                onClick={() => setConfirmRestore(true)}
              >
                Restore verified casebook
              </button>
              {storageError ? (
                <p className="form-error" role="alert">
                  Existing storage could not be read safely and has not been changed. Update Vellum
                  before restoring into this origin.
                </p>
              ) : null}
              {realCurrentCount > 0 ? (
                <>
                  <p className="slip-who">
                    This casebook already contains saved records. Save an encrypted backup of it
                    before replacing it with the selected older casebook.
                  </p>
                  <button
                    type="button"
                    className="btn-ghost"
                    disabled={busy || targetBackupSaved || Boolean(storageError)}
                    onClick={() => void saveCurrentBackup()}
                  >
                    {targetBackupSaved ? "Current casebook backup verified" : "Save current encrypted backup"}
                  </button>
                </>
              ) : null}
            </div>
          )}
          <button
            type="button"
            className="btn-ghost"
            disabled={busy}
            onClick={() => window.location.assign("/")}
          >
            Keep this backup for later
          </button>
        </>
      )}
      {message ? <p className="slip-who" role="status">{message}</p> : null}
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      {confirmRestore ? (
        <Confirm
          title="Restore this casebook?"
          body={
            realCurrentCount > 0
              ? "This replaces the current casebook with the verified older casebook. You saved a separate encrypted backup of the current data. The older origin and both encrypted backups will be retained."
              : "This places the verified records and attachments into the new secure storage origin. The older copy and encrypted backup will be retained."
          }
          confirmLabel="Restore verified backup"
          onConfirm={() => {
            setConfirmRestore(false);
            void restoreBackup();
          }}
          onCancel={() => setConfirmRestore(false)}
        />
      ) : null}
    </main>
  );
}
