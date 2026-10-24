import { useRef } from "react";
import { Paperclip } from "lucide-react";

export function AttachControls({
  disabled,
  onFiles,
}: {
  disabled?: boolean;
  onFiles: (files: File[]) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);

  return (
    <div className="attach-block">
      <button
        type="button"
        className="icon-btn on-paper"
        aria-label="Attach"
        disabled={disabled}
        onClick={() => fileRef.current?.click()}
      >
        <Paperclip aria-hidden size={18} />
      </button>
      <input
        ref={fileRef}
        className="file-proxy"
        type="file"
        multiple
        accept="image/*,audio/*,application/pdf,text/plain,.pdf,.txt,.jpg,.jpeg,.png,.webp,.mp3,.m4a,.wav,.webm"
        onChange={(event) => {
          const list = Array.from(event.target.files ?? []);
          if (list.length) onFiles(list);
          event.target.value = "";
        }}
      />
    </div>
  );
}
