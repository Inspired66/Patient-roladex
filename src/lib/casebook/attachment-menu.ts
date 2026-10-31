import { MAX_FILES } from "./files.ts";

export type AttachmentPickerPurpose = "files" | "photos" | "camera" | "recorder";

export const ATTACHMENT_MENU_OPTIONS = [
  { purpose: "files", label: "Files", hint: "Choose a PDF, document or other file" },
  { purpose: "photos", label: "Photos", hint: "Choose from your gallery" },
  { purpose: "camera", label: "Camera", hint: "Take a photo" },
  { purpose: "recorder", label: "Voice recorder", hint: "Record audio" },
] as const;

const FILE_ACCEPT =
  "image/jpeg,image/png,image/webp,image/gif,image/heic,image/heif,image/bmp,audio/mpeg,audio/mp4,audio/aac,audio/wav,audio/x-wav,audio/ogg,audio/webm,audio/3gpp,audio/amr,application/pdf,text/plain,.jpg,.jpeg,.png,.webp,.gif,.heic,.heif,.bmp,.mp3,.m4a,.aac,.wav,.ogg,.webm,.3gp,.amr,.pdf,.txt";

export function attachmentPickerConfig(purpose: AttachmentPickerPurpose, maxItems: number) {
  return {
    action: "armAttachmentPicker",
    payload: { purpose, maxItems: Math.max(1, Math.min(MAX_FILES, Math.floor(maxItems))) },
    accept:
      purpose === "photos"
        ? "image/*"
        : purpose === "camera"
          ? "image/*"
          : purpose === "recorder"
            ? "audio/*"
            : FILE_ACCEPT,
    multiple: purpose === "files" || purpose === "photos",
  } as const;
}

export function attachmentMenuLimitState(remaining: number) {
  const limitReached = remaining <= 0;
  return {
    limitReached,
    disabled: limitReached,
    disabledReason: limitReached ? "Attachment limit reached. Remove a file before adding another." : "",
  };
}

export function attachmentSelectionMessage(acceptedCount: number, rejectedReasons: string[]) {
  if (!rejectedReasons.length) return "";
  const count = rejectedReasons.length;
  const uniqueReasons = [...new Set(rejectedReasons)];
  const details = uniqueReasons.join(" ");
  const accepted = acceptedCount > 0 ? " Accepted files are shown below." : "";
  return `${acceptedCount > 0 ? `Added ${acceptedCount} ${acceptedCount === 1 ? "file" : "files"}. ` : ""}${count} ${count === 1 ? "file was" : "files were"} not added. ${details}${accepted}`;
}
