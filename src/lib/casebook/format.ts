import type { Consult, Contact, ContactKind, Patient, Surgery } from "./types";

export type SearchField =
  | "all"
  | "name"
  | "dob"
  | "age"
  | "gender"
  | "phone"
  | "email"
  | "procedure"
  | "surgeon"
  | "hospital"
  | "notes";

export const SEARCH_FIELDS: { id: SearchField; label: string; placeholder: string }[] = [
  { id: "all", label: "All fields", placeholder: "Search any field" },
  { id: "name", label: "Name", placeholder: "Filter by name" },
  { id: "dob", label: "Date of birth", placeholder: "Filter by date of birth" },
  { id: "age", label: "Age", placeholder: "Filter by age" },
  { id: "gender", label: "Gender", placeholder: "Filter by gender" },
  { id: "phone", label: "Phone", placeholder: "Filter by phone" },
  { id: "email", label: "Email", placeholder: "Filter by email" },
  { id: "procedure", label: "Procedure", placeholder: "Filter by procedure" },
  { id: "surgeon", label: "Surgeon", placeholder: "Filter by surgeon" },
  { id: "hospital", label: "Hospital", placeholder: "Filter by hospital" },
  { id: "notes", label: "Notes", placeholder: "Filter by notes" },
];

export function surname(name: string) {
  const trimmed = name.trim();
  const comma = trimmed.indexOf(",");
  if (comma >= 0) return trimmed.slice(0, comma).trim() || trimmed;
  const parts = trimmed.split(/\s+/).filter(Boolean);
  return parts[parts.length - 1] ?? trimmed;
}

export function given(name: string) {
  const trimmed = name.trim();
  const comma = trimmed.indexOf(",");
  if (comma >= 0) return trimmed.slice(comma + 1).trim();
  const parts = trimmed.split(/\s+/).filter(Boolean);
  if (parts.length < 2) return "";
  return parts.slice(0, -1).join(" ");
}

export function joinName(last: string, givenNames: string) {
  const family = last.trim().replaceAll(",", "");
  const rest = givenNames.trim().replaceAll(",", "");
  if (!family) return rest;
  return rest ? `${family}, ${rest}` : family;
}

export function displayName(name: string) {
  return joinName(surname(name), given(name));
}

export function initial(name: string) {
  const ch = surname(name)[0]?.toUpperCase() ?? "#";
  return /[A-Z]/.test(ch) ? ch : "#";
}

export function formatDob(iso: string) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  const date = new Date(y, m - 1, d);
  return new Intl.DateTimeFormat("en-AU", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);
}

export function ageFromDob(iso: string, today = new Date()) {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return null;
  let age = today.getFullYear() - y;
  const month = today.getMonth() + 1;
  if (month < m || (month === m && today.getDate() < d)) age -= 1;
  return age >= 0 && age < 130 ? age : null;
}

export function ageLabel(iso: string) {
  const age = ageFromDob(iso);
  if (age == null) return "";
  return age === 1 ? "1 yr" : `${age} yrs`;
}

export function proceduresLabel(count: number) {
  if (count === 0) return "No procedures yet";
  if (count === 1) return "1 procedure";
  return `${count} procedures`;
}

export function attachmentCountLabel(count: number) {
  if (!Number.isInteger(count) || count <= 0) return "";
  return count === 1 ? "1 attachment" : `${count} attachments`;
}

export function attachmentDetail(file: { size: number; notRestored?: unknown }) {
  const size = formatBytes(file.size);
  return file.notRestored ? `Not restored · ${size}` : size;
}

export function formatBytes(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

export function todayISO(today = new Date()) {
  const m = String(today.getMonth() + 1).padStart(2, "0");
  const d = String(today.getDate()).padStart(2, "0");
  return `${today.getFullYear()}-${m}-${d}`;
}

export function addDaysISO(iso: string, days: number) {
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(y || 1970, (m || 1) - 1, d || 1);
  date.setDate(date.getDate() + days);
  return todayISO(date);
}

export type SortKey = "name" | "next" | "latest" | "dob" | "age" | "gender";

export const SORT_OPTIONS: { id: SortKey; label: string }[] = [
  { id: "name", label: "Name" },
  { id: "next", label: "Next procedure" },
  { id: "latest", label: "Latest procedure" },
  { id: "dob", label: "Date of birth" },
  { id: "age", label: "Age" },
  { id: "gender", label: "Gender" },
];

function compareText(a: string, b: string) {
  return a.localeCompare(b, "en", { sensitivity: "base", numeric: true });
}

function nextProcedureDate(patient: Patient, today = todayISO()) {
  const dates = patient.surgeries.map((item) => item.date).filter(Boolean).sort();
  return dates.find((date) => date >= today) ?? "";
}

function latestProcedureDate(patient: Patient) {
  const dates = patient.surgeries.map((item) => item.date).filter(Boolean).sort();
  return dates[dates.length - 1] ?? "";
}

export function sortPatients(list: Patient[], key: SortKey, direction: "asc" | "desc") {
  const sign = direction === "asc" ? 1 : -1;
  return [...list].sort((a, b) => {
    const name = compareText(surname(a.name), surname(b.name)) || compareText(a.name, b.name);
    if (key === "name") return name * sign;
    if (key === "gender") {
      const cmp = compareText(a.gender, b.gender);
      return cmp === 0 ? name : cmp * sign;
    }
    if (key === "dob") {
      if (!a.dob && !b.dob) return name;
      if (!a.dob) return 1;
      if (!b.dob) return -1;
      const cmp = compareText(a.dob, b.dob);
      return cmp === 0 ? name : cmp * sign;
    }
    if (key === "age") {
      const left = ageFromDob(a.dob);
      const right = ageFromDob(b.dob);
      if (left == null && right == null) return name;
      if (left == null) return 1;
      if (right == null) return -1;
      return left === right ? name : (left - right) * sign;
    }
    const left = key === "next" ? nextProcedureDate(a) : latestProcedureDate(a);
    const right = key === "next" ? nextProcedureDate(b) : latestProcedureDate(b);
    if (!left && !right) return name;
    if (!left) return 1;
    if (!right) return -1;
    const cmp = compareText(left, right);
    return cmp === 0 ? name : cmp * sign;
  });
}

export type TimelineEntry =
  | { kind: "procedure"; id: string; date: string; surgery: Surgery }
  | { kind: "consult"; id: string; date: string; consult: Consult };

export function patientTimeline(patient: Patient): TimelineEntry[] {
  const entries: TimelineEntry[] = [
    ...patient.surgeries.map((surgery) => ({
      kind: "procedure" as const,
      id: surgery.id,
      date: surgery.date || "",
      surgery,
    })),
    ...patient.consults.map((consult) => ({
      kind: "consult" as const,
      id: consult.id,
      date: consult.date || "",
      consult,
    })),
  ];
  return entries.sort((a, b) => {
    if (!a.date && !b.date) return b.id.localeCompare(a.id);
    if (!a.date) return 1;
    if (!b.date) return -1;
    return b.date.localeCompare(a.date) || b.id.localeCompare(a.id);
  });
}

export function orderedPatients(list: Patient[]) {
  return [...list].sort((a, b) => {
    const bySurname = surname(a.name).localeCompare(surname(b.name), "en", {
      sensitivity: "base",
    });
    if (bySurname) return bySurname;
    return a.name.localeCompare(b.name, "en", { sensitivity: "base" });
  });
}

export function latestSurgery(patient: Patient) {
  if (patient.surgeries.length === 0) return null;
  return [...patient.surgeries].sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id))[0];
}

export function sortedSurgeries(patient: Patient) {
  return [...patient.surgeries].sort(
    (a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id),
  );
}

export function sortedConsults(patient: Patient) {
  return [...patient.consults].sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));
}

/** Procedure date is after today. */
export function hasUpcomingProcedure(patient: Patient, today = todayISO()) {
  return patient.surgeries.some((item) => item.date > today);
}

/** After today, through seven days from today. */
export function hasProcedureInNextDays(patient: Patient, days = 7, today = todayISO()) {
  const end = addDaysISO(today, days);
  return patient.surgeries.some((item) => item.date > today && item.date <= end);
}

export function patientBlob(patient: Patient) {
  return fieldHaystack(patient, "all");
}

function fieldHaystack(patient: Patient, field: SearchField) {
  const procedures = patient.surgeries;
  const consults = patient.consults ?? [];
  const chunks =
    field === "name"
      ? [patient.name, displayName(patient.name), surname(patient.name), given(patient.name)]
      : field === "dob"
        ? [patient.dob, formatDob(patient.dob)]
        : field === "age"
          ? [ageLabel(patient.dob), String(ageFromDob(patient.dob) ?? "")]
          : field === "gender"
            ? [patient.gender]
            : field === "phone"
              ? [patient.phone, patient.phone.replace(/\s+/g, "")]
              : field === "email"
                ? [patient.email]
                : field === "procedure"
                  ? procedures.map((item) => item.type)
                  : field === "surgeon"
                    ? [...procedures.map((item) => item.surgeon), ...consults.map((item) => item.doctor)]
                    : field === "hospital"
                      ? [...procedures.map((item) => item.hospital), ...consults.map((item) => item.medicalCentre)]
                      : field === "notes"
                        ? [patient.notes, ...procedures.map((item) => item.notes), ...consults.map((item) => item.notes)]
                        : [
                            patient.name,
                            displayName(patient.name),
                            patient.gender,
                            patient.email,
                            patient.phone,
                            patient.phone.replace(/\s+/g, ""),
                            patient.dob,
                            formatDob(patient.dob),
                            ageLabel(patient.dob),
                            patient.notes,
                            ...procedures.flatMap((item) => [
                              item.type,
                              item.surgeon,
                              item.hospital,
                              item.date,
                              formatDob(item.date),
                              item.notes,
                            ]),
                            ...consults.flatMap((item) => [
                              "consult",
                              item.doctor,
                              item.medicalCentre,
                              item.date,
                              formatDob(item.date),
                              item.notes,
                            ]),
                          ];
  return chunks.join(" ").toLowerCase();
}

export function matchesField(patient: Patient, field: SearchField, query: string) {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return fieldHaystack(patient, field).includes(needle);
}

export function knownSurgeons(patients: Patient[]) {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const patient of patients) {
    const entries = [
      ...patient.surgeries.map((surgery) => surgery.surgeon),
      ...(patient.consults ?? []).map((consult) => consult.doctor),
    ];
    for (const entry of entries) {
      const name = entry.trim();
      const key = name.toLowerCase();
      if (!name || seen.has(key)) continue;
      seen.add(key);
      names.push(name);
    }
  }
  return names.sort((a, b) => a.localeCompare(b, "en", { sensitivity: "base" }));
}

export function knownHospitals(patients: Patient[]) {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const patient of patients) {
    const entries = [
      ...patient.surgeries.map((surgery) => surgery.hospital),
      ...(patient.consults ?? []).map((consult) => consult.medicalCentre),
    ];
    for (const entry of entries) {
      const name = entry.trim();
      const key = name.toLowerCase();
      if (!name || seen.has(key)) continue;
      seen.add(key);
      names.push(name);
    }
  }
  return names.sort((a, b) => a.localeCompare(b, "en", { sensitivity: "base" }));
}

export function contactMatch(contacts: Contact[], kind: ContactKind, name: string) {
  const key = name.trim().toLowerCase();
  const shown = displayName(name).toLowerCase();
  if (!key) return undefined;
  return contacts.find((item) => {
    if (item.kind !== kind) return false;
    const stored = item.name.trim().toLowerCase();
    return stored === key || displayName(item.name).toLowerCase() === shown;
  });
}

export function choiceNames(directory: string[], used: string[], extras: string[] = []) {
  const seen = new Set<string>();
  const names: string[] = [];
  const push = (name: string) => {
    const trimmed = name.trim();
    const key = trimmed.toLowerCase();
    if (!trimmed || seen.has(key)) return;
    seen.add(key);
    names.push(trimmed);
  };
  for (const name of directory) push(name);
  for (const name of used) push(name);
  for (const name of extras) push(name);
  return names.sort((a, b) => a.localeCompare(b, "en", { sensitivity: "base" }));
}

export function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
