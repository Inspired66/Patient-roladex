import { useState } from "react";
import { Confirm, Sheet } from "@/components/casebook/forms";
import { contactMatch, displayName, given, joinName, surname } from "@/lib/casebook/format";
import { useCasebook } from "@/lib/casebook/store";
import type { ContactKind } from "@/lib/casebook/types";

export function DirectorySheet({
  onClose,
  onOpen,
}: {
  onClose: () => void;
  onOpen: (kind: ContactKind, name: string) => void;
}) {
  const contacts = useCasebook((state) => state.contacts);
  const [kind, setKind] = useState<ContactKind>("surgeon");
  const listed = contacts
    .filter((item) => item.kind === kind)
    .slice()
    .sort((a, b) => {
      if (kind === "surgeon") {
        const bySurname = surname(a.name).localeCompare(surname(b.name), "en", { sensitivity: "base" });
        if (bySurname) return bySurname;
        return displayName(a.name).localeCompare(displayName(b.name), "en", { sensitivity: "base" });
      }
      return a.name.localeCompare(b.name, "en", { sensitivity: "base" });
    });
  const label = kind === "surgeon" ? "surgeon" : "hospital";

  return (
    <Sheet title="Directory" onClose={onClose}>
      <div className="stack">
        <p className="slip-who">Surgeons and hospitals, kept apart from the patient cards. Phone, email, and notes stay on this device.</p>
        <div className="scope-row" role="group" aria-label="Directory">
          <button
            type="button"
            className={kind === "surgeon" ? "btn-ghost is-on" : "btn-ghost"}
            aria-pressed={kind === "surgeon"}
            onClick={() => setKind("surgeon")}
          >
            Surgeons
          </button>
          <button
            type="button"
            className={kind === "hospital" ? "btn-ghost is-on" : "btn-ghost"}
            aria-pressed={kind === "hospital"}
            onClick={() => setKind("hospital")}
          >
            Hospitals
          </button>
        </div>
        {listed.length === 0 ? <p className="slip-who">No {label}s yet.</p> : null}
        <ul className="directory-list">
          {listed.map((contact) => (
            <li key={contact.id}>
              <button type="button" className="directory-row" onClick={() => onOpen(contact.kind, contact.name)}>
                <strong>{contact.kind === "surgeon" ? displayName(contact.name) : contact.name}</strong>
                <span>
                  {contact.kind === "surgeon" && contact.specialty
                    ? contact.specialty
                    : contact.phone || contact.email || "No phone or email"}
                </span>
              </button>
            </li>
          ))}
        </ul>
        <button type="button" className="btn-ink" onClick={() => onOpen(kind, "")}>
          Add {label}
        </button>
      </div>
    </Sheet>
  );
}

export function ContactPage({
  kind,
  name,
  onClose,
}: {
  kind: ContactKind;
  name: string;
  onClose: () => void;
}) {
  const contacts = useCasebook((state) => state.contacts);
  const addContact = useCasebook((state) => state.addContact);
  const updateContact = useCasebook((state) => state.updateContact);
  const removeContact = useCasebook((state) => state.removeContact);
  const found = name ? contactMatch(contacts, kind, name) : undefined;
  const [editing, setEditing] = useState(!found);
  const [confirm, setConfirm] = useState(false);
  const titleKind = kind === "surgeon" ? "Surgeon" : "Hospital";
  const heading = found ? (kind === "surgeon" ? displayName(found.name) : found.name) : "";

  return (
    <Sheet title={found && !editing ? heading : editing && found ? `Edit ${titleKind.toLowerCase()}` : `New ${titleKind.toLowerCase()}`} onClose={onClose}>
      {found && !editing ? (
        <div className="stack">
          <p className="detail-kicker">{titleKind}</p>
          <dl className="facts">
            {kind === "surgeon" ? (
              <div>
                <dt>Speciality</dt>
                <dd>{found.specialty || "Not recorded"}</dd>
              </div>
            ) : null}
            <div>
              <dt>Phone</dt>
              <dd>
                {found.phone ? (
                  <a href={`tel:${found.phone.replace(/[^\d+]/g, "")}`}>{found.phone}</a>
                ) : (
                  "Not recorded"
                )}
              </dd>
            </div>
            <div>
              <dt>Email</dt>
              <dd>{found.email ? <a href={`mailto:${found.email}`}>{found.email}</a> : "Not recorded"}</dd>
            </div>
          </dl>
          <div className="note-block">
            <p className="lbl">Notes</p>
            <p className="slip-who">{found.notes || "No notes."}</p>
          </div>
          <div className="action-row">
            <button type="button" className="btn-ink" onClick={() => setEditing(true)}>
              Edit
            </button>
            <button type="button" className="btn-text danger" onClick={() => setConfirm(true)}>
              Remove
            </button>
          </div>
        </div>
      ) : (
        <ContactForm
          kind={kind}
          id={found?.id}
          initial={{
            name: found?.name ?? name,
            phone: found?.phone ?? "",
            email: found?.email ?? "",
            specialty: found?.specialty ?? "",
            notes: found?.notes ?? "",
          }}
          onCancel={() => (found ? setEditing(false) : onClose())}
          onSave={(input) => {
            if (found) updateContact(found.id, { kind, ...input });
            else addContact({ kind, ...input });
            onClose();
          }}
        />
      )}
      {confirm && found ? (
        <Confirm
          title={`Remove this ${titleKind.toLowerCase()}?`}
          body="The contact leaves the directory. Procedures that already name them stay as written."
          confirmLabel="Remove"
          onConfirm={() => {
            removeContact(found.id);
            onClose();
          }}
          onCancel={() => setConfirm(false)}
        />
      ) : null}
    </Sheet>
  );
}

function ContactForm({
  kind,
  id,
  initial,
  onSave,
  onCancel,
}: {
  kind: ContactKind;
  id?: string;
  initial: { name: string; phone: string; email: string; specialty: string; notes: string };
  onSave: (input: { name: string; phone: string; email: string; specialty: string; notes: string }) => void;
  onCancel: () => void;
}) {
  const surgeon = kind === "surgeon";
  const [last, setLast] = useState(surgeon ? surname(initial.name) : initial.name);
  const [givenNames, setGivenNames] = useState(surgeon ? given(initial.name) : "");
  const [phone, setPhone] = useState(initial.phone);
  const [email, setEmail] = useState(initial.email);
  const [specialty, setSpecialty] = useState(initial.specialty);
  const [notes, setNotes] = useState(initial.notes);
  const [error, setError] = useState("");
  const label = surgeon ? "Surgeon" : "Hospital";

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const stored = surgeon ? joinName(last, givenNames) : last.trim();
    if (!stored) {
      setError("Name is required.");
      return;
    }
    onSave({
      name: stored,
      phone: phone.trim(),
      email: email.trim(),
      specialty: surgeon ? specialty.trim() : "",
      notes: notes.trim(),
    });
  }

  return (
    <form className="stack" onSubmit={submit}>
      {surgeon ? (
        <>
          <label className="field-block">
            <span className="lbl">Last name</span>
            <input className="field" value={last} onChange={(event) => setLast(event.target.value)} autoFocus required />
          </label>
          <label className="field-block">
            <span className="lbl">Given names</span>
            <input className="field" value={givenNames} onChange={(event) => setGivenNames(event.target.value)} />
          </label>
          <label className="field-block">
            <span className="lbl">Speciality</span>
            <input className="field" value={specialty} onChange={(event) => setSpecialty(event.target.value)} placeholder="Orthopaedics, general, obstetrics" />
          </label>
        </>
      ) : (
        <label className="field-block">
          <span className="lbl">{label}</span>
          <input className="field" value={last} onChange={(event) => setLast(event.target.value)} autoFocus required />
        </label>
      )}
      <label className="field-block">
        <span className="lbl">Phone</span>
        <input className="field" type="tel" inputMode="tel" autoComplete="tel" value={phone} onChange={(event) => setPhone(event.target.value)} />
      </label>
      <label className="field-block">
        <span className="lbl">Email</span>
        <input className="field" type="email" inputMode="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} />
      </label>
      <label className="field-block">
        <span className="lbl">Notes</span>
        <textarea className="area" value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Rooms, switchboard, how to reach them" />
      </label>
      {error ? <p className="form-error">{error}</p> : null}
      <div className="action-row">
        <button type="submit" className="btn-ink">
          {id ? "Save" : `Add ${label.toLowerCase()}`}
        </button>
        <button type="button" className="btn-ghost" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
