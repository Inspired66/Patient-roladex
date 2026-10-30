export type Attachment = {
  id: string;
  name: string;
  mime: string;
  size: number;
  // ISO timestamp set when the file was attached. Absent on older files.
  addedAt?: string;
  // Set when the record came from a data-only backup and the file bytes are not on this device.
  // Carries the index fingerprint so later data backups can write the entry unchanged.
  notRestored?: { sha256: string; addedAt: string };
};

export type Surgery = {
  id: string;
  date: string;
  surgeon: string;
  type: string;
  hospital: string;
  notes: string;
  attachments: Attachment[];
};

export type Consult = {
  id: string;
  date: string;
  doctor: string;
  medicalCentre: string;
  notes: string;
  attachments: Attachment[];
};

export type Patient = {
  id: string;
  name: string;
  dob: string;
  gender: string;
  phone: string;
  email: string;
  notes: string;
  // ISO timestamp of the last real change to `notes`. Absent when never edited or when cleared.
  notesModifiedAt?: string;
  sample?: boolean;
  surgeries: Surgery[];
  consults: Consult[];
};

export type PatientInput = {
  name: string;
  dob: string;
  gender: string;
  phone: string;
  email: string;
};

export type SurgeryInput = {
  date: string;
  surgeon: string;
  type: string;
  hospital: string;
  notes: string;
  attachments: Attachment[];
};

export type ConsultInput = {
  date: string;
  doctor: string;
  medicalCentre: string;
  notes: string;
  attachments: Attachment[];
};

export type ContactKind = "surgeon" | "hospital";

export type Contact = {
  id: string;
  kind: ContactKind;
  name: string;
  phone: string;
  email: string;
  specialty: string;
  notes: string;
  sample?: boolean;
};

export type ContactInput = {
  kind: ContactKind;
  name: string;
  phone: string;
  email: string;
  specialty: string;
  notes: string;
};

export type FlyOrigin = {
  top: number;
  left: number;
  width: number;
  height: number;
  rotY: number;
  rotX: number;
};
