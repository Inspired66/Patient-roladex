import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { CardFace } from "@/components/casebook/card-face";
import { clamp, hasUpcomingProcedure, initial, surname } from "@/lib/casebook/format";
import type { FlyOrigin, Patient } from "@/lib/casebook/types";

type Metrics = { ppc: number; radius: number; step: number };

const EMPTY_METRICS: Metrics = { ppc: 140, radius: 420, step: 0.62 };

function lettersOf(list: Patient[]) {
  const present = new Set(list.map((patient) => initial(patient.name)));
  const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("").filter((letter) => present.has(letter));
  if (present.has("#")) letters.push("#");
  return letters;
}

export function Wheel({
  patients,
  openId,
  focusId,
  paused,
  onOpen,
}: {
  patients: Patient[];
  openId: string | null;
  focusId: string | null;
  paused: boolean;
  onOpen: (id: string, origin: FlyOrigin) => void;
}) {
  const sceneRef = useRef<HTMLDivElement>(null);
  const cardRefs = useRef<(HTMLDivElement | null)[]>([]);
  const pos = useRef(0);
  const vel = useRef(0);
  const seek = useRef<number | null>(null);
  const metrics = useRef<Metrics>(EMPTY_METRICS);
  const patientsRef = useRef(patients);
  const openIdRef = useRef(openId);
  const pausedRef = useRef(paused);
  const anchorId = useRef<string | null>(patients[0]?.id ?? null);
  const seen = useRef(false);
  const suppressClick = useRef(false);
  const drag = useRef<{ pointerId: number; lastY: number; lastT: number; moved: number } | null>(null);
  const raf = useRef(0);
  const lastTick = useRef(0);
  const activeRef = useRef(0);
  const [active, setActive] = useState(0);
  const [scrub, setScrub] = useState<string | null>(null);
  const scrubRef = useRef<string | null>(null);

  patientsRef.current = patients;
  openIdRef.current = openId;
  pausedRef.current = paused;

  const listKey = patients.map((patient) => patient.id).join("|");
  const letters = lettersOf(patients);
  const current = patients[active];
  const currentLetter = current ? initial(current.name) : "";

  function measure() {
    const height = sceneRef.current?.clientHeight || 480;
    metrics.current = {
      ppc: clamp(height * 0.34, 110, 210),
      radius: clamp(height * 0.78, 280, 560),
      step: height < 460 ? 0.7 : 0.62,
    };
  }

  function layout() {
    const list = patientsRef.current;
    const { radius, step } = metrics.current;
    const position = pos.current;
    const rounded = list.length ? clamp(Math.round(position), 0, list.length - 1) : 0;
    if (rounded !== activeRef.current) {
      activeRef.current = rounded;
      anchorId.current = list[rounded]?.id ?? null;
      setActive(rounded);
    }
    for (let index = 0; index < list.length; index += 1) {
      const el = cardRefs.current[index];
      if (!el) continue;
      const delta = index - position;
      const distance = Math.abs(delta);
      if (distance > 3.2) {
        el.style.visibility = "hidden";
        el.style.pointerEvents = "none";
        continue;
      }
      const angle = delta * step;
      const y = Math.sin(angle) * radius * 0.78;
      const z = (Math.cos(angle) - 1) * radius * 0.95;
      const rotX = (-angle * 180) / Math.PI;
      const scale = clamp(1 - distance * 0.07, 0.78, 1);
      const fade = distance > 2.15 ? clamp(1 - (distance - 2.15) / 0.9, 0, 1) : 1;
      const hidden = list[index]?.id === openIdRef.current;
      el.style.visibility = fade <= 0.02 ? "hidden" : "visible";
      el.style.opacity = hidden ? "0" : String(fade);
      el.style.zIndex = String(100 - Math.round(distance * 10));
      el.style.pointerEvents = distance < 0.85 && !hidden ? "auto" : "none";
      el.style.transform = `translate3d(0px, ${y}px, ${z}px) rotateX(${rotX}deg) scale(${scale})`;
    }
  }

  function wake() {
    if (raf.current) return;
    lastTick.current = performance.now();
    raf.current = requestAnimationFrame(tick);
  }

  function tick(now: number) {
    raf.current = 0;
    const dt = Math.min(34, now - lastTick.current);
    lastTick.current = now;
    const moving = stepPhysics(dt);
    layout();
    if (moving || drag.current) wake();
  }

  function stepPhysics(dt: number) {
    const count = patientsRef.current.length;
    if (count <= 0 || pausedRef.current) return false;
    const max = count - 1;
    if (drag.current) return true;

    if (seek.current != null) {
      const target = clamp(seek.current, 0, max);
      const diff = target - pos.current;
      if (Math.abs(diff) < 0.004) {
        pos.current = target;
        vel.current = 0;
        seek.current = null;
        return false;
      }
      pos.current += diff * (1 - Math.exp(-dt / 140));
      return true;
    }

    pos.current += vel.current * (dt / 1000);
    vel.current *= Math.exp(-dt / 280);

    if (pos.current < 0 || pos.current > max) {
      const edge = pos.current < 0 ? 0 : max;
      pos.current += (edge - pos.current) * (1 - Math.exp(-dt / 90));
      vel.current *= 0.8;
      if (Math.abs(pos.current - edge) < 0.004) {
        pos.current = edge;
        vel.current = 0;
        return false;
      }
      return true;
    }

    if (Math.abs(vel.current) < 0.45) {
      const target = clamp(Math.round(pos.current), 0, max);
      const diff = target - pos.current;
      if (Math.abs(diff) < 0.004) {
        pos.current = target;
        vel.current = 0;
        return false;
      }
      vel.current = 0;
      pos.current += diff * (1 - Math.exp(-dt / 110));
      return true;
    }
    return true;
  }

  function goTo(index: number) {
    const count = patientsRef.current.length;
    if (count === 0) return;
    const target = clamp(index, 0, count - 1);
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    vel.current = 0;
    if (reduce) {
      pos.current = target;
      layout();
      return;
    }
    seek.current = target;
    wake();
  }

  useLayoutEffect(() => {
    const list = patientsRef.current;
    if (list.length === 0) return;
    let index = anchorId.current ? list.findIndex((patient) => patient.id === anchorId.current) : 0;
    if (index < 0) index = 0;
    if (!seen.current || !list.some((patient) => patient.id === anchorId.current)) {
      pos.current = index;
      vel.current = 0;
      seek.current = null;
      anchorId.current = list[index]?.id ?? null;
    }
    seen.current = true;
    measure();
    layout();
  }, [listKey]);

  useLayoutEffect(() => {
    if (!focusId) return;
    const index = patientsRef.current.findIndex((patient) => patient.id === focusId);
    if (index < 0) return;
    anchorId.current = focusId;
    goTo(index);
  }, [focusId]);

  useLayoutEffect(() => {
    if (!paused) return;
    vel.current = 0;
    seek.current = null;
    const max = Math.max(0, patientsRef.current.length - 1);
    pos.current = clamp(Math.round(pos.current), 0, max);
    layout();
  }, [paused]);

  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    const observer = new ResizeObserver(() => {
      measure();
      layout();
    });
    observer.observe(scene);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    return () => {
      if (raf.current) cancelAnimationFrame(raf.current);
    };
  }, []);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (pausedRef.current) return;
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target?.isContentEditable) return;
      if (event.key === "ArrowDown") {
        event.preventDefault();
        goTo(Math.round(pos.current) + 1);
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        goTo(Math.round(pos.current) - 1);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function onPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || paused) return;
    if ((event.target as HTMLElement).closest("[data-rail], a")) return;
    const scene = sceneRef.current;
    if (!scene) return;
    suppressClick.current = false;
    drag.current = {
      pointerId: event.pointerId,
      lastY: event.clientY,
      lastT: performance.now(),
      moved: 0,
    };
    vel.current = 0;
    seek.current = null;
    scene.setPointerCapture(event.pointerId);
    scene.classList.add("is-dragging");
    wake();
  }

  function onPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    const currentDrag = drag.current;
    if (!currentDrag || currentDrag.pointerId !== event.pointerId) return;
    const now = performance.now();
    const dy = event.clientY - currentDrag.lastY;
    const dt = Math.max(8, now - currentDrag.lastT);
    currentDrag.moved += Math.abs(dy);
    currentDrag.lastY = event.clientY;
    currentDrag.lastT = now;
    const max = Math.max(0, patientsRef.current.length - 1);
    let delta = -dy / metrics.current.ppc;
    if ((pos.current <= 0 && delta < 0) || (pos.current >= max && delta > 0)) delta *= 0.32;
    pos.current += delta;
    vel.current = clamp((-dy / dt) * (1000 / metrics.current.ppc) * 1.08, -16, 16);
    layout();
  }

  function endDrag(event: React.PointerEvent<HTMLDivElement>) {
    const currentDrag = drag.current;
    if (!currentDrag || currentDrag.pointerId !== event.pointerId) return;
    suppressClick.current = currentDrag.moved > 8;
    drag.current = null;
    sceneRef.current?.classList.remove("is-dragging");
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      const max = Math.max(0, patientsRef.current.length - 1);
      vel.current = 0;
      pos.current = clamp(Math.round(pos.current), 0, max);
      layout();
      return;
    }
    wake();
  }

  function openCard(patient: Patient, index: number, element: HTMLElement) {
    if (suppressClick.current) return;
    const rect = element.getBoundingClientRect();
    const delta = index - pos.current;
    const angle = delta * metrics.current.step;
    onOpen(patient.id, {
      top: rect.top,
      left: rect.left,
      width: rect.width,
      height: rect.height,
      rotY: 0,
      rotX: (-angle * 180) / Math.PI,
    });
  }

  function scrubTo(clientY: number, rect: DOMRect) {
    if (letters.length === 0) return;
    const ratio = clamp((clientY - rect.top) / rect.height, 0, 0.999);
    const letter = letters[Math.floor(ratio * letters.length)];
    if (!letter) return;
    if (scrubRef.current !== letter) {
      scrubRef.current = letter;
      setScrub(letter);
    }
    const index = patientsRef.current.findIndex((patient) => initial(patient.name) === letter);
    if (index >= 0) {
      vel.current = 0;
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (reduce) {
        pos.current = index;
        layout();
      } else {
        seek.current = index;
        wake();
      }
    }
  }

  return (
    <div className="wheel-root">
      <div
        className="wheel-scene"
        ref={sceneRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        role="region"
        aria-roledescription="carousel"
        aria-label="Patient carousel"
      >
        <div className="wheel-world">
          <div className="wheel-floor" />
          <div className="wheel-rig">
            {patients.map((patient, index) => (
              <div
                key={patient.id}
                className={hasUpcomingProcedure(patient) ? "case-card is-soon" : "case-card"}
                ref={(element) => {
                  cardRefs.current[index] = element;
                }}
              >
                <span className="case-tab">{initial(patient.name)}</span>
                <CardFace
                  patient={patient}
                  current={index === active}
                  onOpen={() => {
                    const el = cardRefs.current[index];
                    if (el) openCard(patient, index, el);
                  }}
                />
              </div>
            ))}
          </div>
        </div>
        {scrub ? <div className="scrub-badge">{scrub}</div> : null}
      </div>
      <div
        className="letter-rail"
        data-rail
        aria-hidden={letters.length < 2}
        onPointerDown={(event) => {
          if (letters.length < 2) return;
          event.stopPropagation();
          event.currentTarget.setPointerCapture(event.pointerId);
          scrubTo(event.clientY, event.currentTarget.getBoundingClientRect());
        }}
        onPointerMove={(event) => {
          if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
          scrubTo(event.clientY, event.currentTarget.getBoundingClientRect());
        }}
        onPointerUp={() => {
          scrubRef.current = null;
          setScrub(null);
        }}
        onPointerCancel={() => {
          scrubRef.current = null;
          setScrub(null);
        }}
      >
        {letters.map((letter) => (
          <span key={letter} className={letter === currentLetter ? "is-on" : undefined}>
            {letter}
          </span>
        ))}
      </div>
      <div className="wheel-footer">
        <button
          type="button"
          className="icon-btn"
          aria-label="Previous patient"
          disabled={active <= 0}
          onClick={() => goTo(active - 1)}
        >
          <ChevronUp />
        </button>
        <p className="wheel-meta">
          <strong>{current ? surname(current.name) : ""}</strong>
          {patients.length ? ` · ${active + 1} of ${patients.length}` : ""}
        </p>
        <button
          type="button"
          className="icon-btn"
          aria-label="Next patient"
          disabled={active >= patients.length - 1}
          onClick={() => goTo(active + 1)}
        >
          <ChevronDown />
        </button>
      </div>
    </div>
  );
}
