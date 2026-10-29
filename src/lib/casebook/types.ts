export type Attachment = {
  id: string;
  name: string;
  mime: string;
  size: number;
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
