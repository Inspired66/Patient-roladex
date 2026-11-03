import {
  BACKUP_CHUNK_BYTES,
  createSealedChunker,
  sealedSize,
  sealVellumAttachment,
  type AttachmentSealMeta,
} from "./attachment-archive.ts";
import type { createBackupFolderClient } from "./native-bridge.ts";

export const FOLDER_BACKUP_FILE_ERROR = "The backup file could not be written.";
export const FOLDER_BACKUP_CANCELLED = "The backup was cancelled.";

export type FolderFileWriter = Pick<
  ReturnType<typeof createBackupFolderClient>,
  "beginFile" | "writeChunk" | "finishFile" | "abortFile"
>;

function toBase64(bytes: Uint8Array) {
  let binary = "";
  const step = 0x8000;
  for (let index = 0; index < bytes.length; index += step) {
    binary += String.fromCharCode(...bytes.subarray(index, index + step));
  }
  return btoa(binary);
}

async function writeOne(
  client: FolderFileWriter,
  begin: { kind: "attachment" | "data"; name: string; size: number },
  produce: (send: (chunk: Uint8Array) => Promise<void>) => Promise<void>,
  signal?: AbortSignal,
) {
  try {
    const started = await client.beginFile(begin);
    if (!started?.started) throw new Error();
    let seq = 0;
    let total = 0;
    // The chunk view may be reused by the caller, so it is encoded before anything is awaited.
    await produce(async (chunk) => {
      if (signal?.aborted) throw new Error();
      const data = toBase64(chunk);
      total += chunk.byteLength;
      const written = await client.writeChunk(seq, data);
      if (!written?.written) throw new Error();
      seq += 1;
    });
    if (total !== begin.size) throw new Error();
    const finished = await client.finishFile();
    if (!finished?.written) throw new Error();
  } catch {
    await client.abortFile().catch(() => null);
    throw new Error(signal?.aborted ? FOLDER_BACKUP_CANCELLED : FOLDER_BACKUP_FILE_ERROR);
  }
}

export type AttachmentWrite = {
  name: string;
  blob: Blob;
  masterKey: CryptoKey;
  setIdHex: string;
  fileSalt: Uint8Array;
  meta: AttachmentSealMeta;
};

// Seals one attachment and streams it to the folder, never holding more than one chunk.
export async function writeSealedAttachment(
  client: FolderFileWriter,
  file: AttachmentWrite,
  signal?: AbortSignal,
) {
  let size: number;
  try {
    size = sealedSize(file.meta);
  } catch {
    throw new Error(FOLDER_BACKUP_FILE_ERROR);
  }
  await writeOne(
    client,
    { kind: "attachment", name: file.name, size },
    async (send) => {
      const chunker = createSealedChunker(send);
      await sealVellumAttachment(
        file.blob,
        file.masterKey,
        file.setIdHex,
        file.fileSalt,
        file.meta,
        (frame) => chunker.push(frame),
      );
      await chunker.flush();
    },
    signal,
  );
}

export async function writeDataFile(
  client: FolderFileWriter,
  name: string,
  blob: Blob,
  signal?: AbortSignal,
) {
  await writeOne(
    client,
    { kind: "data", name, size: blob.size },
    async (send) => {
      for (let start = 0; start < blob.size; start += BACKUP_CHUNK_BYTES) {
        await send(
          new Uint8Array(await blob.slice(start, start + BACKUP_CHUNK_BYTES).arrayBuffer()),
        );
      }
    },
    signal,
  );
}
