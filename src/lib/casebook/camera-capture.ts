// Camera entry: the "shrink" preference and the status codes native reports back to the page.
// Native sends only the fixed codes below; anything else is ignored.

export const CAMERA_SHRINK_KEY = "vellum-camera-shrink";
export const CAMERA_PROGRESS_LIMIT_MS = 60_000;

export const CAMERA_STATUS_CODES = [
  "processing",
  "done",
  "cancelled",
  "denied",
  "settings",
  "no-camera",
  "failed",
  "empty",
  "too-large",
  "too-large-original",
  "fallback",
  "reencoded",
] as const;

export type CameraStatus = (typeof CAMERA_STATUS_CODES)[number];

export const CAMERA_MESSAGES: Record<CameraStatus, string> = {
  processing: "Preparing photo…",
  done: "",
  cancelled: "No photo was added.",
  denied:
    "Camera permission was not granted. Choose Camera to try again, or choose Photos instead.",
  settings:
    "Camera permission is off. Turn it on in the phone's Settings for Vellum, or choose Photos instead.",
  "no-camera": "This phone has no camera app available.",
  failed: "The photo could not be prepared. Try again, or choose Photos instead.",
  empty: "The camera did not return a photo. Try again.",
  "too-large":
    "The photo is still larger than 4 MB after shrinking. Try again, or choose Photos instead.",
  "too-large-original":
    "That photo is larger than 4 MB. Turn on “Shrink camera photos” to add it.",
  fallback: "The photo could not be shrunk, so the original was added with its location removed.",
  reencoded:
    "Location could not be removed from the original, so the photo was shrunk and cleaned instead.",
};

export const CAMERA_SHRINK_LABEL = "Shrink camera photos (recommended)";
export const CAMERA_SHRINK_HINT_ON =
  "Camera photos are resized and saved without location or camera details.";
export const CAMERA_SHRINK_HINT_OFF =
  "Off keeps the original size and quality, with camera details such as device model and time. Location is still removed.";

export function isCameraStatus(value: unknown): value is CameraStatus {
  return typeof value === "string" && (CAMERA_STATUS_CODES as readonly string[]).includes(value);
}

export type CameraStatusView = { busy: boolean; message: string };

// Unknown codes return null so a stray call cannot change the screen.
export function cameraStatusView(code: unknown): CameraStatusView | null {
  if (!isCameraStatus(code)) return null;
  return { busy: code === "processing", message: CAMERA_MESSAGES[code] };
}

type ReadableStorage = Pick<Storage, "getItem">;
type WritableStorage = Pick<Storage, "setItem">;

// On unless the user switched it off.
export function readCameraShrink(storage: ReadableStorage | null | undefined): boolean {
  try {
    return storage?.getItem(CAMERA_SHRINK_KEY) !== "0";
  } catch {
    return true;
  }
}

export function writeCameraShrink(storage: WritableStorage | null | undefined, value: boolean) {
  try {
    storage?.setItem(CAMERA_SHRINK_KEY, value ? "1" : "0");
  } catch {
    /* the switch still applies for this session */
  }
}
