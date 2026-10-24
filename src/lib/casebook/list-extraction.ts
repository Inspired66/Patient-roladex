export type SourceBounds = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};

export type ExtractionCandidate = {
  value: string;
  sourceText: string;
  page: number;
  bounds: SourceBounds | null;
  method: string;
};

export type ExtractedField = {
  value: string | null;
  warnings: string[];
  candidates: ExtractionCandidate[];
};

export type NativePatientRecord = {
  patientName: ExtractedField;
  dateOfBirth: ExtractedField;
  gender: ExtractedField;
  phone: ExtractedField;
  email: ExtractedField;
  sourcePage: number;
  sourceBounds: SourceBounds | null;
  warnings: string[];
};

export type NativeExtractionPayload = {
  document: {
    text: string;
    warnings: string[];
    pages: {
      number: number;
      width: number;
      height: number;
      text: string;
      lines: {
        text: string;
        bounds: SourceBounds | null;
        elements: { text: string; bounds: SourceBounds | null }[];
      }[];
    }[];
  };
  records: NativePatientRecord[];
  warnings: string[];
};

export type ImportedPatient = {
  name: string;
  dob: string;
  gender: string;
  phone: string;
  email: string;
  sourcePage: number;
  warnings: string[];
  evidence: Record<"name" | "dob" | "gender" | "phone" | "email", ExtractionCandidate[]>;
};

export function toReviewRows(records: NativePatientRecord[]): ImportedPatient[] {
  return records.map((record) => ({
    name: record.patientName.value ?? "",
    dob: record.dateOfBirth.value ?? "",
    gender: record.gender.value ?? "",
    phone: record.phone.value ?? "",
    email: record.email.value ?? "",
    sourcePage: record.sourcePage,
    warnings: [
      ...new Set([
        ...record.warnings,
        ...record.patientName.warnings,
        ...record.dateOfBirth.warnings,
        ...record.gender.warnings,
        ...record.phone.warnings,
        ...record.email.warnings,
      ]),
    ],
    evidence: {
      name: record.patientName.candidates,
      dob: record.dateOfBirth.candidates,
      gender: record.gender.candidates,
      phone: record.phone.candidates,
      email: record.email.candidates,
    },
  }));
}
