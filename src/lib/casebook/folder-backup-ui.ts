import {
  FOLDER_BACKUP_FILE_ERROR,
  FOLDER_BACKUP_FIXED_MESSAGES,
  FOLDER_BACKUP_SHORT_PASSWORD,
  type FolderBackupProgress,
} from "./folder-backup.ts";
import { MIN_FOLDER_BACKUP_PASSWORD_LENGTH } from "./attachment-archive.ts";

export const FOLDER_BACKUP_PASSWORD_MISMATCH = "Passwords do not match.";
export const FOLDER_BACKUP_CANCELLING = "Cancelling…";

export type FolderBackupUiStatus = "form" | "running" | "cancelling" | "success" | "error";
export type FolderBackupUiState = {
  status: FolderBackupUiStatus;
  message: string;
  wroteFiles: boolean;
};

export const INITIAL_FOLDER_BACKUP_UI_STATE: FolderBackupUiState = {
  status: "form",
  message: "",
  wroteFiles: false,
};

export function checkFolderBackupPassword(password: string, repeat: string) {
  if (password.length < MIN_FOLDER_BACKUP_PASSWORD_LENGTH) {
    return FOLDER_BACKUP_SHORT_PASSWORD;
  }
  if (password !== repeat) return FOLDER_BACKUP_PASSWORD_MISMATCH;
  return "";
}

export function folderBackupProgressText(progress: FolderBackupProgress) {
  switch (progress.phase) {
    case "index":
      return "Checking files";
    case "key":
    case "data":
      return "Preparing encryption";
    case "verify":
      return "Checking the backup";
    case "files":
      return `Saving file ${Math.min(progress.done + 1, progress.total)} of ${progress.total}`;
  }
}

export function folderBackupFixedMessage(reason: unknown) {
  const message = reason instanceof Error ? reason.message : "";
  return FOLDER_BACKUP_FIXED_MESSAGES.includes(
    message as (typeof FOLDER_BACKUP_FIXED_MESSAGES)[number],
  )
    ? message
    : FOLDER_BACKUP_FILE_ERROR;
}

export type FolderBackupUiEvent =
  | { type: "start" }
  | { type: "progress"; done: number }
  | { type: "cancel" }
  | { type: "picker-cancel" }
  | { type: "success" }
  | { type: "failure"; message: string; wroteFiles: boolean };

export function transitionFolderBackupUi(
  state: FolderBackupUiState,
  event: FolderBackupUiEvent,
): FolderBackupUiState {
  switch (event.type) {
    case "start":
      return { status: "running", message: "", wroteFiles: false };
    case "progress":
      return event.done > 0 && state.status === "running" ? { ...state, wroteFiles: true } : state;
    case "cancel":
      return state.status === "running"
        ? { ...state, status: "cancelling", message: FOLDER_BACKUP_CANCELLING }
        : state;
    case "picker-cancel":
      return INITIAL_FOLDER_BACKUP_UI_STATE;
    case "success":
      return { status: "success", message: "", wroteFiles: state.wroteFiles };
    case "failure":
      return {
        status: "error",
        message: event.wroteFiles
          ? `${event.message} Some files may have been saved in the folder before it stopped. You can delete them.`
          : event.message,
        wroteFiles: event.wroteFiles,
      };
  }
}
