import assert from "node:assert/strict";
import test from "node:test";
import {
  FOLDER_BACKUP_CANCELLED,
  FOLDER_BACKUP_EMPTY,
  FOLDER_BACKUP_FILE_ERROR,
  FOLDER_BACKUP_SHORT_PASSWORD,
} from "./folder-backup.ts";
import {
  FOLDER_BACKUP_CANCELLING,
  FOLDER_BACKUP_PASSWORD_MISMATCH,
  INITIAL_FOLDER_BACKUP_UI_STATE,
  checkFolderBackupPassword,
  folderBackupFixedMessage,
  folderBackupProgressText,
  transitionFolderBackupUi,
} from "./folder-backup-ui.ts";

test("folder password validation enforces the minimum and confirmation", () => {
  assert.equal(checkFolderBackupPassword("short", "short"), FOLDER_BACKUP_SHORT_PASSWORD);
  assert.equal(
    checkFolderBackupPassword("long enough password", "different password"),
    FOLDER_BACKUP_PASSWORD_MISMATCH,
  );
  assert.equal(checkFolderBackupPassword("long enough password", "long enough password"), "");
});

test("progress text uses fixed phases and counts the final data file", () => {
  assert.equal(folderBackupProgressText({ phase: "index", done: 1, total: 4 }), "Checking files");
  assert.equal(
    folderBackupProgressText({ phase: "key", done: 0, total: 1 }),
    "Preparing encryption",
  );
  assert.equal(
    folderBackupProgressText({ phase: "data", done: 0, total: 1 }),
    "Preparing encryption",
  );
  assert.equal(
    folderBackupProgressText({ phase: "verify", done: 0, total: 1 }),
    "Checking the backup",
  );
  assert.equal(
    folderBackupProgressText({ phase: "files", done: 0, total: 12 }),
    "Saving file 1 of 12",
  );
  assert.equal(
    folderBackupProgressText({ phase: "files", done: 2, total: 12 }),
    "Saving file 3 of 12",
  );
  assert.equal(
    folderBackupProgressText({ phase: "files", done: 11, total: 12 }),
    "Saving file 12 of 12",
  );
});

test("unknown errors map to a fixed message and approved errors stay fixed", () => {
  assert.equal(
    folderBackupFixedMessage(new Error(FOLDER_BACKUP_CANCELLED)),
    FOLDER_BACKUP_CANCELLED,
  );
  assert.equal(folderBackupFixedMessage(new Error(FOLDER_BACKUP_EMPTY)), FOLDER_BACKUP_EMPTY);
  assert.equal(
    folderBackupFixedMessage(new Error("private name and id")),
    FOLDER_BACKUP_FILE_ERROR,
  );
  assert.equal(folderBackupFixedMessage("private name and id"), FOLDER_BACKUP_FILE_ERROR);
});

test("folder backup UI transitions preserve retry state without exposing data", () => {
  const running = transitionFolderBackupUi(INITIAL_FOLDER_BACKUP_UI_STATE, { type: "start" });
  assert.deepEqual(running, { status: "running", message: "", wroteFiles: false });
  const cancelling = transitionFolderBackupUi(running, { type: "cancel" });
  assert.deepEqual(cancelling, {
    status: "cancelling",
    message: FOLDER_BACKUP_CANCELLING,
    wroteFiles: false,
  });
  const failed = transitionFolderBackupUi(running, {
    type: "failure",
    message: FOLDER_BACKUP_CANCELLED,
    wroteFiles: true,
  });
  assert.equal(failed.status, "error");
  assert.equal(failed.wroteFiles, true);
  assert.match(failed.message, /Some files may have been saved/);
  assert.equal(
    transitionFolderBackupUi(running, { type: "picker-cancel" }),
    INITIAL_FOLDER_BACKUP_UI_STATE,
  );
  assert.deepEqual(transitionFolderBackupUi(running, { type: "success" }), {
    status: "success",
    message: "",
    wroteFiles: false,
  });
});
