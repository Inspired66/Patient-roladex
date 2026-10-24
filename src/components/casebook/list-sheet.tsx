import { useState } from "react";
import { Sheet } from "@/components/casebook/forms";
import {
  toReviewRows,
  type ImportedPatient,
  type NativeExtractionPayload,
} from "@/lib/casebook/list-extraction";
import { displayName, todayISO } from "@/lib/casebook/format";
import { saveBlob } from "@/lib/casebook/archive";
import { callNative, hasNativeMessageBridge } from "@/lib/casebook/native-bridge";
import { useCasebook } from "@/lib/casebook/store";

async function readNativeList() {
  try {
    const result = await callNative<NativeExtractionPayload>("readList", undefined, 180_000);
    return result
      ? { ok: true, result, message: "" }
      : { ok: false, result: null, message: "The document could not be processed locally." };
  } catch (error) {
    return {
      ok: false,
      result: null,
      message: error instanceof Error ? error.message : "The document could not be processed locally.",
    };
  }
}

function csvCell(value: string) {
  return `"${value.replace(/"/g, '""')}"`;
}

function dobForCard(raw: string) {
  const trimmed = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  const match = trimmed.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (!match) return "";
  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  if (day < 1 || day > 31 || month < 1 || month > 12) return "";
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function evidenceText(candidates: ImportedPatient["evidence"]["name"]) {
  if (!candidates.length) return "No source match — review this value.";
  return candidates
    .map(({ value, sourceText, page, bounds }) => {
      const region = bounds
        ? ` · region ${bounds.left}, ${bounds.top} to ${bounds.right}, ${bounds.bottom}`
        : "";
      return `Candidate ${value} · page ${page}${region}: ${sourceText}`;
    })
    .join(" / ");
}

export function ListSheet({
  onClose,
  onAdded,
}: {
  onClose: () => void;
  onAdded: (firstId: string | null, count: number) => void;
}) {
  const patients = useCasebook((state) => state.patients);
  const addPatient = useCasebook((state) => state.addPatient);
  const [phase, setPhase] = useState<"idle" | "reading" | "review">("idle");
  const [rows, setRows] = useState<ImportedPatient[]>([]);
  const [sourceDocument, setSourceDocument] = useState<NativeExtractionPayload["document"] | null>(
    null,
  );
  const [extractionWarnings, setExtractionWarnings] = useState<string[]>([]);
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const native = hasNativeMessageBridge();

  async function start() {
    setMessage("");
    if (!native) {
      setMessage(
        "Photos and PDFs are read on the phone with Google ML Kit. Install the Android app to upload a list.",
      );
      return;
    }
    setPhase("reading");
    const result = await readNativeList();
    if (!result.ok || !result.result) {
      setPhase("idle");
      if (result.message) setMessage(result.message);
      return;
    }
    const found = toReviewRows(result.result.records);
    setSourceDocument(result.result.document);
    setExtractionWarnings(result.result.warnings);
    if (!found.length) {
      setRows([]);
      setPhase("review");
      return;
    }
    setRows(found);
    setPhase("review");
  }

  async function exportCsv() {
    setSaving(true);
    setMessage("");
    try {
      const csv = [
        ["patient name", "date of birth", "gender", "phone number", "email"].join(","),
        ...rows.map((row) =>
          [displayName(row.name), row.dob, row.gender, row.phone, row.email].map(csvCell).join(","),
        ),
      ].join("\r\n");
      await saveBlob(
        new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" }),
        `patient-details-${todayISO()}.csv`,
        "text/csv",
      );
    } catch (reason) {
      if (!(reason instanceof Error && reason.name === "AbortError")) {
        setMessage(reason instanceof Error ? reason.message : "Could not export the CSV.");
      }
    } finally {
      setSaving(false);
    }
  }

  function updateRow(
    index: number,
    field: "name" | "dob" | "gender" | "phone" | "email",
    value: string,
  ) {
    setRows((current) =>
      current.map((row, item) => (item === index ? { ...row, [field]: value } : row)),
    );
  }

  function addCards() {
    const existingEmails = new Set(
      patients.map((patient) => patient.email.trim().toLowerCase()).filter(Boolean),
    );
    const existingPhones = new Set(
      patients.map((patient) => patient.phone.replace(/\D/g, "")).filter(Boolean),
    );
    const existingNames = new Set(
      patients.map((patient) => displayName(patient.name).toLowerCase()),
    );
    let first: string | null = null;
    let count = 0;
    for (const row of rows) {
      const email = row.email.trim().toLowerCase();
      const phone = row.phone.replace(/\D/g, "");
      const name = displayName(row.name);
      if (!name) continue;
      if (
        (email && existingEmails.has(email)) ||
        (phone && existingPhones.has(phone)) ||
        existingNames.has(name.toLowerCase())
      ) {
        continue;
      }
      const id = addPatient({
        name,
        dob: dobForCard(row.dob),
        gender: row.gender.trim(),
        phone: row.phone.trim(),
        email: row.email.trim(),
      });
      if (!first) first = id;
      count += 1;
      existingNames.add(name.toLowerCase());
      if (email) existingEmails.add(email);
      if (phone) existingPhones.add(phone);
    }
    onAdded(first, count);
  }

  return (
    <Sheet title="Upload list" onClose={onClose}>
      {phase === "review" ? (
        <>
          <p className="sheet-lead">
            {rows.length
              ? `Found ${rows.length} ${rows.length === 1 ? "patient" : "patients"}. Review every value and warning, then export a CSV or add the cards.`
              : "No patient rows were detected. Review the original OCR text and warnings; no values were inferred."}{" "}
            Extraction stays on this phone.
          </p>
          {extractionWarnings.length ? (
            <ul className="extraction-warnings" aria-label="Document warnings">
              {extractionWarnings.map((warning, index) => (
                <li key={`${warning}-${index}`}>{warning}</li>
              ))}
            </ul>
          ) : null}
          {sourceDocument ? (
            <details className="extraction-source">
              <summary>
                Original OCR text · {sourceDocument.pages.length}{" "}
                {sourceDocument.pages.length === 1 ? "page" : "pages"}
              </summary>
              {sourceDocument.pages.map((page) => (
                <div key={page.number}>
                  <strong>Page {page.number}</strong>
                  <pre>{page.text}</pre>
                </div>
              ))}
            </details>
          ) : null}
          <ul className="import-list">
            {rows.map((row, index) => (
              <li key={`${row.name}-${row.sourcePage}-${index}`} className="import-row">
                <div className="import-fields">
                  <label>
                    Patient name
                    <input
                      className="field"
                      value={row.name}
                      onChange={(event) => updateRow(index, "name", event.target.value)}
                    />
                    <small className="import-evidence">{evidenceText(row.evidence.name)}</small>
                  </label>
                  <label>
                    Date of birth
                    <input
                      className="field"
                      value={row.dob}
                      placeholder="Not found"
                      onChange={(event) => updateRow(index, "dob", event.target.value)}
                    />
                    <small className="import-evidence">{evidenceText(row.evidence.dob)}</small>
                  </label>
                  <label>
                    Gender / sex
                    <input
                      className="field"
                      value={row.gender}
                      placeholder="Not stated"
                      onChange={(event) => updateRow(index, "gender", event.target.value)}
                    />
                    <small className="import-evidence">{evidenceText(row.evidence.gender)}</small>
                  </label>
                  <label>
                    Phone number
                    <input
                      className="field"
                      value={row.phone}
                      placeholder="Not found"
                      onChange={(event) => updateRow(index, "phone", event.target.value)}
                    />
                    <small className="import-evidence">{evidenceText(row.evidence.phone)}</small>
                  </label>
                  <label>
                    Email address
                    <input
                      className="field"
                      value={row.email}
                      placeholder="Not found"
                      onChange={(event) => updateRow(index, "email", event.target.value)}
                    />
                    <small className="import-evidence">{evidenceText(row.evidence.email)}</small>
                  </label>
                  {row.warnings.length ? (
                    <ul className="extraction-warnings import-row-warnings">
                      {row.warnings.map((warning, warningIndex) => (
                        <li key={`${warning}-${warningIndex}`}>{warning}</li>
                      ))}
                    </ul>
                  ) : null}
                </div>
                <button
                  type="button"
                  className="btn-text"
                  onClick={() => setRows((current) => current.filter((_, item) => item !== index))}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
          {message ? <p className="form-error">{message}</p> : null}
          <div className="action-row">
            <button
              type="button"
              className="btn-ink"
              disabled={!rows.length || saving}
              onClick={() => void exportCsv()}
            >
              {saving ? "Preparing CSV…" : "Export CSV"}
            </button>
            <button type="button" className="btn-ink" disabled={!rows.length} onClick={addCards}>
              Add {rows.length || ""} {rows.length === 1 ? "card" : "cards"}
            </button>
            <button type="button" className="btn-ghost" onClick={() => setPhase("idle")}>
              Back
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="sheet-lead">
            Upload a photo or PDF of a list. Google ML Kit and Apache OpenNLP process it locally on
            this phone. Check the proposed name, DOB, explicitly stated gender/sex, phone, and email
            before exporting or adding cards.
          </p>
          <button
            type="button"
            className="btn-ink"
            disabled={phase === "reading"}
            onClick={() => void start()}
          >
            {phase === "reading" ? "Reading…" : "Choose photo or PDF"}
          </button>
          {message ? <p className="form-error">{message}</p> : null}
        </>
      )}
    </Sheet>
  );
}
