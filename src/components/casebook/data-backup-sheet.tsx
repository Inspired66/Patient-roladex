import { useState } from "react";
import { Sheet } from "@/components/casebook/forms";
import { saveBlob } from "@/lib/casebook/archive";
import {
  checkBackupPassword,
  MIN_BACKUP_PASSWORD,
  readLastDataBackup,
  runDataBackup,
} from "@/lib/casebook/data-backup";
import { todayISO } from "@/lib/casebook/format";
import { useCasebook } from "@/lib/casebook/store";

function dateLabel(iso: string | null) {
  if (!iso) return "Never";
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function DataBackupSheet({ onClose }: { onClose: () => void }) {
  const patients = useCasebook((state) => state.patients);
  const contacts = useCasebook((state) => state.contacts);
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState("");
  const [done, setDone] = useState("");
  const [last, setLast] = useState(() => readLastDataBackup());
  const type = show ? "text" : "password";

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setError("");
    setDone("");
    if (patients.length === 0) {
      setError("There is nothing to back up yet. Add a patient first.");
      return;
    }
    const problem = checkBackupPassword(password, repeat);
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    setProgress({ done: 0, total: 0 });
    try {
      await runDataBackup(patients, contacts, password, todayISO(), {
        save: saveBlob,
        onProgress: (finished, total) => setProgress({ done: finished, total }),
      });
      setPassword("");
      setRepeat("");
      setLast(readLastDataBackup());
      setDone(
        "Backup saved. Now copy that file somewhere off this phone (cloud storage, a computer, or email it to yourself). Uninstalling Vellum erases its data, and Android's own backup is off.",
      );
    } catch (reason) {
      if (reason instanceof Error && reason.name === "AbortError") {
        setError("Not saved: you cancelled choosing where to save it.");
      } else {
        setError(reason instanceof Error ? reason.message : "The backup could not be made.");
      }
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  return (
    <Sheet title="Back up data" onClose={onClose}>
      <form className="stack" onSubmit={(event) => void submit(event)}>
        <p className="slip-who" data-testid="last-data-backup">
          Last data backup: {dateLabel(last)}
        </p>
        <p className="slip-who">
          This backup contains patient data only. It does not include attachments (photos,
          documents, recordings); an attachment backup comes separately.
        </p>
        <p className="slip-who">
          Choose a password of at least {MIN_BACKUP_PASSWORD} characters. It cannot be recovered: if
          you forget it, the backup cannot be opened.
        </p>
        <label className="field-block">
          <span className="lbl">Password</span>
          <input
            className="field"
            type={type}
            autoComplete="new-password"
            value={password}
            disabled={busy}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>
        <label className="field-block">
          <span className="lbl">Repeat password</span>
          <input
            className="field"
            type={type}
            autoComplete="new-password"
            value={repeat}
            disabled={busy}
            onChange={(event) => setRepeat(event.target.value)}
          />
        </label>
        <button
          type="button"
          className="btn-text"
          aria-pressed={show}
          onClick={() => setShow((value) => !value)}
        >
          {show ? "Hide password" : "Show password"}
        </button>
        <button type="submit" className="btn-ink" disabled={busy}>
          {busy ? "Preparing…" : "Back up data"}
        </button>
        {busy ? (
          <p className="saving-row" role="status">
            <span className="save-spin" aria-hidden />
            {progress && progress.total > 0
              ? `Checking attachments ${progress.done} of ${progress.total}`
              : "Preparing the backup"}
          </p>
        ) : null}
        {error ? (
          <p className="form-error" role="alert">
            {error}
          </p>
        ) : null}
        {done ? (
          <p className="slip-who" role="status">
            {done}
          </p>
        ) : null}
      </form>
    </Sheet>
  );
}
