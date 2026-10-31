import { useEffect, useId, useRef, useState } from "react";
import { Camera, FileText, Images, Mic, Paperclip } from "lucide-react";
import { callNative, hasNativeMessageBridge } from "@/lib/casebook/native-bridge";
import { useBackLayer } from "@/lib/casebook/back";
import { MAX_FILES } from "@/lib/casebook/files";
import {
  ATTACHMENT_MENU_OPTIONS,
  attachmentMenuLimitState,
  attachmentPickerConfig,
  type AttachmentPickerPurpose,
} from "@/lib/casebook/attachment-menu";

const FILE_ACCEPT = attachmentPickerConfig("files", MAX_FILES).accept;

const menuIcons = {
  files: FileText,
  photos: Images,
  camera: Camera,
  recorder: Mic,
};

export function AttachControls({
  disabled,
  remaining = MAX_FILES,
  onFiles,
}: {
  disabled?: boolean;
  remaining?: number;
  onFiles: (files: File[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const limit = attachmentMenuLimitState(disabled ? 0 : remaining);

  useBackLayer(open, () => setOpen(false));

  useEffect(() => {
    if (!open) return;
    const dialog = dialogRef.current;
    const trigger = triggerRef.current;
    const first = dialog?.querySelector<HTMLElement>("button:not(:disabled)");
    first?.focus();
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        return;
      }
      if (event.key !== "Tab" || !dialog) return;
      const buttons = Array.from(dialog.querySelectorAll<HTMLElement>("button:not(:disabled)"));
      if (!buttons.length) return;
      const firstButton = buttons[0];
      const lastButton = buttons[buttons.length - 1];
      if (event.shiftKey && document.activeElement === firstButton) {
        event.preventDefault();
        lastButton.focus();
      } else if (!event.shiftKey && document.activeElement === lastButton) {
        event.preventDefault();
        firstButton.focus();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      trigger?.focus();
    };
  }, [open]);

  async function choose(purpose: AttachmentPickerPurpose) {
    setOpen(false);
    setMessage("");
    if (purpose === "camera" || purpose === "recorder") {
      if (!hasNativeMessageBridge()) {
        setMessage(`${purpose === "camera" ? "Camera" : "Voice recorder"} is available only in the Vellum app.`);
        return;
      }
    }
    const input = fileRef.current;
    if (!input) {
      setMessage("The attachment picker is unavailable.");
      return;
    }
    const config = attachmentPickerConfig(purpose, remaining);
    input.accept = config.accept;
    input.multiple = config.multiple;
    if (hasNativeMessageBridge()) {
      try {
        const result = await callNative<{ armed: boolean }>(
          config.action,
          config.payload,
        );
        if (!result?.armed) {
          setMessage("The attachment picker could not be prepared.");
          return;
        }
      } catch {
        setMessage("The attachment picker could not be prepared.");
        return;
      }
    }
    input.click();
  }

  return (
    <div className="attach-block">
      <button
        ref={triggerRef}
        type="button"
        className="btn-ghost attach-trigger"
        aria-label={
          limit.limitReached
            ? `Add attachment. ${limit.disabledReason}`
            : "Add attachment"
        }
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-describedby={limit.limitReached ? `${titleId}-limit` : undefined}
        title={limit.disabledReason || undefined}
        disabled={limit.disabled}
        onClick={() => setOpen(true)}
      >
        <Paperclip aria-hidden size={18} />
        Add attachment
      </button>
      {limit.limitReached ? (
        <p className="attach-limit-note" id={`${titleId}-limit`}>
          {limit.disabledReason}
        </p>
      ) : null}
      {message ? (
        <p className="form-error attach-message" role="status">
          {message}
        </p>
      ) : null}
      <input
        ref={fileRef}
        className="file-proxy"
        type="file"
        multiple
        accept={FILE_ACCEPT}
        aria-label="Choose attachment files"
        onChange={(event) => {
          const list = Array.from(event.target.files ?? []);
          if (list.length) onFiles(list);
          event.target.value = "";
        }}
      />
      {open ? (
        <div className="sheet-wrap attachment-menu-wrap">
          <button
            type="button"
            className="sheet-backdrop is-in"
            aria-label="Close attachment menu"
            onClick={() => setOpen(false)}
          />
          <div
            ref={dialogRef}
            className="sheet is-in attachment-menu"
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
          >
            <div className="sheet-grab" aria-hidden />
            <h2 id={titleId}>Add attachment</h2>
            <div className="attachment-menu-options">
              {ATTACHMENT_MENU_OPTIONS.map((option) => {
                const Icon = menuIcons[option.purpose];
                return (
                  <button
                    key={option.purpose}
                    type="button"
                    className="attachment-menu-option"
                    aria-label={`${option.label}. ${option.hint}`}
                    onClick={() => void choose(option.purpose)}
                  >
                    <Icon aria-hidden size={20} />
                    <span className="attachment-menu-copy">
                      <strong>{option.label}</strong>
                      <span>{option.hint}</span>
                    </span>
                  </button>
                );
              })}
            </div>
            <button type="button" className="btn-ghost attachment-menu-cancel" onClick={() => setOpen(false)}>
              Cancel
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
