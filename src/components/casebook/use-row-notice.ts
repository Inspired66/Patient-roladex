import { useEffect, useRef, useState } from "react";
import {
  announceRowAction,
  createNoticeController,
  listenForeground,
  newRowId,
  subscribeRowActions,
  type NoticeController,
  type RowNotice,
} from "@/lib/casebook/row-notice";

// The row's single notice. Nothing runs after unmount: the controller is disposed (timer
// cleared, events ignored) and `alive()` lets async work skip its state updates.
export function useRowNotice() {
  const [notice, setNotice] = useState<RowNotice | null>(null);
  const controller = useRef<NoticeController | null>(null);
  const rowId = useRef(0);
  if (rowId.current === 0) rowId.current = newRowId();

  useEffect(() => {
    const created = createNoticeController({ onChange: setNotice });
    controller.current = created;
    const unsubscribe = subscribeRowActions((source) => {
      if (source !== rowId.current) created.otherRowAction();
    });
    return () => {
      unsubscribe();
      created.dispose();
      controller.current = null;
    };
  }, []);

  const active = notice !== null;
  useEffect(() => {
    if (!active) return;
    return listenForeground(document, window, () => controller.current?.foreground());
  }, [active]);

  return {
    notice,
    alive: () => controller.current !== null,
    current: () => controller.current?.get() ?? null,
    show: (kind: RowNotice["kind"], message: string, handoff = false) =>
      controller.current?.show(kind, message, handoff),
    dismiss: () => controller.current?.dismiss(),
    // A new action clears this row's notice and any prompt in other rows.
    beginAction: () => {
      controller.current?.action();
      announceRowAction(rowId.current);
    },
  };
}
