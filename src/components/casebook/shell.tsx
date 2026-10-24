import { useEffect, useLayoutEffect, useMemo, useState } from "react";
import { Archive, BookUser, ListPlus, Plus, Search } from "lucide-react";
import { ListSheet } from "@/components/casebook/list-sheet";
import { ArchiveSheet } from "@/components/casebook/archive-sheet";
import { MigrationNotice } from "@/components/casebook/migration-page";
import { PatientDetail } from "@/components/casebook/detail";
import { ContactPage, DirectorySheet } from "@/components/casebook/directory";
import { Confirm, ConsultForm, PatientForm, SurgeryForm } from "@/components/casebook/forms";
import { Wheel } from "@/components/casebook/wheel";
import { installBackBridge, useBackLayer } from "@/lib/casebook/back";
import {
  hasProcedureInNextDays,
  hasUpcomingProcedure,
  matchesField,
  orderedPatients,
  SEARCH_FIELDS,
  SORT_OPTIONS,
  sortPatients,
  type SearchField,
  type SortKey,
} from "@/lib/casebook/format";
import { bootstrapCasebook, useCasebook } from "@/lib/casebook/store";
import type { ContactKind, FlyOrigin } from "@/lib/casebook/types";

type FormState =
  | { kind: "patient"; id?: string }
  | { kind: "surgery"; patientId: string; surgeryId?: string }
  | { kind: "consult"; patientId: string; consultId?: string }
  | null;

type ListFilter = "week" | "future" | null;

export function Casebook() {
  const patients = useCasebook((state) => state.patients);
  const hydrated = useCasebook((state) => state.hydrated);
  const storageError = useCasebook((state) => state.storageError);
  const clearSamples = useCasebook((state) => state.clearSamples);
  const [query, setQuery] = useState("");
  const [field, setField] = useState<SearchField>("all");
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [findOpen, setFindOpen] = useState(false);
  const [listFilter, setListFilter] = useState<ListFilter>(null);
  const [open, setOpen] = useState<{ id: string; origin: FlyOrigin } | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(null);
  const [confirmSamples, setConfirmSamples] = useState(false);
  const [archive, setArchive] = useState(false);
  const [directory, setDirectory] = useState(false);
  const [listOpen, setListOpen] = useState(false);
  const [contact, setContact] = useState<{ kind: ContactKind; name: string } | null>(null);

  useLayoutEffect(() => {
    if (
      typeof window !== "undefined" &&
      new URLSearchParams(window.location.search).has("migration")
    ) {
      return;
    }
    bootstrapCasebook();
  }, []);

  useEffect(() => installBackBridge(), []);

  const ordered = useMemo(() => orderedPatients(patients), [patients]);
  const searched = useMemo(
    () => ordered.filter((patient) => matchesField(patient, field, query)),
    [ordered, field, query],
  );
  const weekCount = useMemo(
    () => searched.filter((patient) => hasProcedureInNextDays(patient)).length,
    [searched],
  );
  const futureCount = useMemo(
    () => searched.filter((patient) => hasUpcomingProcedure(patient)).length,
    [searched],
  );
  const filtered = useMemo(() => {
    if (listFilter === "week") return searched.filter((patient) => hasProcedureInNextDays(patient));
    if (listFilter === "future") return searched.filter((patient) => hasUpcomingProcedure(patient));
    return searched;
  }, [searched, listFilter]);
  const sorted = useMemo(
    () => sortPatients(filtered, sortKey, sortDir),
    [filtered, sortKey, sortDir],
  );

  if (storageError) {
    return (
      <main className="app-frame">
        <section className="form-error" role="alert">
          <h1>Casebook data needs attention</h1>
          <p>{storageError}</p>
          <p>
            Your saved data has been left unchanged. Update Vellum or restore a verified archive
            before continuing.
          </p>
        </section>
      </main>
    );
  }

  const openPatient = open ? patients.find((patient) => patient.id === open.id) : undefined;
  const hasSamples = patients.some((patient) => patient.sample);
  const searching = query.trim().length > 0;
  const fieldMeta = SEARCH_FIELDS.find((item) => item.id === field) ?? SEARCH_FIELDS[0];

  function toggleList(next: Exclude<ListFilter, null>) {
    setListFilter((current) => (current === next ? null : next));
  }

  function clearNarrowing() {
    setQuery("");
    setField("all");
    setListFilter(null);
    setSortKey("name");
    setSortDir("asc");
  }

  const tuned = Boolean(
    query.trim() || field !== "all" || listFilter || sortKey !== "name" || sortDir !== "asc",
  );

  return (
    <main className="app-frame" data-ready={hydrated ? "true" : "false"}>
      <header className="flex items-start justify-between gap-3">
        <div>
          <p className="eyebrow">Casebook</p>
          <h1 className="wordmark">Vellum</h1>
        </div>
        <div className="header-actions">
          <button
            type="button"
            className={findOpen || tuned ? "icon-btn is-on" : "icon-btn"}
            aria-label="Search, filter, and sort"
            aria-pressed={findOpen}
            onClick={() => setFindOpen((value) => !value)}
          >
            <Search aria-hidden />
          </button>
          <button
            type="button"
            className="icon-btn"
            aria-label="Directory"
            onClick={() => setDirectory(true)}
          >
            <BookUser aria-hidden />
          </button>
          <button
            type="button"
            className="icon-btn"
            aria-label="Archive"
            onClick={() => setArchive(true)}
          >
            <Archive aria-hidden />
          </button>
          <button
            type="button"
            className="icon-btn"
            aria-label="Upload list"
            onClick={() => setListOpen(true)}
          >
            <ListPlus aria-hidden />
          </button>
          <button
            type="button"
            className="icon-btn"
            aria-label="Add patient"
            onClick={() => setForm({ kind: "patient" })}
          >
            <Plus aria-hidden />
          </button>
        </div>
      </header>
      <MigrationNotice />
      <FindPanel open={findOpen} onClose={() => setFindOpen(false)}>
        <div className="find-bar">
          <label className="field-filter">
            <span className="sr-only">Filter field</span>
            <select
              className="field-select"
              value={field}
              aria-label="Filter field"
              onChange={(event) => setField(event.target.value as SearchField)}
            >
              {SEARCH_FIELDS.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
          <form className="search" role="search" onSubmit={(event) => event.preventDefault()}>
            <Search aria-hidden size={18} />
            <input
              id="patient-search"
              className="search-field"
              placeholder={fieldMeta.placeholder}
              value={query}
              aria-label="Search patients"
              onChange={(event) => setQuery(event.target.value)}
            />
          </form>
        </div>
        <div className="sort-row">
          <label className="field-filter">
            <span className="sr-only">Sort carousel</span>
            <select
              className="field-select"
              value={sortKey}
              aria-label="Sort carousel"
              onChange={(event) => setSortKey(event.target.value as SortKey)}
            >
              {SORT_OPTIONS.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="btn-ghost"
            aria-pressed={sortDir === "desc"}
            onClick={() => setSortDir((value) => (value === "asc" ? "desc" : "asc"))}
          >
            {sortDir === "asc" ? "Ascending" : "Descending"}
          </button>
        </div>
        <div className="census" role="group" aria-label="Procedure lists">
          <button
            type="button"
            className={listFilter === "week" ? "is-on" : undefined}
            aria-pressed={listFilter === "week"}
            onClick={() => toggleList("week")}
          >
            <strong>{weekCount}</strong>
            <span>Next 7 days</span>
          </button>
          <button
            type="button"
            className={listFilter === "future" ? "is-on" : undefined}
            aria-pressed={listFilter === "future"}
            onClick={() => toggleList("future")}
          >
            <strong>{futureCount}</strong>
            <span>Future</span>
          </button>
        </div>
      </FindPanel>
      <div className="stage">
        {!hydrated && patients.length === 0 ? (
          <div className="wheel-root" />
        ) : sorted.length === 0 ? (
          <div className="empty-wrap">
            <div className="empty-card">
              <p className="eyebrow on-paper">{searching || listFilter ? "Filter" : "Casebook"}</p>
              <h2>
                {listFilter === "week"
                  ? "Nothing in the next 7 days"
                  : listFilter === "future"
                    ? "Nothing booked ahead"
                    : searching
                      ? "No matching patients"
                      : "The list is empty"}
              </h2>
              <p>
                {listFilter || searching
                  ? "Try another field, or show the full casebook."
                  : "Add a card. Last name is enough. Procedures, consults, notes, and files stay on this device."}
              </p>
              {listFilter || searching || field !== "all" ? (
                <button type="button" className="btn-ink" onClick={clearNarrowing}>
                  Show everyone
                </button>
              ) : (
                <button
                  type="button"
                  className="btn-ink"
                  onClick={() => setForm({ kind: "patient" })}
                >
                  Add patient
                </button>
              )}
            </div>
          </div>
        ) : (
          <Wheel
            patients={sorted}
            openId={open?.id ?? null}
            focusId={focusId}
            paused={Boolean(open || form || archive || directory || contact || listOpen)}
            onOpen={(id, origin) => setOpen({ id, origin })}
          />
        )}
      </div>
      <p className="device-note">
        On this device only. Not a hospital record.
        {hasSamples ? (
          <button type="button" onClick={() => setConfirmSamples(true)}>
            Remove samples
          </button>
        ) : null}
      </p>
      {open && openPatient ? (
        <PatientDetail
          patient={openPatient}
          origin={open.origin}
          lane={sorted.map((item) => item.id)}
          onShift={(id) => setOpen((current) => (current ? { ...current, id } : current))}
          onClose={() => setOpen(null)}
          onEditPatient={() => setForm({ kind: "patient", id: openPatient.id })}
          onAddSurgery={() => setForm({ kind: "surgery", patientId: openPatient.id })}
          onEditSurgery={(surgeryId) =>
            setForm({ kind: "surgery", patientId: openPatient.id, surgeryId })
          }
          onAddConsult={() => setForm({ kind: "consult", patientId: openPatient.id })}
          onEditConsult={(consultId) =>
            setForm({ kind: "consult", patientId: openPatient.id, consultId })
          }
          onOpenContact={(kind, name) => setContact({ kind, name })}
        />
      ) : null}
      {form?.kind === "patient" ? (
        <PatientForm
          patientId={form.id}
          onClose={() => setForm(null)}
          onSaved={(id) => {
            clearNarrowing();
            setFocusId(id);
            setForm(null);
          }}
        />
      ) : null}
      {form?.kind === "surgery" ? (
        <SurgeryForm
          patientId={form.patientId}
          surgeryId={form.surgeryId}
          onClose={() => setForm(null)}
        />
      ) : null}
      {form?.kind === "consult" ? (
        <ConsultForm
          patientId={form.patientId}
          consultId={form.consultId}
          onClose={() => setForm(null)}
        />
      ) : null}
      {archive ? (
        <ArchiveSheet everyone={ordered} listed={sorted} onClose={() => setArchive(false)} />
      ) : null}
      {directory ? (
        <DirectorySheet
          onClose={() => setDirectory(false)}
          onOpen={(kind, name) => {
            setContact({ kind, name });
          }}
        />
      ) : null}
      {listOpen ? (
        <ListSheet
          onClose={() => setListOpen(false)}
          onAdded={(id, count) => {
            setListOpen(false);
            if (count > 0) {
              clearNarrowing();
              if (id) setFocusId(id);
            }
          }}
        />
      ) : null}
      {contact ? (
        <ContactPage kind={contact.kind} name={contact.name} onClose={() => setContact(null)} />
      ) : null}
      {confirmSamples ? (
        <Confirm
          title="Remove sample patients?"
          body="The fictional cards will leave this device. Patients you added stay."
          confirmLabel="Remove samples"
          onConfirm={() => {
            clearSamples();
            setConfirmSamples(false);
            if (openPatient?.sample) setOpen(null);
          }}
          onCancel={() => setConfirmSamples(false)}
        />
      ) : null}
    </main>
  );
}

function FindPanel({
  open,
  onClose,
  children,
}: {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
}) {
  useBackLayer(open, onClose);
  if (!open) return null;
  return <div className="find-panel">{children}</div>;
}
