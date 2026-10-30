import { useEffect, useId, useMemo, useRef, useState } from "react";
import { AttachControls } from "@/components/casebook/attach";
import { acceptFiles, deleteBlob, fileLimitLabel, MAX_FILES, MAX_RECORDING_SECONDS, putBlob } from "@/lib/casebook/files";
import { choiceNames, displayName, formatBytes, given, joinName, knownHospitals, knownSurgeons, surname, todayISO } from "@/lib/casebook/format";
import { useBackLayer } from "@/lib/casebook/back";
import { useCasebook } from "@/lib/casebook/store";
import type { Attachment, PatientInput, SurgeryInput } from "@/lib/casebook/types";

const PROCEDURES = [
  "Laparoscopic cholecystectomy",
  "Total knee replacement",
  "Caesarean section",
  "Colonoscopy",
  "Inguinal hernia repair",
  "Appendicectomy",
  "Cataract extraction",
  "Thyroidectomy",
  "ACL reconstruction",
];

const GENDERS = ["Female", "Male", "Non-binary", "Other", "Prefer not to say"];

const HOSPITALS = [
  "Royal Melbourne Hospital",
  "The Alfred",
  "Austin Hospital",
  "St Vincent's",
  "Epworth Richmond",
  "Prince of Wales",
  "Royal Women's Hospital",
];

export function Sheet({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const [shown, setShown] = useState(false);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const closing = useRef(false);
  useBackLayer(true, () => close());

  useEffect(() => {
    const id = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(id);
  }, []);

  function close() {
    if (closing.current) return;
    closing.current = true;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    setShown(false);
    window.setTimeout(() => onCloseRef.current(), reduce ? 0 : 280);
  }

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape" && !document.querySelector("[data-confirm]")) close();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="sheet-wrap" data-overlay>
      <button
        type="button"
        className={shown ? "sheet-backdrop is-in" : "sheet-backdrop"}
        aria-label="Close"
        onClick={close}
      />
      <div className={shown ? "sheet is-in" : "sheet"} role="dialog" aria-modal="true" aria-labelledby="sheet-title">
        <div className="sheet-grab" aria-hidden />
        <h2 id="sheet-title">{title}</h2>
        {children}
      </div>
    </div>
  );
}

export function Confirm({
  title,
  body,
  confirmLabel,
  onConfirm,
  onCancel,
}: {
  title: string;
  body: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(id);
  }, []);
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onCancel();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);
  useBackLayer(true, onCancel);

  return (
    <div className="sheet-wrap" data-overlay data-confirm>
      <button
        type="button"
        className={shown ? "sheet-backdrop is-in" : "sheet-backdrop"}
        aria-label="Cancel"
        onClick={onCancel}
      />
      <div className="confirm-card" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title">
        <h2 id="confirm-title">{title}</h2>
        <p>{body}</p>
        <div className="action-row">
          <button type="button" className="btn-ink" onClick={onConfirm}>
            {confirmLabel}
          </button>
          <button type="button" className="btn-ghost" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="field-block">
      <span className="lbl">{label}</span>
      {children}
    </label>
  );
}

export function PatientForm({
  patientId,
  onClose,
  onSaved,
}: {
  patientId?: string;
  onClose: () => void;
  onSaved: (id: string) => void;
}) {
  const patient = useCasebook((state) => state.patients.find((item) => item.id === patientId));
  const addPatient = useCasebook((state) => state.addPatient);
  const updatePatient = useCasebook((state) => state.updatePatient);
  const [last, setLast] = useState(patient ? surname(patient.name) : "");
  const [givenNames, setGivenNames] = useState(patient ? given(patient.name) : "");
  const [dob, setDob] = useState(patient?.dob ?? "");
  const [gender, setGender] = useState(patient?.gender ?? "");
  const [phone, setPhone] = useState(patient?.phone ?? "");
  const [email, setEmail] = useState(patient?.email ?? "");
  const [error, setError] = useState("");

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const input: PatientInput = {
      name: joinName(last, givenNames),
      dob,
      gender,
      phone: phone.trim(),
      email: email.trim(),
    };
    if (!surname(input.name)) {
      setError("Name is required.");
      return;
    }
    if (input.dob && input.dob > todayISO()) {
      setError("Date of birth cannot be in the future.");
      return;
    }
    if (input.email && !input.email.includes("@")) {
      setError("Email needs an @.");
      return;
    }
    if (patientId) {
      updatePatient(patientId, input);
      onSaved(patientId);
      return;
    }
    onSaved(addPatient(input));
  }

  return (
    <Sheet title={patientId ? "Edit patient" : "New patient"} onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        <Field label="Last name">
          <input className="field" value={last} onChange={(event) => setLast(event.target.value)} autoComplete="family-name" autoFocus required />
        </Field>
        <Field label="Given names">
          <input className="field" value={givenNames} onChange={(event) => setGivenNames(event.target.value)} autoComplete="given-name" />
        </Field>
        <Field label="Gender">
          <select className="field" value={gender} onChange={(event) => setGender(event.target.value)}>
            <option value="">Not recorded</option>
            {GENDERS.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Date of birth">
          <input className="field" type="date" value={dob} max={todayISO()} onChange={(event) => setDob(event.target.value)} />
        </Field>
        <Field label="Phone">
          <input className="field" type="tel" inputMode="tel" autoComplete="tel" value={phone} onChange={(event) => setPhone(event.target.value)} />
        </Field>
        <Field label="Email">
          <input className="field" type="email" inputMode="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} />
        </Field>
        {error ? <p className="form-error">{error}</p> : null}
        <div className="action-row">
          <button type="submit" className="btn-ink">
            Save patient
          </button>
          <button type="button" className="btn-ghost" onClick={onClose}>
            Cancel
          </button>
        </div>
      </form>
    </Sheet>
  );
}

type PendingFile = { key: string; file: File; url: string };

function useDirectoryChoices() {
  const patients = useCasebook((state) => state.patients);
  const contacts = useCasebook((state) => state.contacts);
  const surgeons = useMemo(
    () =>
      choiceNames(
        contacts.filter((item) => item.kind === "surgeon").map((item) => displayName(item.name)),
        knownSurgeons(patients).map((item) => displayName(item)),
      ).sort((a, b) => surname(a).localeCompare(surname(b), "en", { sensitivity: "base" }) || a.localeCompare(b, "en", { sensitivity: "base" })),
    [contacts, patients],
  );
  const hospitals = useMemo(
    () =>
      choiceNames(
        contacts.filter((item) => item.kind === "hospital").map((item) => item.name),
        knownHospitals(patients),
        HOSPITALS,
      ),
    [contacts, patients],
  );
  return { surgeons, hospitals };
}

export function SurgeryForm({
  patientId,
  surgeryId,
  onClose,
}: {
  patientId: string;
  surgeryId?: string;
  onClose: () => void;
}) {
  const surgery = useCasebook((state) =>
    state.patients.find((item) => item.id === patientId)?.surgeries.find((item) => item.id === surgeryId),
  );
  const addSurgery = useCasebook((state) => state.addSurgery);
  const updateSurgery = useCasebook((state) => state.updateSurgery);
  const { surgeons, hospitals } = useDirectoryChoices();
  const typeId = useId();
  const hospitalId = useId();
  const surgeonId = useId();
  const [date, setDate] = useState(surgery?.date ?? todayISO());
  const [type, setType] = useState(surgery?.type ?? "");
  const [surgeon, setSurgeon] = useState(surgery?.surgeon ?? "");
  const [hospital, setHospital] = useState(surgery?.hospital ?? "");
  const [notes, setNotes] = useState(surgery?.notes ?? "");
  const [files, setFiles] = useState<PendingFile[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const filesRef = useRef<PendingFile[]>([]);
  filesRef.current = files;
  useEffect(() => {
    return () => {
      for (const pending of filesRef.current) URL.revokeObjectURL(pending.url);
    };
  }, []);

  function addFiles(list: FileList | File[] | null) {
    if (!list) return;
    const { accepted, error: nextError } = acceptFiles(files.length, Array.from(list));
    if (nextError) setError(nextError);
    else setError("");
    setFiles((current) => [
      ...current,
      ...accepted.map((file) => ({ key: crypto.randomUUID(), file, url: URL.createObjectURL(file) })),
    ]);
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const inputBase = {
      date,
      type: type.trim(),
      surgeon: surgeon.trim(),
      hospital: hospital.trim(),
    };
    if (!inputBase.date || !inputBase.type || !inputBase.surgeon || !inputBase.hospital) {
      setError("Date, procedure, surgeon, and hospital are required.");
      return;
    }
    if (surgeryId) {
      updateSurgery(patientId, surgeryId, inputBase);
      onClose();
      return;
    }
    setBusy(true);
    const attachments: Attachment[] = [];
    try {
      for (const pending of files) {
        const id = crypto.randomUUID();
        await putBlob(id, pending.file);
        attachments.push({
          id,
          name: pending.file.name,
          mime: pending.file.type || "application/octet-stream",
          size: pending.file.size,
          addedAt: new Date().toISOString(),
        });
      }
      const input: SurgeryInput = { ...inputBase, notes: notes.trim(), attachments };
      addSurgery(patientId, input);
      onClose();
    } catch {
      for (const file of attachments) void deleteBlob(file.id).catch(() => undefined);
      setError("Could not store a file on this device.");
      setBusy(false);
    }
  }

  return (
    <Sheet title={surgeryId ? "Edit procedure" : "New procedure"} onClose={onClose}>
      <form className="stack" onSubmit={(event) => void submit(event)}>
        <Field label="Date of procedure">
          <input className="field" type="date" value={date} onChange={(event) => setDate(event.target.value)} required autoFocus />
        </Field>
        <Field label="Type of procedure">
          <input className="field" list={typeId} value={type} onChange={(event) => setType(event.target.value)} required />
          <datalist id={typeId}>
            {PROCEDURES.map((item) => (
              <option key={item} value={item} />
            ))}
          </datalist>
        </Field>
        <Field label="Surgeon">
          <input
            className="field"
            list={surgeonId}
            value={surgeon}
            onChange={(event) => setSurgeon(event.target.value)}
            placeholder={surgeons.length ? "Directory or a new name" : "Type the surgeon"}
            required
          />
          <datalist id={surgeonId}>
            {surgeons.map((item) => (
              <option key={item} value={item} />
            ))}
          </datalist>
        </Field>
        <Field label="Hospital">
          <input className="field" list={hospitalId} value={hospital} onChange={(event) => setHospital(event.target.value)} required />
          <datalist id={hospitalId}>
            {hospitals.map((item) => (
              <option key={item} value={item} />
            ))}
          </datalist>
        </Field>
        {surgeryId ? null : (
          <>
            <div>
              <span className="lbl">Theatre notes</span>
              <textarea
                className="area"
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                placeholder="Airway, comorbidities, anaesthetic, recovery"
              />
              <p className="limit-note">
                Up to {MAX_FILES} files, {fileLimitLabel()} each. Recordings stop at {Math.floor(MAX_RECORDING_SECONDS / 60)}:
                {String(MAX_RECORDING_SECONDS % 60).padStart(2, "0")}.
              </p>
            </div>
            <AttachControls disabled={files.length >= MAX_FILES} onFiles={(list) => addFiles(list)} />
              {files.map((pending) => (
                <div className="file-row" key={pending.key}>
                  {pending.file.type.startsWith("image/") ? (
                    <img src={pending.url} alt="" className="pending-thumb" />
                  ) : (
                    <span className="file-icon">{pending.file.name.split(".").pop()?.slice(0, 4)}</span>
                  )}
                  <div className="file-name">
                    <p>{pending.file.name}</p>
                    <span>{formatBytes(pending.file.size)}</span>
                  </div>
                  <button
                    type="button"
                    className="btn-text"
                    onClick={() => {
                      URL.revokeObjectURL(pending.url);
                      setFiles((current) => current.filter((item) => item.key !== pending.key));
                    }}
                  >
                    Remove
                  </button>
                </div>
              ))}
          </>
        )}
        {error ? <p className="form-error">{error}</p> : null}
        <div className="action-row">
          <button type="submit" className="btn-ink" disabled={busy}>
            {busy ? "Saving…" : "Save procedure"}
          </button>
          <button type="button" className="btn-ghost" onClick={onClose}>
            Cancel
          </button>
        </div>
      </form>
    </Sheet>
  );
}

export function ConsultForm({
  patientId,
  consultId,
  onClose,
}: {
  patientId: string;
  consultId?: string;
  onClose: () => void;
}) {
  const consult = useCasebook((state) =>
    state.patients.find((item) => item.id === patientId)?.consults.find((item) => item.id === consultId),
  );
  const addConsult = useCasebook((state) => state.addConsult);
  const updateConsult = useCasebook((state) => state.updateConsult);
  const { surgeons, hospitals } = useDirectoryChoices();
  const doctorId = useId();
  const centreId = useId();
  const [date, setDate] = useState(consult?.date ?? todayISO());
  const [doctor, setDoctor] = useState(consult?.doctor ?? "");
  const [medicalCentre, setMedicalCentre] = useState(consult?.medicalCentre ?? "");
  const [notes, setNotes] = useState(consult?.notes ?? "");
  const [error, setError] = useState("");

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!date) {
      setError("Date is required.");
      return;
    }
    const details = { date, doctor: doctor.trim(), medicalCentre: medicalCentre.trim() };
    if (consultId) {
      updateConsult(patientId, consultId, { ...details, notes: notes.trim() });
      onClose();
      return;
    }
    addConsult(patientId, { ...details, notes: notes.trim(), attachments: [] });
    onClose();
  }

  return (
    <Sheet title={consultId ? "Edit consult" : "New consult"} onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        <Field label="Date">
          <input className="field" type="date" value={date} onChange={(event) => setDate(event.target.value)} required autoFocus />
        </Field>
        <Field label="Doctor (optional)">
          <input
            className="field"
            list={doctorId}
            value={doctor}
            onChange={(event) => setDoctor(event.target.value)}
            placeholder={surgeons.length ? "Directory or a new name" : "Type the doctor"}
          />
          <datalist id={doctorId}>
            {surgeons.map((item) => (
              <option key={item} value={item} />
            ))}
          </datalist>
        </Field>
        <Field label="Medical centre (optional)">
          <input className="field" list={centreId} value={medicalCentre} onChange={(event) => setMedicalCentre(event.target.value)} />
          <datalist id={centreId}>
            {hospitals.map((item) => (
              <option key={item} value={item} />
            ))}
          </datalist>
        </Field>
        <Field label="Notes">
          <textarea className="area" value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Consult note" />
        </Field>
        {error ? <p className="form-error">{error}</p> : null}
        <div className="action-row">
          <button type="submit" className="btn-ink">
            Save consult
          </button>
          <button type="button" className="btn-ghost" onClick={onClose}>
            Cancel
          </button>
        </div>
      </form>
    </Sheet>
  );
}
