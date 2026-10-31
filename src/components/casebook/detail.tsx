import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ChevronDown, ChevronLeft, ChevronRight, X } from "lucide-react";
import { AttachControls } from "@/components/casebook/attach";
import { AttachmentRow } from "@/components/casebook/attachment-row";
import { AttachmentCount } from "@/components/casebook/attachment-count";
import { Confirm } from "@/components/casebook/forms";
import { acceptFiles, deleteBlob, fileLimitLabel, MAX_FILES, MAX_RECORDING_SECONDS, putBlob } from "@/lib/casebook/files";
import { ageLabel, displayName, formatDob, patientTimeline, todayISO } from "@/lib/casebook/format";
import {
  attachmentRowModel,
  notesButtonModel,
  patientAttachmentList,
} from "@/lib/casebook/detail-data";
import { useBackLayer } from "@/lib/casebook/back";
import { useCasebook } from "@/lib/casebook/store";
import type { Attachment, Consult, ContactKind, FlyOrigin, Patient, Surgery } from "@/lib/casebook/types";

function destination() {
  const width = window.innerWidth;
  const height = window.innerHeight;
  const gutter = width >= 768 ? 28 : 12;
  const sheetWidth = Math.min(680, width - gutter * 2);
  return {
    top: gutter,
    left: (width - sheetWidth) / 2,
    width: sheetWidth,
    height: Math.max(320, height - gutter * 2),
  };
}

const FLY = "top 560ms cubic-bezier(0.22, 1, 0.36, 1), left 560ms cubic-bezier(0.22, 1, 0.36, 1), width 560ms cubic-bezier(0.22, 1, 0.36, 1), height 560ms cubic-bezier(0.22, 1, 0.36, 1), transform 560ms cubic-bezier(0.22, 1, 0.36, 1)";

function place(el: HTMLElement, box: { top: number; left: number; width: number; height: number }, rotY: number, rotX: number) {
  el.style.top = `${box.top}px`;
  el.style.left = `${box.left}px`;
  el.style.width = `${box.width}px`;
  el.style.height = `${box.height}px`;
  el.style.transform = `rotateY(${rotY}deg) rotateX(${rotX}deg)`;
}

function limitCopy() {
  const minutes = Math.floor(MAX_RECORDING_SECONDS / 60);
  const seconds = String(MAX_RECORDING_SECONDS % 60).padStart(2, "0");
  return `Up to ${MAX_FILES} files, ${fileLimitLabel()} each. Recordings stop at ${minutes}:${seconds}.`;
}

async function storeIncoming(existing: Attachment[], incoming: File[]) {
  const { accepted, error } = acceptFiles(existing.length, incoming);
  const stored: Attachment[] = [];
  try {
    for (const file of accepted) {
      const id = crypto.randomUUID();
      await putBlob(id, file);
      stored.push({
        id,
        name: file.name,
        mime: file.type || "application/octet-stream",
        size: file.size,
        addedAt: new Date().toISOString(),
      });
    }
    return { attachments: [...existing, ...stored], error };
  } catch {
    for (const file of stored) void deleteBlob(file.id).catch(() => undefined);
    return { attachments: existing, error: "Could not store that file on this device." };
  }
}

export function PatientDetail({
  patient,
  origin,
  lane,
  onShift,
  onClose,
  onEditPatient,
  onAddSurgery,
  onEditSurgery,
  onAddConsult,
  onEditConsult,
  onOpenContact,
}: {
  patient: Patient;
  origin: FlyOrigin | null;
  lane: string[];
  onShift: (id: string) => void;
  onClose: () => void;
  onEditPatient: () => void;
  onAddSurgery: () => void;
  onAddConsult: () => void;
  onEditSurgery: (surgeryId: string) => void;
  onEditConsult: (consultId: string) => void;
  onOpenContact: (kind: ContactKind, name: string) => void;
}) {
  const removePatient = useCasebook((state) => state.removePatient);
  const patients = useCasebook((state) => state.patients);
  const sheetRef = useRef<HTMLDivElement>(null);
  const deckRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const incomingRef = useRef<HTMLDivElement>(null);
  const incomingKickerRef = useRef<HTMLParagraphElement>(null);
  const incomingNameRef = useRef<HTMLHeadingElement>(null);
  const incomingMetaRef = useRef<HTMLParagraphElement>(null);
  const finished = useRef(false);
  const sliding = useRef(false);
  const [present, setPresent] = useState(false);
  const [shown, setShown] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const age = ageLabel(patient.dob);
  const name = displayName(patient.name);
  const index = lane.indexOf(patient.id);
  const prevId = index > 0 ? lane[index - 1] : null;
  const nextId = index >= 0 && index < lane.length - 1 ? lane[index + 1] : null;
  const timeline = patientTimeline(patient);
  const prevPatient = prevId ? patients.find((item) => item.id === prevId) : undefined;
  const nextPatient = nextId ? patients.find((item) => item.id === nextId) : undefined;
  const neighbors = useRef({ prevId, nextId, prevPatient, nextPatient });
  neighbors.current = { prevId, nextId, prevPatient, nextPatient };
  const onShiftRef = useRef(onShift);
  onShiftRef.current = onShift;
  const confirmRef = useRef(confirm);
  confirmRef.current = confirm;
  const SLIDE = "transform 360ms cubic-bezier(0.22, 1, 0.36, 1)";

  function paint(dx: number, animate: boolean, dir: -1 | 0 | 1) {
    const track = trackRef.current;
    const incoming = incomingRef.current;
    const deck = deckRef.current;
    if (!track || !deck) return;
    const width = deck.clientWidth || 1;
    track.style.transition = animate ? SLIDE : "none";
    track.style.transform = `translate3d(${dx}px,0,0)`;
    if (!incoming) return;
    incoming.style.transition = animate ? SLIDE : "none";
    if (dir === 0) {
      incoming.style.visibility = "hidden";
      return;
    }
    incoming.style.visibility = "visible";
    const base = dir > 0 ? -width : width;
    incoming.style.transform = `translate3d(${base + dx}px,0,0)`;
  }

  function labelIncoming(dir: -1 | 1, person: Patient) {
    if (incomingKickerRef.current) incomingKickerRef.current.textContent = dir < 0 ? "Previous patient" : "Next patient";
    if (incomingNameRef.current) incomingNameRef.current.textContent = displayName(person.name);
    if (incomingMetaRef.current) {
      const bits = [formatDob(person.dob), ageLabel(person.dob), person.gender].filter(Boolean);
      incomingMetaRef.current.textContent = bits.join(" · ");
    }
  }

  function resetPaint() {
    const track = trackRef.current;
    const incoming = incomingRef.current;
    if (track) {
      track.style.transition = "none";
      track.style.transform = "";
    }
    if (incoming) {
      incoming.style.transition = "none";
      incoming.style.visibility = "hidden";
    }
    sliding.current = false;
  }

  function slideTo(dir: -1 | 1) {
    const target = dir < 0 ? neighbors.current.prevId : neighbors.current.nextId;
    const person = dir < 0 ? neighbors.current.prevPatient : neighbors.current.nextPatient;
    if (!target || sliding.current) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce || !person) {
      onShiftRef.current(target);
      return;
    }
    sliding.current = true;
    labelIncoming(dir, person);
    const width = deckRef.current?.clientWidth || 1;
    requestAnimationFrame(() => paint(dir * width, true, dir));
    window.setTimeout(() => {
      resetPaint();
      onShiftRef.current(target);
    }, 360);
  }

  useLayoutEffect(() => {
    const el = sheetRef.current;
    if (!el) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const dest = destination();
    el.style.opacity = "1";
    if (reduce || !origin) {
      place(el, dest, 0, 0);
      setPresent(true);
      setShown(true);
      return;
    }
    el.style.transition = "none";
    place(el, origin, 0, origin.rotX);
    const frame = requestAnimationFrame(() => {
      el.style.transition = FLY;
      place(el, dest, 0, 0);
      setPresent(true);
    });
    const reveal = window.setTimeout(() => setShown(true), 420);
    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(reveal);
    };
  }, [origin]);

  useEffect(() => {
    setConfirm(false);
  }, [patient.id]);

  function finish() {
    if (finished.current) return;
    finished.current = true;
    onClose();
  }

  function requestClose() {
    const el = sheetRef.current;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!el || !origin || reduce) {
      finish();
      return;
    }
    setShown(false);
    setPresent(false);
    el.style.transition = FLY.replaceAll("560ms", "420ms");
    place(el, origin, 0, origin.rotX);
    window.setTimeout(finish, 430);
  }

  useBackLayer(true, requestClose);

  function shift(dir: -1 | 1) {
    slideTo(dir);
  }

  useEffect(() => {
    const deck = deckRef.current;
    if (!deck) return;
    let startX = 0;
    let startY = 0;
    let dx = 0;
    let mode: "undecided" | "slide" | "scroll" = "undecided";
    let active = false;

    function onStart(event: TouchEvent) {
      if (sliding.current || confirmRef.current || event.touches.length !== 1) return;
      const target = event.target as HTMLElement;
      if (target.closest("textarea, input, button, a, select, audio, label")) return;
      const touch = event.touches[0];
      startX = touch.clientX;
      startY = touch.clientY;
      dx = 0;
      mode = "undecided";
      active = true;
    }

    function onMove(event: TouchEvent) {
      if (!active) return;
      const touch = event.touches[0];
      const nextX = touch.clientX - startX;
      const nextY = touch.clientY - startY;
      if (mode === "undecided") {
        if (Math.abs(nextX) < 12 && Math.abs(nextY) < 12) return;
        mode = Math.abs(nextX) > Math.abs(nextY) * 1.1 ? "slide" : "scroll";
      }
      if (mode !== "slide") return;
      event.preventDefault();
      dx = nextX;
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
      const dir: -1 | 1 = dx < 0 ? -1 : 1;
      const person = dir < 0 ? neighbors.current.prevPatient : neighbors.current.nextPatient;
      if (!person) {
        paint(dx * 0.2, false, 0);
        return;
      }
      labelIncoming(dir, person);
      paint(dx, false, dir);
    }

    function onEnd() {
      if (!active) return;
      active = false;
      if (mode !== "slide") return;
      const width = deckRef.current?.clientWidth || 1;
      const dir: -1 | 1 = dx < 0 ? -1 : 1;
      const target = dir < 0 ? neighbors.current.prevId : neighbors.current.nextId;
      const person = dir < 0 ? neighbors.current.prevPatient : neighbors.current.nextPatient;
      if (target && person && Math.abs(dx) > Math.min(96, width * 0.18)) {
        if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
          onShiftRef.current(target);
          return;
        }
        sliding.current = true;
        labelIncoming(dir, person);
        paint(dir * width, true, dir);
        window.setTimeout(() => {
          resetPaint();
          onShiftRef.current(target);
        }, 360);
        return;
      }
      paint(0, true, 0);
      window.setTimeout(() => {
        if (!sliding.current) resetPaint();
      }, 360);
    }

    deck.addEventListener("touchstart", onStart, { passive: true });
    deck.addEventListener("touchmove", onMove, { passive: false });
    deck.addEventListener("touchend", onEnd);
    deck.addEventListener("touchcancel", onEnd);
    return () => {
      deck.removeEventListener("touchstart", onStart);
      deck.removeEventListener("touchmove", onMove);
      deck.removeEventListener("touchend", onEnd);
      deck.removeEventListener("touchcancel", onEnd);
    };
  }, [patient.id]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape" && !document.querySelector("[data-overlay]")) requestClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const tel = patient.phone.replace(/[^\d+]/g, "");

  return (
    <div className="detail-scene">
      <div className={present ? "detail-backdrop is-in" : "detail-backdrop"} onClick={requestClose} />
      <article ref={sheetRef} className="detail-sheet" role="dialog" aria-modal="true" aria-labelledby="patient-title">
        <div className="detail-bar">
          <p className="detail-kicker">
            {index >= 0 ? `${index + 1} of ${lane.length}` : "Patient"}
          </p>
          <div className="detail-actions">
            <button
              type="button"
              className="icon-btn on-paper"
              aria-label="Previous patient in this list"
              disabled={!prevId}
              onClick={() => shift(-1)}
            >
              <ChevronLeft aria-hidden />
            </button>
            <button
              type="button"
              className="icon-btn on-paper"
              aria-label="Next patient in this list"
              disabled={!nextId}
              onClick={() => shift(1)}
            >
              <ChevronRight aria-hidden />
            </button>
            <button type="button" className="icon-btn on-paper" aria-label="Close" onClick={requestClose}>
              <X aria-hidden />
            </button>
          </div>
        </div>
        <div className="detail-deck" ref={deckRef}>
          <div className="detail-incoming" ref={incomingRef}>
            <p className="detail-kicker" ref={incomingKickerRef}>
              Next patient
            </p>
            <h2 className="detail-name" ref={incomingNameRef} />
            <p className="incoming-meta" ref={incomingMetaRef} />
          </div>
          <div ref={trackRef} className={shown ? "detail-body is-in" : "detail-body"}>
            <p className="sr-only">Drag left for the previous patient in this list, or right for the next. The card slides with your finger.</p>
            <p className="detail-kicker">{patient.sample ? "Sample patient" : "Patient"}</p>
            <h2 id="patient-title" className="detail-name">
              {name}
            </h2>
            <dl className="facts">
            <div>
              <dt>Born</dt>
              <dd>
                {formatDob(patient.dob) || "Not recorded"}
                {age ? ` · ${age}` : ""}
              </dd>
            </div>
            <div>
              <dt>Gender</dt>
              <dd>{patient.gender || "Not recorded"}</dd>
            </div>
            <div>
              <dt>Phone</dt>
              <dd>{patient.phone ? <a href={`tel:${tel}`}>{patient.phone}</a> : "Not recorded"}</dd>
            </div>
            <div>
              <dt>Email</dt>
              <dd>{patient.email ? <a href={`mailto:${patient.email}`}>{patient.email}</a> : "Not recorded"}</dd>
            </div>
          </dl>
          <div className="action-row push-top">
            <button type="button" className="btn-ink" onClick={onAddSurgery}>
              Add procedure
            </button>
            <button type="button" className="btn-ghost" onClick={onAddConsult}>
              Add consult
            </button>
            <button type="button" className="btn-ghost" onClick={onEditPatient}>
              Edit patient
            </button>
            <button type="button" className="btn-text danger" onClick={() => setConfirm(true)}>
              Remove
            </button>
          </div>
          <GeneralNotes key={patient.id} patient={patient} />
          <div className="section-head">
            <h3>History</h3>
            <span>{timeline.length}</span>
          </div>
          {timeline.length === 0 ? <p className="slip-who">No consults or procedures yet.</p> : null}
          {timeline.map((entry) =>
            entry.kind === "consult" ? (
              <ConsultBlock
                key={entry.id}
                patientId={patient.id}
                consult={entry.consult}
                onEdit={() => onEditConsult(entry.id)}
                onOpenContact={onOpenContact}
              />
            ) : (
              <SurgeryBlock
                key={entry.id}
                patientId={patient.id}
                surgery={entry.surgery}
                onEdit={() => onEditSurgery(entry.id)}
                onOpenContact={onOpenContact}
              />
            ),
          )}
          <p className="quiet-end">On this device only. Not a hospital record.</p>
          </div>
        </div>
      </article>
      {confirm ? (
        <Confirm
          title="Remove this patient?"
          body="Their procedures, consults, notes, and files will be deleted from this device."
          confirmLabel="Remove patient"
          onConfirm={() => {
            removePatient(patient.id);
            finish();
          }}
          onCancel={() => setConfirm(false)}
        />
      ) : null}
    </div>
  );
}

function GeneralNotes({ patient }: { patient: Patient }) {
  const patchPatient = useCasebook((state) => state.patchPatient);
  const [draft, setDraft] = useState(patient.notes);
  const [open, setOpen] = useState(false);
  const model = notesButtonModel(patient.notes, patient.notesModifiedAt);
  const files = patientAttachmentList(patient);

  useEffect(() => {
    if (draft === patient.notes) return;
    const timer = window.setTimeout(() => patchPatient(patient.id, { notes: draft }), 240);
    return () => window.clearTimeout(timer);
  }, [draft, patient.id, patient.notes, patchPatient]);

  return (
    <>
      <div className="section-head">
        <h3>General notes</h3>
      </div>
      <section className={open ? "slip tile notes-tile is-open" : "slip tile notes-tile"}>
        <button
          type="button"
          className="tile-toggle"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          <span className="sr-only">General notes. </span>
          <span className="tile-copy">
            {model.empty ? (
              <span className="slip-who">{model.emptyLine}</span>
            ) : (
              <>
                {model.dateLine ? <span className="slip-date">{model.dateLine}</span> : null}
                <span className="notes-preview">{model.preview}</span>
              </>
            )}
          </span>
          <ChevronDown className="tile-chevron" aria-hidden />
        </button>
        {open ? (
          <div className="tile-body">
            <label className="lbl" htmlFor={`general-${patient.id}`}>
              Note
            </label>
            <textarea
              id={`general-${patient.id}`}
              className="area"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="Notes for this patient, even when there is no procedure"
            />
          </div>
        ) : null}
      </section>
      <div className="notes-files">
        <p className="lbl">Attachments{files.length ? ` (${files.length})` : ""}</p>
        {files.length === 0 ? <p className="slip-who">No attachments yet.</p> : null}
        {files.map((entry) => (
          <AttachmentRow
            key={entry.file.id}
            file={entry.file}
            lines={attachmentRowModel(entry).lines}
            ariaLabel={attachmentRowModel(entry).ariaLabel}
          />
        ))}
      </div>
    </>
  );
}

function ConsultBlock({
  patientId,
  consult,
  onEdit,
  onOpenContact,
}: {
  patientId: string;
  consult: Consult;
  onEdit: () => void;
  onOpenContact: (kind: ContactKind, name: string) => void;
}) {
  const updateConsult = useCasebook((state) => state.updateConsult);
  const removeConsult = useCasebook((state) => state.removeConsult);
  const [draft, setDraft] = useState(consult.notes);
  const [error, setError] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [open, setOpen] = useState(false);
  const notesId = `consult-${consult.id}`;

  useEffect(() => {
    setDraft(consult.notes);
  }, [consult.notes]);

  useEffect(() => {
    if (draft === consult.notes) return;
    const timer = window.setTimeout(() => updateConsult(patientId, consult.id, { notes: draft }), 240);
    return () => window.clearTimeout(timer);
  }, [consult.id, consult.notes, draft, patientId, updateConsult]);

  async function add(list: File[]) {
    const result = await storeIncoming(consult.attachments, list);
    if (result.attachments !== consult.attachments) {
      updateConsult(patientId, consult.id, { attachments: result.attachments });
    }
    setError(result.error);
  }

  return (
    <section className={open ? "slip tile is-open" : "slip tile"}>
      <button
        type="button"
        className={`tile-toggle${consult.attachments.length ? " has-clip" : ""}`}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="tile-copy">
          <span className="slip-date">{formatDob(consult.date) || "No date"}</span>
          <span className="slip-type">Consult</span>
          {consult.doctor || consult.medicalCentre ? (
            <span className="slip-who">{[consult.doctor, consult.medicalCentre].filter(Boolean).join(" · ")}</span>
          ) : null}
        </span>
        <AttachmentCount count={consult.attachments.length} />
        <ChevronDown className="tile-chevron" aria-hidden />
      </button>
      {open ? (
        <div className="tile-body">
          {consult.doctor || consult.medicalCentre ? (
            <p className="slip-who">
              {consult.doctor ? (
                <button type="button" className="name-link" onClick={() => onOpenContact("surgeon", consult.doctor)}>
                  {consult.doctor}
                </button>
              ) : null}
              {consult.doctor && consult.medicalCentre ? <span aria-hidden> · </span> : null}
              {consult.medicalCentre ? (
                <button type="button" className="name-link" onClick={() => onOpenContact("hospital", consult.medicalCentre)}>
                  {consult.medicalCentre}
                </button>
              ) : null}
            </p>
          ) : null}
          <div className="action-row">
            <button type="button" className="btn-text" onClick={onEdit}>
              Edit details
            </button>
            <button type="button" className="btn-text danger" onClick={() => setConfirm(true)}>
              Remove
            </button>
          </div>
          <label className="lbl" htmlFor={notesId}>
            Notes
          </label>
          <textarea
            id={notesId}
            className="area"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="Consult note"
          />
          <p className="limit-note">{limitCopy()}</p>
          <AttachControls disabled={consult.attachments.length >= MAX_FILES} onFiles={(list) => void add(list)} />
          <FileList
            files={consult.attachments}
            onRemove={(id) =>
              updateConsult(patientId, consult.id, {
                attachments: consult.attachments.filter((item) => item.id !== id),
              })
            }
          />
          {error ? <p className="form-error">{error}</p> : null}
        </div>
      ) : null}
      {confirm ? (
        <Confirm
          title="Remove this consult?"
          body="The note and any attached files will be deleted from this device."
          confirmLabel="Remove consult"
          onConfirm={() => removeConsult(patientId, consult.id)}
          onCancel={() => setConfirm(false)}
        />
      ) : null}
    </section>
  );
}

function SurgeryBlock({
  patientId,
  surgery,
  onEdit,
  onOpenContact,
}: {
  patientId: string;
  surgery: Surgery;
  onEdit: () => void;
  onOpenContact: (kind: ContactKind, name: string) => void;
}) {
  const updateSurgery = useCasebook((state) => state.updateSurgery);
  const removeSurgery = useCasebook((state) => state.removeSurgery);
  const [draft, setDraft] = useState(surgery.notes);
  const [error, setError] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [open, setOpen] = useState(false);
  const notesId = `notes-${surgery.id}`;

  useEffect(() => {
    setDraft(surgery.notes);
  }, [surgery.notes]);

  useEffect(() => {
    if (draft === surgery.notes) return;
    const timer = window.setTimeout(() => {
      updateSurgery(patientId, surgery.id, { notes: draft });
    }, 240);
    return () => window.clearTimeout(timer);
  }, [draft, patientId, surgery.id, surgery.notes, updateSurgery]);

  async function add(list: File[]) {
    const result = await storeIncoming(surgery.attachments, list);
    if (result.attachments !== surgery.attachments) {
      updateSurgery(patientId, surgery.id, { attachments: result.attachments });
    }
    setError(result.error);
  }

  const upcoming = surgery.date > todayISO();

  return (
    <section className={`slip tile${open ? " is-open" : ""}${upcoming ? " is-soon" : ""}`}>
      <button
        type="button"
        className={`tile-toggle${surgery.attachments.length ? " has-clip" : ""}`}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="tile-copy">
          <span className="slip-date">
            {upcoming ? "Upcoming · " : ""}
            {formatDob(surgery.date) || "No date"}
          </span>
          <span className="slip-type">{surgery.type || "Procedure"}</span>
          <span className="slip-who">
            {surgery.surgeon}
            {surgery.hospital ? ` · ${surgery.hospital}` : ""}
          </span>
        </span>
        <AttachmentCount count={surgery.attachments.length} />
        <ChevronDown className="tile-chevron" aria-hidden />
      </button>
      {open ? (
        <div className="tile-body">
          <p className="slip-who">
            <button type="button" className="name-link" onClick={() => onOpenContact("surgeon", surgery.surgeon)}>
              {surgery.surgeon}
            </button>
            <span aria-hidden> · </span>
            <button type="button" className="name-link" onClick={() => onOpenContact("hospital", surgery.hospital)}>
              {surgery.hospital}
            </button>
          </p>
          <div className="action-row">
            <button type="button" className="btn-text" onClick={onEdit}>
              Edit details
            </button>
            <button type="button" className="btn-text danger" onClick={() => setConfirm(true)}>
              Remove
            </button>
          </div>
          <label className="lbl" htmlFor={notesId}>
            Theatre notes
          </label>
          <textarea
            id={notesId}
            className="area"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="Type the anaesthetic note"
          />
          <p className="limit-note">{limitCopy()}</p>
          <AttachControls disabled={surgery.attachments.length >= MAX_FILES} onFiles={(list) => void add(list)} />
          <FileList
            files={surgery.attachments}
            onRemove={(id) =>
              updateSurgery(patientId, surgery.id, {
                attachments: surgery.attachments.filter((item) => item.id !== id),
              })
            }
          />
          {error ? <p className="form-error">{error}</p> : null}
        </div>
      ) : null}
      {confirm ? (
        <Confirm
          title="Remove this procedure?"
          body="The note and any attached files will be deleted from this device."
          confirmLabel="Remove procedure"
          onConfirm={() => removeSurgery(patientId, surgery.id)}
          onCancel={() => setConfirm(false)}
        />
      ) : null}
    </section>
  );
}

function FileList({ files, onRemove }: { files: Attachment[]; onRemove: (id: string) => void }) {
  if (files.length === 0) return <p className="slip-who">No files attached.</p>;
  return (
    <>
      {files.map((file) => (
        <AttachmentRow key={file.id} file={file} onRemove={() => onRemove(file.id)} />
      ))}
    </>
  );
}
