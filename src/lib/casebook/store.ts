import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { deleteBlob, sweepOrphanBlobs } from "./files.ts";
import { isValidTimestamp, nextNotesModifiedAt } from "./detail-data.ts";
import { addDaysISO, todayISO } from "./format.ts";
import { LEGACY_PROCEDURE_DATES, SAMPLE_GENDERS, seedContacts, seedPatients } from "./seed.ts";
import type {
  Attachment,
  Consult,
  ConsultInput,
  Contact,
  ContactInput,
  Patient,
  PatientInput,
  Surgery,
  SurgeryInput,
} from "./types";

export const CASEBOOK_STORAGE_KEY = "vellum-casebook-v1";
export const CASEBOOK_SCHEMA_VERSION = 4;
let storageWritesEnabled = true;

type CasebookState = {
  patients: Patient[];
  contacts: Contact[];
  hydrated: boolean;
  storageError: string | null;
  addPatient: (input: PatientInput) => string;
  updatePatient: (id: string, input: PatientInput) => void;
  patchPatient: (id: string, patch: Partial<Pick<Patient, "notes">>) => void;
  removePatient: (id: string) => void;
  addSurgery: (patientId: string, input: SurgeryInput) => string;
  updateSurgery: (patientId: string, surgeryId: string, patch: Partial<SurgeryInput>) => void;
  removeSurgery: (patientId: string, surgeryId: string) => void;
  addConsult: (patientId: string, input: ConsultInput) => string;
  updateConsult: (patientId: string, consultId: string, patch: Partial<ConsultInput>) => void;
  removeConsult: (patientId: string, consultId: string) => void;
  addContact: (input: ContactInput) => string;
  updateContact: (id: string, input: ContactInput) => void;
  removeContact: (id: string) => void;
  replacePatients: (patients: Patient[]) => void;
  replaceContacts: (contacts: Contact[]) => void;
  replaceCasebook: (patients: Patient[], contacts: Contact[]) => void;
  clearSamples: () => void;
};

function dropBlobs(attachments: Attachment[]) {
  for (const file of attachments) void deleteBlob(file.id).catch(() => undefined);
}

function dropPatientFiles(patient: Patient) {
  for (const surgery of patient.surgeries) dropBlobs(surgery.attachments ?? []);
  for (const consult of patient.consults ?? []) dropBlobs(consult.attachments ?? []);
}

function isPatient(value: unknown): value is Patient {
  if (!value || typeof value !== "object") return false;
  const patient = value as Patient;
  const isAttachments = (attachments: unknown) =>
    attachments === undefined ||
    (Array.isArray(attachments) &&
      attachments.every((file) => file && typeof file === "object" && typeof file.id === "string"));
  return (
    typeof patient.id === "string" &&
    typeof patient.name === "string" &&
    Array.isArray(patient.surgeries) &&
    patient.surgeries.every(
      (surgery) =>
        surgery &&
        typeof surgery === "object" &&
        typeof surgery.id === "string" &&
        isAttachments(surgery.attachments),
    ) &&
    (patient.consults === undefined ||
      (Array.isArray(patient.consults) &&
        patient.consults.every(
          (consult) =>
            consult &&
            typeof consult === "object" &&
            typeof consult.id === "string" &&
            isAttachments(consult.attachments),
        )))
  );
}

function procedureDate(id: string, date: string) {
  const legacy = LEGACY_PROCEDURE_DATES[id];
  if (legacy && date === legacy.was) return addDaysISO(todayISO(), legacy.daysAhead);
  return date;
}

function normalizeFiles(value: unknown): Attachment[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const file = item as Attachment;
    if (typeof file.id !== "string") return [];
    const missing = file.notRestored;
    const notRestored =
      missing &&
      typeof missing === "object" &&
      typeof missing.sha256 === "string" &&
      /^[0-9a-f]{64}$/.test(missing.sha256) &&
      typeof missing.addedAt === "string"
        ? { sha256: missing.sha256, addedAt: missing.addedAt.slice(0, 40) }
        : undefined;
    return [
      {
        id: file.id,
        name: typeof file.name === "string" ? file.name : "File",
        mime: typeof file.mime === "string" ? file.mime : "application/octet-stream",
        size: typeof file.size === "number" ? file.size : 0,
        ...(isValidTimestamp(file.addedAt) ? { addedAt: file.addedAt } : {}),
        ...(notRestored ? { notRestored } : {}),
      },
    ];
  });
}

function normalize(patient: Patient): Patient {
  const gender =
    typeof patient.gender === "string" && patient.gender.trim()
      ? patient.gender
      : (SAMPLE_GENDERS[patient.id] ?? "");
  const consults = Array.isArray(patient.consults) ? patient.consults : [];
  const notes = typeof patient.notes === "string" ? patient.notes : "";
  return {
    id: patient.id,
    name: patient.name,
    dob: typeof patient.dob === "string" ? patient.dob : "",
    gender,
    phone: typeof patient.phone === "string" ? patient.phone : "",
    email: typeof patient.email === "string" ? patient.email : "",
    notes,
    ...(notes.trim() && isValidTimestamp(patient.notesModifiedAt)
      ? { notesModifiedAt: patient.notesModifiedAt }
      : {}),
    sample: patient.sample === true,
    surgeries: patient.surgeries
      .filter((surgery) => surgery && typeof surgery.id === "string")
      .map((surgery) => ({
        id: surgery.id,
        date: procedureDate(surgery.id, surgery.date ?? ""),
        surgeon: surgery.surgeon ?? "",
        type: surgery.type ?? "",
        hospital: surgery.hospital ?? "",
        notes: surgery.notes ?? "",
        attachments: normalizeFiles(surgery.attachments),
      })),
    consults: consults
      .filter((consult) => consult && typeof consult.id === "string")
      .map((consult) => ({
        id: consult.id,
        date: typeof consult.date === "string" ? consult.date : "",
        doctor: typeof consult.doctor === "string" ? consult.doctor : "",
        medicalCentre: typeof consult.medicalCentre === "string" ? consult.medicalCentre : "",
        notes: consult.notes ?? "",
        attachments: normalizeFiles(consult.attachments),
      })),
  };
}

function normalizeContact(value: unknown): Contact | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Contact;
  if (item.kind !== "surgeon" && item.kind !== "hospital") return null;
  if (typeof item.name !== "string" || !item.name.trim()) return null;
  return {
    id: typeof item.id === "string" && item.id ? item.id : crypto.randomUUID(),
    kind: item.kind,
    name: item.name.trim(),
    phone: typeof item.phone === "string" ? item.phone : "",
    email: typeof item.email === "string" ? item.email : "",
    specialty: typeof item.specialty === "string" ? item.specialty : "",
    notes: typeof item.notes === "string" ? item.notes : "",
    sample: item.sample === true,
  };
}

function normalizeContacts(value: unknown): Contact[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const contact = normalizeContact(item);
    return contact ? [contact] : [];
  });
}

export function referencedFileIds(patients: Patient[]) {
  return new Set(
    patients.flatMap((patient) => [
      ...patient.surgeries.flatMap((surgery) => surgery.attachments.map((file) => file.id)),
      ...patient.consults.flatMap((consult) => consult.attachments.map((file) => file.id)),
    ]),
  );
}

export function migrateStoredCasebook(raw: string) {
  let envelope: unknown;
  try {
    envelope = JSON.parse(raw);
  } catch {
    throw new Error("Saved casebook data is not valid JSON.");
  }
  if (!envelope || typeof envelope !== "object")
    throw new Error("Saved casebook data has an invalid format.");
  const stored = envelope as { version?: unknown; state?: unknown };
  const version = stored.version === undefined ? 0 : stored.version;
  if (!Number.isInteger(version) || typeof version !== "number" || version < 0) {
    throw new Error("Saved casebook data has an invalid schema version.");
  }
  if (version > CASEBOOK_SCHEMA_VERSION) {
    throw new Error(
      "This casebook was saved by a newer version of Vellum. Update the app before opening it.",
    );
  }
  if (!stored.state || typeof stored.state !== "object") {
    throw new Error("Saved casebook data has an invalid format.");
  }
  const state = stored.state as { patients?: unknown; contacts?: unknown };
  if (!Array.isArray(state.patients) || state.patients.some((patient) => !isPatient(patient))) {
    throw new Error("Saved casebook patients could not be safely read.");
  }
  if (state.contacts !== undefined && !Array.isArray(state.contacts)) {
    throw new Error("Saved casebook contacts could not be safely read.");
  }
  const patients = state.patients.map((patient) => normalize(patient));
  let contacts: Contact[];
  if (Array.isArray(state.contacts)) {
    const normalized = state.contacts.map(normalizeContact);
    if (normalized.some((contact) => contact === null)) {
      throw new Error("Saved casebook contacts could not be safely read.");
    }
    contacts = normalized.filter((contact): contact is Contact => contact !== null);
  } else {
    contacts =
      patients.length > 0 && patients.every((patient) => patient.sample) ? seedContacts() : [];
  }
  return { patients, contacts };
}

function keptFiles(current: Attachment[] | undefined, next: Attachment[] | undefined) {
  if (!next) return;
  const nextIds = new Set(next.map((file) => file.id));
  dropBlobs((current ?? []).filter((file) => !nextIds.has(file.id)));
}

export const useCasebook = create<CasebookState>()(
  persist(
    (set, get) => ({
      patients: seedPatients(),
      contacts: seedContacts(),
      hydrated: false,
      storageError: null,
      addPatient: (input) => {
        const id = crypto.randomUUID();
        const patient: Patient = {
          id,
          ...input,
          notes: "",
          surgeries: [],
          consults: [],
        };
        set((state) => ({ patients: [...state.patients, patient] }));
        return id;
      },
      updatePatient: (id, input) => {
        set((state) => ({
          patients: state.patients.map((patient) =>
            patient.id === id ? { ...patient, ...input } : patient,
          ),
        }));
      },
      patchPatient: (id, patch) => {
        const now = new Date().toISOString();
        set((state) => ({
          patients: state.patients.map((item) => {
            if (item.id !== id) return item;
            if (patch.notes === undefined) return { ...item, ...patch };
            const { notesModifiedAt: _previous, ...rest } = item;
            const modified = nextNotesModifiedAt(item.notes, patch.notes, item.notesModifiedAt, now);
            return { ...rest, ...patch, ...(modified ? { notesModifiedAt: modified } : {}) };
          }),
        }));
      },
      removePatient: (id) => {
        const patient = get().patients.find((item) => item.id === id);
        if (patient) dropPatientFiles(patient);
        set((state) => ({ patients: state.patients.filter((item) => item.id !== id) }));
      },
      addSurgery: (patientId, input) => {
        const id = crypto.randomUUID();
        const surgery: Surgery = { id, ...input };
        set((state) => ({
          patients: state.patients.map((patient) =>
            patient.id === patientId
              ? { ...patient, surgeries: [...patient.surgeries, surgery] }
              : patient,
          ),
        }));
        return id;
      },
      updateSurgery: (patientId, surgeryId, patch) => {
        const patient = get().patients.find((item) => item.id === patientId);
        const current = patient?.surgeries.find((item) => item.id === surgeryId);
        if (current && patch.attachments) keptFiles(current.attachments, patch.attachments);
        set((state) => ({
          patients: state.patients.map((item) =>
            item.id !== patientId
              ? item
              : {
                  ...item,
                  surgeries: item.surgeries.map((surgery) =>
                    surgery.id === surgeryId ? { ...surgery, ...patch } : surgery,
                  ),
                },
          ),
        }));
      },
      removeSurgery: (patientId, surgeryId) => {
        const patient = get().patients.find((item) => item.id === patientId);
        const surgery = patient?.surgeries.find((item) => item.id === surgeryId);
        if (surgery) dropBlobs(surgery.attachments);
        set((state) => ({
          patients: state.patients.map((item) =>
            item.id !== patientId
              ? item
              : { ...item, surgeries: item.surgeries.filter((entry) => entry.id !== surgeryId) },
          ),
        }));
      },
      addConsult: (patientId, input) => {
        const id = crypto.randomUUID();
        const consult: Consult = { id, ...input };
        set((state) => ({
          patients: state.patients.map((patient) =>
            patient.id === patientId
              ? { ...patient, consults: [...patient.consults, consult] }
              : patient,
          ),
        }));
        return id;
      },
      updateConsult: (patientId, consultId, patch) => {
        const patient = get().patients.find((item) => item.id === patientId);
        const current = patient?.consults.find((item) => item.id === consultId);
        if (current && patch.attachments) keptFiles(current.attachments, patch.attachments);
        set((state) => ({
          patients: state.patients.map((item) =>
            item.id !== patientId
              ? item
              : {
                  ...item,
                  consults: item.consults.map((consult) =>
                    consult.id === consultId ? { ...consult, ...patch } : consult,
                  ),
                },
          ),
        }));
      },
      removeConsult: (patientId, consultId) => {
        const patient = get().patients.find((item) => item.id === patientId);
        const consult = patient?.consults.find((item) => item.id === consultId);
        if (consult) dropBlobs(consult.attachments);
        set((state) => ({
          patients: state.patients.map((item) =>
            item.id !== patientId
              ? item
              : { ...item, consults: item.consults.filter((entry) => entry.id !== consultId) },
          ),
        }));
      },
      replacePatients: (patients) => {
        get().replaceCasebook(patients, get().contacts);
      },
      replaceContacts: (contacts) => {
        get().replaceCasebook(get().patients, contacts);
      },
      replaceCasebook: (patients, contacts) => {
        storageWritesEnabled = true;
        const currentPatients = get().patients;
        const nextPatients = patients.map(normalize);
        const retainedIds = new Set(
          nextPatients.flatMap((patient) => [
            ...patient.surgeries.flatMap((surgery) => surgery.attachments.map((file) => file.id)),
            ...patient.consults.flatMap((consult) => consult.attachments.map((file) => file.id)),
          ]),
        );
        const previous = { patients: currentPatients, contacts: get().contacts };
        try {
          set({
            patients: nextPatients,
            contacts: normalizeContacts(contacts),
            storageError: null,
          });
        } catch (error) {
          // The new state could not be saved: put the old one back so nothing is half-swapped.
          try {
            set(previous);
          } catch {
            // Memory is restored even if storage still refuses writes.
          }
          throw error;
        }
        for (const patient of currentPatients) {
          const attachments = [
            ...patient.surgeries.flatMap((surgery) => surgery.attachments),
            ...patient.consults.flatMap((consult) => consult.attachments),
          ];
          dropBlobs(attachments.filter((file) => !retainedIds.has(file.id)));
        }
      },
      addContact: (input) => {
        const id = crypto.randomUUID();
        const contact: Contact = { id, ...input, name: input.name.trim() };
        set((state) => ({ contacts: [...state.contacts, contact] }));
        return id;
      },
      updateContact: (id, input) => {
        set((state) => ({
          contacts: state.contacts.map((contact) =>
            contact.id === id ? { ...contact, ...input, name: input.name.trim() } : contact,
          ),
        }));
      },
      removeContact: (id) => {
        set((state) => ({ contacts: state.contacts.filter((contact) => contact.id !== id) }));
      },
      clearSamples: () => {
        const samples = get().patients.filter((patient) => patient.sample);
        for (const patient of samples) dropPatientFiles(patient);
        set((state) => ({
          patients: state.patients.filter((patient) => !patient.sample),
          contacts: state.contacts.filter((contact) => !contact.sample),
        }));
      },
    }),
    {
      name: CASEBOOK_STORAGE_KEY,
      version: CASEBOOK_SCHEMA_VERSION,
      skipHydration: true,
      storage: createJSONStorage(() => ({
        getItem: (name) => localStorage.getItem(name),
        setItem: (name, value) => {
          if (storageWritesEnabled) localStorage.setItem(name, value);
        },
        removeItem: (name) => localStorage.removeItem(name),
      })),
      partialize: (state) => ({ patients: state.patients, contacts: state.contacts }),
    },
  ),
);

let bootstrapped = false;

export function bootstrapCasebook() {
  if (bootstrapped || typeof window === "undefined") return;
  bootstrapped = true;
  try {
    const raw = localStorage.getItem(CASEBOOK_STORAGE_KEY);
    if (raw) {
      const { patients, contacts } = migrateStoredCasebook(raw);
      storageWritesEnabled = true;
      useCasebook.setState({ patients, contacts, hydrated: true, storageError: null });
      void sweepOrphanBlobs(() => referencedFileIds(useCasebook.getState().patients)).catch(
        () => undefined,
      );
      return;
    }
    storageWritesEnabled = true;
    useCasebook.setState({
      patients: seedPatients(),
      contacts: seedContacts(),
      hydrated: true,
      storageError: null,
    });
    return;
  } catch (error) {
    storageWritesEnabled = false;
    useCasebook.setState({
      patients: [],
      contacts: [],
      hydrated: true,
      storageError:
        error instanceof Error ? error.message : "Saved casebook data could not be read safely.",
    });
  }
}
