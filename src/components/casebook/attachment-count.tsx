import { Paperclip } from "lucide-react";
import { attachmentCountLabel } from "@/lib/casebook/format";

// Decorative badge for a History button. It is not interactive: the visible icon and number are
// hidden from assistive tech and the count is read as part of the button's own label instead.
export function AttachmentCount({ count }: { count: number }) {
  const label = attachmentCountLabel(count);
  if (!label) return null;
  return (
    <>
      <span className="tile-clip" aria-hidden="true">
        <Paperclip aria-hidden="true" focusable="false" />
        <sup>{count}</sup>
      </span>
      <span className="sr-only">, {label}</span>
    </>
  );
}
