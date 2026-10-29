import { useRef, useState } from "react";
import { DataBackupSheet } from "@/components/casebook/data-backup-sheet";
import { Confirm, Sheet } from "@/components/casebook/forms";
import { encryptArchive, patientsToCsv, saveBlob } from "@/lib/casebook/archive";
import {
  classifyBackupFile,
  commitBackup,
  openEncryptedBackup,
  resultText,
  summarizeBackup,
  summaryText,
  type OpenedBackup,
} from "@/lib/casebook/restore-flow";
import { todayISO } from "@/lib/casebook/format";
import { useCasebook } from "@/lib/casebook/store";
import type { Patient } from "@/lib/casebook/types";

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
  const devicePatients = useCasebook((state) => state.patients.length);
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
  const [restore, setRestore] = useState<OpenedBackup | null>(null);
  const [restoreResult, setRestoreResult] = useState("");
  const [showUnlock, setShowUnlock] = useState(false);
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
    setRestoreResult("");
    try {
      const picked = classifyBackupFile(await file.arrayBuffer());
      if (picked.needsPassword) {
        setLocked(picked.buffer);
        setUnlockPassword("");
        return;
      }
      setRestore(picked.opened);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not read that file.");
    }
  }

  async function unlock(event: React.FormEvent) {
    event.preventDefault();
    if (!locked || busy) return;
    setBusy(true);
    setError("");
    try {
      setRestore(await openEncryptedBackup(locked, unlockPassword));
      setLocked(null);
      setUnlockPassword("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not open that file.");
    } finally {
      setBusy(false);
    }
  }

  async function confirmRestore() {
    if (!restore || busy) return;
    setBusy(true);
    setError("");
    try {
      const summary = summarizeBackup(restore, devicePatients);
      await commitBackup(restore, replaceCasebook);
      setRestore(null);
      setRestoreResult(resultText(summary));
    } catch (reason) {
      setRestore(null);
      setError(
        reason instanceof Error
          ? `${reason.message} Nothing on this device was changed.`
          : "Could not restore that file. Nothing on this device was changed.",
      );
    } finally {
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
        <div className="section-head">
          <h3>Restore from backup</h3>
        </div>
        <p className="slip-who">
          Open a backup file made by Vellum. Restoring replaces everything on this device.
        </p>
        <button
          type="button"
          className="btn-ink"
          disabled={busy}
          onClick={() => fileRef.current?.click()}
        >
          Restore from backup
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
                type={showUnlock ? "text" : "password"}
                autoComplete="current-password"
                value={unlockPassword}
                onChange={(event) => setUnlockPassword(event.target.value)}
                autoFocus
              />
            </label>
            <button
              type="button"
              className="btn-text"
              aria-pressed={showUnlock}
              onClick={() => setShowUnlock((value) => !value)}
            >
              {showUnlock ? "Hide password" : "Show password"}
            </button>
            <button
              type="submit"
              className="btn-ink"
              disabled={busy || unlockPassword.length === 0}
            >
              {busy ? "Opening…" : "Open backup"}
            </button>
            <button
              type="button"
              className="btn-text"
              onClick={() => {
                setLocked(null);
                setUnlockPassword("");
                setError("");
              }}
            >
              Cancel
            </button>
          </form>
        ) : null}
        {busy && !locked ? (
          <p className="saving-row" role="status">
            <span className="save-spin" aria-hidden />
            Working
          </p>
        ) : null}
        {error ? (
          <p className="form-error" role="alert">
            {error}
          </p>
        ) : null}
        {restoreResult ? (
          <p className="slip-who" role="status">
            {restoreResult}
          </p>
        ) : null}

        <div className="section-head">
          <h3>Advanced</h3>
        </div>
        <p className="slip-who">
          These older exports include attachments, are slower, and can fail on large casebooks. The
          CSV is not encrypted. An encrypted file opens only with its password, and that password
          cannot be recovered. The surgeon and hospital directory is included. Choose where to save
          it on this phone.
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
        {saved && !busy ? <p className="slip-who">{saved}</p> : null}
        <button
          type="button"
          className="btn-ghost"
          disabled={busy || chosen.length === 0}
          onClick={() => setWarnPlain(true)}
        >
          Download CSV (not encrypted)
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
            Download encrypted file (with attachments)
          </button>
        </form>
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
          title="Replace everything on this device?"
          body={summaryText(summarizeBackup(restore, devicePatients))}
          confirmLabel={busy ? "Restoring…" : "Replace everything"}
          onConfirm={() => void confirmRestore()}
          onCancel={() => {
            if (!busy) setRestore(null);
          }}
        />
      ) : null}
    </Sheet>
  );
}
