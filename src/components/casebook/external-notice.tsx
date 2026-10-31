import { useEffect, useState } from "react";
import { Confirm } from "@/components/casebook/forms";
import {
  EXTERNAL_NOTICE_BODY,
  EXTERNAL_NOTICE_TITLE,
  registerExternalNoticeHost,
} from "@/lib/casebook/external-notice";

// Mounted once. Shows the one-time "opens outside Vellum" notice when an opener asks for it.
export function ExternalOpenNotice() {
  const [answer, setAnswer] = useState<((accepted: boolean) => void) | null>(null);
  useEffect(
    () =>
      registerExternalNoticeHost((resolve) => {
        setAnswer(() => resolve);
      }),
    [],
  );
  if (!answer) return null;
  function finish(accepted: boolean) {
    answer?.(accepted);
    setAnswer(null);
  }
  return (
    <Confirm
      title={EXTERNAL_NOTICE_TITLE}
      body={EXTERNAL_NOTICE_BODY}
      confirmLabel="Open"
      onConfirm={() => finish(true)}
      onCancel={() => finish(false)}
    />
  );
}
