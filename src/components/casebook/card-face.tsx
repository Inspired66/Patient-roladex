import { ageLabel, displayName, formatDob, hasUpcomingProcedure } from "@/lib/casebook/format";
import type { Patient } from "@/lib/casebook/types";

function stopLink(event: React.SyntheticEvent) {
  event.stopPropagation();
}

function Contact({
  label,
  value,
  href,
  onOpen,
}: {
  label: string;
  value: string;
  href?: string;
  onOpen: () => void;
}) {
  if (href && value) {
    return (
      <a className="card-contact" href={href} onPointerDown={stopLink} onClick={stopLink}>
        <em>{label}</em>
        <span>{value}</span>
      </a>
    );
  }
  return (
    <button type="button" className="card-contact" onClick={onOpen}>
      <em>{label}</em>
      <span>{value || "Not recorded"}</span>
    </button>
  );
}

export function CardFace({
  patient,
  current,
  onOpen,
}: {
  patient: Patient;
  current?: boolean;
  onOpen: () => void;
}) {
  const name = displayName(patient.name);
  const age = ageLabel(patient.dob);
  const tel = patient.phone.replace(/[^\d+]/g, "");
  const upcoming = hasUpcomingProcedure(patient);

  return (
    <div className="case-face">
      <button
        type="button"
        className="case-hit"
        aria-current={current ? "true" : undefined}
        aria-label={`Open ${name}`}
        onClick={onOpen}
      >
        <span className="card-kicker">
          <span className="sample-tag">{patient.sample ? "Sample" : "Patient"}</span>
          {upcoming ? <span className="soon-tag">Upcoming</span> : null}
        </span>
        <span className="card-name">{name}</span>
        <span className="card-meta">
          {formatDob(patient.dob) || "DOB not recorded"}
          {" · "}
          {age || "Age not recorded"}
          {" · "}
          {patient.gender || "Gender not recorded"}
        </span>
      </button>
      <div className="card-lines">
        <Contact label="Phone" value={patient.phone} href={tel ? `tel:${tel}` : undefined} onOpen={onOpen} />
        <Contact label="Email" value={patient.email} href={patient.email ? `mailto:${patient.email}` : undefined} onOpen={onOpen} />
      </div>
    </div>
  );
}
