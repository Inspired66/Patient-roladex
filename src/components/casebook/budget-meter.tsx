import { patientMeter } from "@/lib/casebook/budget-meter";
import { hasNotRestored, NOT_RESTORED_NOTE } from "@/lib/casebook/budget-meter";
import { PATIENT_BUDGET_BYTES } from "@/lib/casebook/patient-budget";
import { useCasebook } from "@/lib/casebook/store";

export function BudgetMeter({ patientId, pendingBytes = 0 }: { patientId: string | undefined; pendingBytes?: number }) {
  const patient = useCasebook((state) => state.patients.find((item) => item.id === patientId));
  const meter = patientMeter(patient, pendingBytes);
  return (
    <div className="budget-meter" data-state={meter.state}>
      <div className="budget-meter-head">
        <span className="budget-meter-title">Attachment space</span>
        <span className="budget-meter-label">{meter.label}</span>
      </div>
      <div
        className="budget-meter-bar"
        role="progressbar"
        aria-label={meter.ariaLabel}
        aria-valuemin={0}
        aria-valuemax={PATIENT_BUDGET_BYTES}
        aria-valuenow={Math.min(PATIENT_BUDGET_BYTES, meter.used)}
        aria-valuetext={meter.status ? `${meter.label}. ${meter.status}` : meter.label}
      >
        <span style={{ width: `${meter.percent}%` }} />
      </div>
      {meter.status ? (
        <p className="budget-meter-status" role="status">
          {meter.status}
        </p>
      ) : null}
      {hasNotRestored(patient) ? <p className="budget-meter-note">{NOT_RESTORED_NOTE}</p> : null}
    </div>
  );
}
