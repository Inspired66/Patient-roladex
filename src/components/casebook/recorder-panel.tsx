import { useEffect, useState } from "react";
import { Confirm } from "@/components/casebook/forms";
import { useBackLayer } from "@/lib/casebook/back";
import {
  formatClock,
  needsCancelConfirm,
  remainingHint,
  type RecorderPhase,
} from "@/lib/casebook/recorder-capture";

// Recording panel: indicator, timer, Stop and Add, Cancel. Back or closing means Cancel, with a
// confirmation once more than a few seconds have been recorded.
export function RecorderPanel({
  phase,
  elapsed,
  onStop,
  onCancel,
}: {
  phase: RecorderPhase;
  elapsed: number;
  onStop: () => void;
  onCancel: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const recording = phase === "recording";
  const hint = recording ? remainingHint(elapsed) : "";

  function requestCancel() {
    if (recording && needsCancelConfirm(elapsed)) setConfirming(true);
    else onCancel();
  }

  useBackLayer(true, requestCancel);

  useEffect(() => {
    if (phase === "processing" || phase === "starting") setConfirming(false);
  }, [phase]);

  return (
    <div className="sheet-wrap recorder-wrap">
      <div className="sheet-backdrop is-in" aria-hidden />
      <div className="sheet is-in recorder-panel" role="dialog" aria-modal="true" aria-label="Voice recorder">
        <div className="sheet-grab" aria-hidden />
        <p className="recorder-state" role="status">
          <span className={recording ? "recorder-dot is-live" : "recorder-dot"} aria-hidden />
          {recording ? "Recording…" : "Preparing recording…"}
        </p>
        <p className="recorder-clock" aria-label={`Recorded ${formatClock(elapsed)}`}>
          {formatClock(elapsed)}
        </p>
        <p className="recorder-hint" role="status">
          {hint}
        </p>
        <div className="recorder-actions">
          <button type="button" className="btn-primary recorder-button" disabled={!recording} onClick={onStop}>
            Stop and Add
          </button>
          <button
            type="button"
            className="btn-ghost recorder-button"
            disabled={phase === "processing"}
            onClick={requestCancel}
          >
            Cancel
          </button>
        </div>
      </div>
      {confirming ? (
        <Confirm
          title="Discard this recording?"
          body="The recording will be deleted and not added."
          confirmLabel="Discard"
          onConfirm={() => {
            setConfirming(false);
            onCancel();
          }}
          onCancel={() => setConfirming(false)}
        />
      ) : null}
    </div>
  );
}
