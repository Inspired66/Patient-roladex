import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { File, FileText, Image as ImageIcon, Music } from "lucide-react";
import { Confirm } from "@/components/casebook/forms";
import {
  attachmentKind,
  attachmentOpenLabel,
  openAttachment,
  TEXT_CUT_MESSAGE,
  EMPTY_TEXT_MESSAGE,
  type AttachmentKind,
  type TextPreview,
} from "@/lib/casebook/attachment-open";
import { useBackLayer } from "@/lib/casebook/back";
import { attachmentDetail } from "@/lib/casebook/format";
import type { Attachment } from "@/lib/casebook/types";

const ICON: Record<AttachmentKind, typeof File> = {
  image: ImageIcon,
  audio: Music,
  pdf: FileText,
  text: FileText,
  other: File,
};

type Media = { kind: "image" | "audio"; url: string };

// The one attachment row: General notes, procedure and consult lists all render this, and every
// tap goes through openAttachment, so each file type behaves the same everywhere.
export function AttachmentRow({
  file,
  lines,
  ariaLabel,
  onRemove,
}: {
  file: Attachment;
  lines?: string[];
  ariaLabel?: string;
  onRemove?: () => void;
}) {
  const [media, setMedia] = useState<Media | null>(null);
  const [text, setText] = useState<TextPreview | null>(null);
  const [notice, setNotice] = useState("");
  const [confirm, setConfirm] = useState(false);
  const busy = useRef(false);
  const Icon = ICON[attachmentKind(file)];
  const shown = lines ?? [attachmentDetail(file)];

  useEffect(() => {
    const url = media?.url;
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [media]);

  async function open() {
    if (busy.current) return;
    if (media?.kind === "audio") {
      setMedia(null);
      return;
    }
    busy.current = true;
    setNotice("");
    try {
      const result = await openAttachment(file);
      if (result.type === "message") setNotice(result.message);
      else if (result.type === "text") setText(result.preview);
      else setMedia({ kind: result.type, url: URL.createObjectURL(result.blob) });
    } finally {
      busy.current = false;
    }
  }

  return (
    <div className="file-block">
      <div className="file-row">
        <button
          type="button"
          className="file-open"
          aria-label={ariaLabel ?? attachmentOpenLabel(file)}
          aria-expanded={media?.kind === "audio" ? true : undefined}
          onClick={() => void open()}
        >
          <span className="file-icon" aria-hidden>
            <Icon />
          </span>
          <span className="file-name">
            <p>{file.name}</p>
            {shown.filter(Boolean).map((line) => (
              <span key={line}>{line}</span>
            ))}
          </span>
        </button>
        {onRemove ? (
          <button
            type="button"
            className="btn-text danger file-remove"
            onClick={() => setConfirm(true)}
          >
            Remove
          </button>
        ) : null}
      </div>
      {notice ? (
        <p className="slip-who" role="status">
          {notice}
        </p>
      ) : null}
      {media?.kind === "audio" ? (
        <audio className="file-audio" controls src={media.url} preload="none" />
      ) : null}
      {media?.kind === "image" ? (
        <ImageViewer name={file.name} url={media.url} onClose={() => setMedia(null)} />
      ) : null}
      {text ? <TextViewer name={file.name} preview={text} onClose={() => setText(null)} /> : null}
      {confirm && onRemove ? (
        <Confirm
          title="Remove this file?"
          body="The file will be deleted from this device."
          confirmLabel="Remove file"
          onConfirm={() => {
            setConfirm(false);
            onRemove();
          }}
          onCancel={() => setConfirm(false)}
        />
      ) : null}
    </div>
  );
}

function ImageViewer({ name, url, onClose }: { name: string; url: string; onClose: () => void }) {
  useBackLayer(true, onClose);
  return createPortal(
    <div className="lightbox" data-overlay onClick={onClose} role="presentation">
      <img src={url} alt={name} />
    </div>,
    document.body,
  );
}

function TextViewer({
  name,
  preview,
  onClose,
}: {
  name: string;
  preview: TextPreview;
  onClose: () => void;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useBackLayer(true, onClose);
  useEffect(() => {
    closeRef.current?.focus();
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return createPortal(
    <div
      className="lightbox"
      data-overlay
      role="dialog"
      aria-modal="true"
      aria-label={`Text file ${name}`}
    >
      <div className="text-panel">
        <div className="text-panel-head">
          <p>{name}</p>
          <button ref={closeRef} type="button" className="btn-ghost" onClick={onClose}>
            Close
          </button>
        </div>
        {preview.empty ? (
          <p className="slip-who">{EMPTY_TEXT_MESSAGE}</p>
        ) : (
          <pre className="text-body">{preview.text}</pre>
        )}
        {preview.truncated ? <p className="limit-note">{TEXT_CUT_MESSAGE}</p> : null}
      </div>
    </div>,
    document.body,
  );
}
