const MIME_BY_EXTENSION: Record<string, string> = {
  "3gp": "audio/3gpp",
  "3gpp": "audio/3gpp",
  "3gpp2": "audio/3gpp2",
  aac: "audio/aac",
  amr: "audio/amr",
  m4a: "audio/mp4",
  mp3: "audio/mpeg",
  ogg: "audio/ogg",
  wav: "audio/wav",
  webm: "audio/webm",
};

const FORMAT_BY_MIME: Record<string, string> = {
  "audio/3gpp": "3GPP",
  "audio/3gpp2": "3GPP2",
  "audio/aac": "AAC",
  "audio/amr": "AMR",
  "audio/mp4": "M4A",
  "audio/mpeg": "MP3",
  "audio/ogg": "OGG",
  "audio/wav": "WAV",
  "audio/webm": "WEBM",
  "audio/x-amr": "AMR",
  "audio/x-wav": "WAV",
};
const FORMAT_BY_EXTENSION: Record<string, string> = {
  "3gp": "3GPP",
  "3gpp": "3GPP",
  "3gpp2": "3GPP2",
  aac: "AAC",
  amr: "AMR",
  m4a: "M4A",
  mp3: "MP3",
  ogg: "OGG",
  wav: "WAV",
  webm: "WEBM",
};

const WEBVIEW_UNPLAYABLE_MIMES = new Set(["audio/3gpp", "audio/3gpp2", "audio/amr", "audio/x-amr"]);
const WEBVIEW_UNPLAYABLE_EXTENSIONS = new Set(["3gp", "3gpp", "amr"]);

function normalizedMime(mime: string) {
  return mime.split(";", 1)[0].trim().toLowerCase();
}

function extensionOf(name: string) {
  return name.toLowerCase().split(".").at(-1) ?? "";
}

export function audioMimeForAttachment(name: string, mime: string) {
  const normalized = normalizedMime(mime);
  if (normalized && normalized !== "application/octet-stream") return normalized;
  return MIME_BY_EXTENSION[extensionOf(name)] ?? normalized;
}

export function audioBlobForAttachment(blob: Blob, name: string, mime: string) {
  const type = audioMimeForAttachment(name, mime);
  if (!type || blob.type.toLowerCase() === type) return blob;
  return new Blob([blob], { type });
}

export function audioFormatLabel(name: string, mime: string) {
  const extensionLabel = FORMAT_BY_EXTENSION[extensionOf(name)];
  if (extensionLabel) return extensionLabel;
  const type = audioMimeForAttachment(name, mime);
  const known = FORMAT_BY_MIME[type];
  if (known) return known;
  return type.startsWith("audio/") ? type.slice("audio/".length).toUpperCase() : "Audio";
}

export function isWebViewUnplayableAudio(file: { name: string; mime: string }) {
  return (
    WEBVIEW_UNPLAYABLE_MIMES.has(normalizedMime(file.mime)) ||
    WEBVIEW_UNPLAYABLE_EXTENSIONS.has(extensionOf(file.name))
  );
}

export function canPlayAudioInWebView(mime: string, canPlayType: (type: string) => string) {
  return Boolean(mime) && canPlayType(mime) !== "";
}
