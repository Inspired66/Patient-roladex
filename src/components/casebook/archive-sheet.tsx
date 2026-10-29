import { useRef, useState } from "react";
import { DataBackupSheet } from "@/components/casebook/data-backup-sheet";
import { Confirm, Sheet } from "@/components/casebook/forms";
import {
  csvToDrafts,
  encryptArchive,
  isDataArchive,
  isEncryptedArchive,
  patientsToCsv,
  readEncryptedArchive,
  restoreDrafts,
  saveBlob,
  type AttachmentIndexEntry,
  type DraftPatient,
} from "@/lib/casebook/archive";
import { todayISO } from "@/lib/casebook/format";
import { useCasebook } from "@/lib/casebook/store";
import type { Contact, Patient } from "@/lib/casebook/types";

export function ArchiveSheet({
  everyone,
  listed,
  onClose,
}: {
  everyone: Patient[];
  listed: Patient[];
  onClose: () => void;
}) {
  const replaceCasebook = useCasebook((state) => state.replaceCasebook);
  const contacts = useCasebook((state) => state.contacts);
  const [scope, setScope] = useState<"list" | "all">(listed.length > 0 ? "list" : "all");
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState("");
  const [warnPlain, setWarnPlain] = useState(false);
  const [dataBackup, setDataBackup] = useState(false);
  const [locked, setLocked] = useState<ArrayBuffer | null>(null);
  const [unlockPassword, setUnlockPassword] = useState("");
  const [restore, setRestore] = useState<{
    drafts: DraftPatient[];
    contacts: Contact[];
    index: AttachmentIndexEntry[];
  } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const chosen = scope === "list" ? listed : everyone;

  async function savePlain() {
    setWarnPlain(false);
    setBusy(true);
    setError("");
    setSaved("");
    try {
      const csv = await patientsToCsv(chosen, contacts);
      await saveBlob(
        new Blob([csv], { type: "text/csv;charset=utf-8" }),
        `vellum-${scope}-${todayISO()}.csv`,
        "text/csv",
      );
      setSaved("Saved where you chose.");
    } catch (reason) {
      if (reason instanceof Error && reason.name === "AbortError") return;
      setError(reason instanceof Error ? reason.message : "Could not build that file.");
    } finally {
      setBusy(false);
    }
  }

  async function saveEncrypted(event: React.FormEvent) {
    event.preventDefault();
    if (password.length < 8) {
      setError("Use at least 8 characters.");
      return;
    }
    if (password !== repeat) {
      setError("Passwords do not match.");
      return;
    }
    setBusy(true);
    setError("");
    setSaved("");
    try {
      const csv = await patientsToCsv(chosen, contacts);
      const blob = await encryptArchive(csv, password);
      await saveBlob(blob, `vellum-${scope}-${todayISO()}.vellum`, "application/octet-stream");
      setPassword("");
      setRepeat("");
      setSaved("Saved where you chose.");
    } catch (reason) {
      if (reason instanceof Error && reason.name === "AbortError") return;
      setError(reason instanceof Error ? reason.message : "Could not encrypt that file.");
    } finally {
      setBusy(false);
    }
  }

  async function onPick(file: File | null) {
    if (!file) return;
    setError("");
    setLocked(null);
    setRestore(null);
    try {
      const buffer = await file.arrayBuffer();
      if (isEncryptedArchive(buffer) || isDataArchive(buffer)) {
        setLocked(buffer);
        setUnlockPassword("");
        return;
      }
      setRestore({ ...csvToDrafts(new TextDecoder().decode(buffer)), index: [] });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not read that file.");
    }
  }

  async function unlock(event: React.FormEvent) {
    event.preventDefault();
    if (!locked) return;
    setBusy(true);
    setError("");
    try {
      const opened = await readEncryptedArchive(locked, unlockPassword);
      setRestore({ ...csvToDrafts(opened.csv), index: opened.attachments });
      setLocked(null);
      setUnlockPassword("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not open that file.");
    } finally {
      setBusy(false);
    }
  }

  async function confirmRestore() {
    if (!restore) return;
    setBusy(true);
    setError("");
    try {
      await restoreDrafts(
        restore.drafts,
        (patients) => replaceCasebook(patients, restore.contacts),
        undefined,
        restore.index,
      );
      setRestore(null);
      onClose();
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Could not restore that file onto this device.",
      );
      setBusy(false);
    }
  }

  if (dataBackup) return <DataBackupSheet onClose={onClose} />;

  return (
    <Sheet title="Archive" onClose={onClose}>
      <div className="stack">
        <button type="button" className="btn-ink" onClick={() => setDataBackup(true)}>
          Back up data
        </button>
        <p className="slip-who">
          Choose where to save it on this phone. A CSV can be opened by anyone. An encrypted file
          opens only with the password, and that password cannot be recovered. The surgeon and
          hospital directory is included.
        </p>
        <div className="scope-row" role="group" aria-label="What to download">
          <button
            type="button"
            className={scope === "list" ? "btn-ghost is-on" : "btn-ghost"}
            aria-pressed={scope === "list"}
            onClick={() => setScope("list")}
          >
            This list ({listed.length})
          </button>
          <button
            type="button"
            className={scope === "all" ? "btn-ghost is-on" : "btn-ghost"}
            aria-pressed={scope === "all"}
            onClick={() => setScope("all")}
          >
            Everyone ({everyone.length})
          </button>
        </div>
        {busy ? (
          <p className="saving-row" role="status">
            <span className="save-spin" aria-hidden />
            Saving
          </p>
        ) : null}
        {saved && !busy ? <p className="slip-who">{saved}</p> : null}
        <button
          type="button"
          className="btn-ink"
          disabled={busy || chosen.length === 0}
          onClick={() => setWarnPlain(true)}
        >
          Download CSV
        </button>
        <form className="stack" onSubmit={(event) => void saveEncrypted(event)}>
          <label className="field-block">
            <span className="lbl">Password</span>
            <input
              className="field"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          <label className="field-block">
            <span className="lbl">Repeat password</span>
            <input
              className="field"
              type="password"
              autoComplete="new-password"
              value={repeat}
              onChange={(event) => setRepeat(event.target.value)}
            />
          </label>
          <button type="submit" className="btn-ghost" disabled={busy || chosen.length === 0}>
            Download encrypted file
          </button>
        </form>
        <div className="section-head">
          <h3>Restore</h3>
        </div>
        <button type="button" className="btn-ghost" onClick={() => fileRef.current?.click()}>
          Open a CSV or encrypted file
        </button>
        <input
          ref={fileRef}
          className="sr-only"
          type="file"
          accept=".csv,.vellum,text/csv,application/octet-stream"
          onChange={(event) => {
            void onPick(event.target.files?.[0] ?? null);
            event.target.value = "";
          }}
        />
        {locked ? (
          <form className="stack" onSubmit={(event) => void unlock(event)}>
            <label className="field-block">
              <span className="lbl">Password for this file</span>
              <input
                className="field"
                type="password"
                autoComplete="current-password"
                value={unlockPassword}
                onChange={(event) => setUnlockPassword(event.target.value)}
                autoFocus
              />
            </label>
            <button
              type="submit"
              className="btn-ink"
              disabled={busy || unlockPassword.length === 0}
            >
              Open encrypted file
            </button>
          </form>
        ) : null}
        {error ? <p className="form-error">{error}</p> : null}
      </div>
      {warnPlain ? (
        <Confirm
          title="This file is not encrypted"
          body="Anyone who can open the CSV can read names, phone numbers, notes, and attached files. It is not a hospital record."
          confirmLabel={busy ? "Preparing…" : "Download anyway"}
          onConfirm={() => void savePlain()}
          onCancel={() => setWarnPlain(false)}
        />
      ) : null}
      {restore ? (
        <Confirm
          title="Replace the casebook?"
          body={`This will replace the patients on this device with ${restore.drafts.length} ${restore.drafts.length === 1 ? "patient" : "patients"} from the file. Cards here now will be deleted.${restore.index.length ? ` ${restore.index.length} attached ${restore.index.length === 1 ? "file is" : "files are"} listed but not included in this backup, and will show as Not restored.` : ""}${restore.contacts.length ? ` The directory will be replaced with ${restore.contacts.length} contacts.` : ""}`}
          confirmLabel={busy ? "Restoring…" : "Replace casebook"}
          onConfirm={() => void confirmRestore()}
          onCancel={() => setRestore(null)}
        />
      ) : null}
    </Sheet>
  );
}
