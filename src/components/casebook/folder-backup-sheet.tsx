import { useEffect, useRef, useState } from "react";
import { Sheet } from "@/components/casebook/forms";
import { PASSWORD_INPUT_PROPS, PasswordNote } from "@/components/casebook/password-input";
import {
  FOLDER_BACKUP_EMPTY,
  readLastFolderBackup,
  runFolderBackup,
} from "@/lib/casebook/folder-backup";
import { MIN_FOLDER_BACKUP_PASSWORD_LENGTH } from "@/lib/casebook/attachment-archive";
import {
  INITIAL_FOLDER_BACKUP_UI_STATE,
  checkFolderBackupPassword,
  folderBackupFixedMessage,
  folderBackupProgressText,
  transitionFolderBackupUi,
} from "@/lib/casebook/folder-backup-ui";
import { createBackupFolderClient } from "@/lib/casebook/native-bridge";
import { todayISO } from "@/lib/casebook/format";
import { useCasebook } from "@/lib/casebook/store";

function dateLabel(iso: string | null) {
  if (!iso) return "Never";
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(year, month - 1, day).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function FolderBackupSheet({ onClose }: { onClose: () => void }) {
  const patients = useCasebook((state) => state.patients);
  const contacts = useCasebook((state) => state.contacts);
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const [show, setShow] = useState(false);
  const [state, setState] = useState(INITIAL_FOLDER_BACKUP_UI_STATE);
  const [progress, setProgress] = useState<Parameters<typeof folderBackupProgressText>[0] | null>(
    null,
  );
  const [last, setLast] = useState(() => readLastFolderBackup());
  const abortController = useRef<AbortController | null>(null);
  const busy = state.status === "running" || state.status === "cancelling";
  const empty = patients.length === 0;
  const type = show ? "text" : "password";

  function clearPasswords() {
    setPassword("");
    setRepeat("");
  }

  useEffect(
    () => () => {
      abortController.current?.abort();
      abortController.current = null;
    },
    [],
  );

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    if (empty) {
      setState(
        transitionFolderBackupUi(state, {
          type: "failure",
          message: FOLDER_BACKUP_EMPTY,
          wroteFiles: false,
        }),
      );
      return;
    }
    const passwordError = checkFolderBackupPassword(password, repeat);
    if (passwordError) {
      setState(
        transitionFolderBackupUi(state, {
          type: "failure",
          message: passwordError,
          wroteFiles: false,
        }),
      );
      return;
    }

    const controller = new AbortController();
    abortController.current = controller;
    let wroteFiles = false;
    setProgress(null);
    setState((current) => transitionFolderBackupUi(current, { type: "start" }));
    try {
      const result = await runFolderBackup(patients, contacts, password, {
        client: createBackupFolderClient(),
        signal: controller.signal,
        today: todayISO(),
        onProgress: (next) => {
          setProgress(next);
          if (next.phase === "files" && next.done > 0) {
            wroteFiles = true;
            setState((current) =>
              transitionFolderBackupUi(current, { type: "progress", done: next.done }),
            );
          }
        },
      });
      if (result.outcome === "cancelled") {
        setState((current) => transitionFolderBackupUi(current, { type: "picker-cancel" }));
        return;
      }
      clearPasswords();
      setLast(readLastFolderBackup());
      setState((current) => transitionFolderBackupUi(current, { type: "success" }));
    } catch (reason) {
      const message = folderBackupFixedMessage(reason);
      setState((current) =>
        transitionFolderBackupUi(current, {
          type: "failure",
          message,
          wroteFiles: wroteFiles || current.wroteFiles,
        }),
      );
    } finally {
      abortController.current = null;
      setProgress(null);
    }
  }

  function cancel() {
    if (!busy || state.status === "cancelling") return;
    setState((current) => transitionFolderBackupUi(current, { type: "cancel" }));
    abortController.current?.abort();
  }

  return (
    <Sheet
      title="Back up to folder"
      onClose={onClose}
      canDismiss={!busy}
      onBeforeClose={clearPasswords}
    >
      <form className="stack" noValidate onSubmit={(event) => void submit(event)}>
        <p className="slip-who" data-testid="last-folder-backup">
          Last folder backup: {dateLabel(last)}
        </p>
        <p className="slip-who">
          Each backup saves your casebook and each attachment as separate encrypted files in a
          folder you choose. Each backup adds a complete new set; you can delete old sets by hand in
          the Files app. The same password is needed to open it. A forgotten password cannot be
          recovered.
        </p>
        <p className="form-error">
          Restoring attachments from a folder backup is not available in Vellum yet. Opening the
          .vellum file in Restore brings back patient records only; attachments show as Not
          restored. Do not rely on this for real data.
        </p>
        <p className="slip-who">
          Use a password with at least {MIN_FOLDER_BACKUP_PASSWORD_LENGTH} characters. It cannot be
          recovered if forgotten.
        </p>
        {empty ? (
          <p className="form-error" role="alert">
            {FOLDER_BACKUP_EMPTY}
          </p>
        ) : null}
        <label className="field-block">
          <span className="lbl">Password</span>
          <input
            className="field"
            type={type}
            autoComplete="new-password"
            minLength={MIN_FOLDER_BACKUP_PASSWORD_LENGTH}
            {...PASSWORD_INPUT_PROPS}
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
            minLength={MIN_FOLDER_BACKUP_PASSWORD_LENGTH}
            {...PASSWORD_INPUT_PROPS}
            value={repeat}
            disabled={busy}
            onChange={(event) => setRepeat(event.target.value)}
          />
        </label>
        <PasswordNote />
        <button
          type="button"
          className="btn-text"
          aria-pressed={show}
          disabled={busy}
          onClick={() => setShow((visible) => !visible)}
        >
          {show ? "Hide password" : "Show password"}
        </button>
        <button type="submit" className="btn-ink" disabled={busy || empty}>
          {state.status === "cancelling"
            ? "Cancelling…"
            : busy
              ? "Preparing…"
              : "Choose folder and back up"}
        </button>
        {busy ? (
          <>
            <p className="slip-who" role="status">
              Keep Vellum open until this finishes. The screen stays on.
            </p>
            <p className="saving-row" role="status">
              <span className="save-spin" aria-hidden />
              {progress ? folderBackupProgressText(progress) : "Preparing encryption"}
            </p>
            <button
              type="button"
              className="btn-ghost"
              disabled={state.status === "cancelling"}
              onClick={cancel}
            >
              {state.status === "cancelling" ? "Cancelling…" : "Cancel"}
            </button>
          </>
        ) : null}
        {state.status === "error" ? (
          <p className="form-error" role="alert">
            {state.message}
          </p>
        ) : null}
        {state.status === "success" ? (
          <p className="slip-who" role="status">
            Backup saved. Copy the whole folder off this phone and keep all the files together.
            <br />
            Last folder backup: {dateLabel(last)}
          </p>
        ) : null}
      </form>
    </Sheet>
  );
}
