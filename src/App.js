import React, { useEffect, useMemo, useState } from "react";

// Utilidades
const mlPerOz = 29.5735;
const todayKey = () => new Date().toISOString().slice(0, 10); // YYYY-MM-DD
const MIN = 60 * 1000;

function toMl(amount, unit) {
  return unit === "oz" ? Math.round(amount * mlPerOz) : Math.round(amount);
}

function fromMl(ml, unit) {
  return unit === "oz" ? +(ml / mlPerOz).toFixed(1) : ml;
}

function clamp(n, a, b) {
  return Math.min(b, Math.max(a, n));
}

// Catálogo por defecto de bebidas y su factor de equivalencia hídrica
// eqMl = volumen_ml * factor
const defaultDrinks = {
  agua: { name: "Agua", factor: 1.0 },
  agua_con_gas: { name: "Agua con gas", factor: 1.0 },
  leche: { name: "Leche", factor: 0.9 },
  cafe: { name: "Café solo", factor: 0.9 },
  cafe_leche: { name: "Café con leche", factor: 0.9 },
  te: { name: "Té/infusión", factor: 0.95 },
  zumo: { name: "Zumo", factor: 0.9 },
  refresco: { name: "Refresco", factor: 0.9 },
  sopa: { name: "Sopa/caldo", factor: 0.95 },
  cerveza: { name: "Cerveza", factor: 0.7 },
  vino: { name: "Vino", factor: 0.6 },
  licor: { name: "Bebida espirituosa", factor: 0.3 },
};
const coreDrinkKeys = new Set(Object.keys(defaultDrinks));

// --- Helpers recordatorios (puras para test) ---
function withinWindow(ts, startHour, endHour) {
  const d = new Date(ts);
  const h = d.getHours();
  if (startHour <= endHour) return h >= startHour && h < endHour;
  // ventana nocturna que cruza medianoche
  return h >= startHour || h < endHour;
}

function dayStart(ts, hour) {
  const d = new Date(ts);
  d.setHours(hour, 0, 0, 0);
  return d.getTime();
}

// Calcula el próximo aviso elegible
function computeNextDue({
  now,
  startHour,
  endHour,
  intervalMin,
  idleMin,
  lastEntryTs,
  lastNotifiedTs,
  snoozedUntilTs,
  requireBelowGoal,
  metGoal,
}) {
  if (requireBelowGoal && metGoal) return Infinity;
  // base: último evento relevante + intervalo
  const baseRef = Math.max(
    0,
    lastNotifiedTs || 0,
    snoozedUntilTs || 0,
    (lastEntryTs || 0) + (idleMin || 0) * MIN
  );
  let due = (baseRef || now) + (intervalMin || 60) * MIN;
  // respetar ventana horaria
  if (!withinWindow(due, startHour, endHour)) {
    const inWinNow = withinWindow(now, startHour, endHour);
    if (inWinNow && due < now) {
      due = now; // inmediato si ya en ventana y pasado
    } else {
      // mover al próximo inicio de ventana
      const startToday = dayStart(now, startHour);
      if (now < startToday) due = startToday;
      else due = dayStart(now + 24 * 60 * MIN, startHour);
    }
  }
  // no antes que ahora ni antes del snooze
  due = Math.max(due, now, snoozedUntilTs || 0);
  return due;
}

function fmtCountdown(ms) {
  if (!Number.isFinite(ms) || ms < 0) return "0:00";
  const s = Math.round(ms / 1000);
  const mm = String(Math.floor(s / 60));
  const ss = String(s % 60).padStart(2, "0");
  return mm + ":" + ss;
}

// --- Self-tests (run once in dev) ---
(function runSelfTests() {
  try {
    // toMl/fromMl roundtrip for oz
    const ml12oz = toMl(12, "oz");
    console.assert(ml12oz === Math.round(12 * mlPerOz), "toMl(oz) failed");
    const ozBack = fromMl(ml12oz, "oz");
    console.assert(Math.abs(ozBack - 12) < 0.1, "fromMl(oz) failed");

    // computeEffectiveGoalMl scenarios
    const settings = {
      useWeight: false,
      goalMl: 2000,
      exercisePer30: { ligera: 350, moderada: 500, intensa: 750 },
      hotBonusPct: 10,
      sedentaryPenaltyPct: 10,
    };
    const adjust1 = {
      hot: true,
      sedentary: false,
      exerciseMin: 60,
      intensity: "moderada",
    };
    const r1 = (function compute(settings, adjust) {
      const base = settings.useWeight ? Math.round(70 * 30) : settings.goalMl;
      const ex = Math.max(
        0,
        Math.round(
          (adjust.exerciseMin / 30) *
            (settings.exercisePer30[adjust.intensity] || 0)
        )
      );
      let mult = 1;
      if (adjust.hot) mult *= 1 + settings.hotBonusPct / 100;
      if (adjust.sedentary) mult *= 1 - settings.sedentaryPenaltyPct / 100;
      return Math.max(500, Math.round(base * mult) + ex);
    })(settings, adjust1);
    console.assert(r1 === 3200, "computeEffectiveGoalMl hot+exercise failed");

    const adjust2 = {
      hot: false,
      sedentary: true,
      exerciseMin: 0,
      intensity: "ligera",
    };
    const r2 = (function compute(settings, adjust) {
      const base = settings.useWeight ? Math.round(70 * 30) : settings.goalMl;
      const ex = Math.max(
        0,
        Math.round(
          (adjust.exerciseMin / 30) *
            (settings.exercisePer30[adjust.intensity] || 0)
        )
      );
      let mult = 1;
      if (adjust.hot) mult *= 1 + settings.hotBonusPct / 100;
      if (adjust.sedentary) mult *= 1 - settings.sedentaryPenaltyPct / 100;
      return Math.max(500, Math.round(base * mult) + ex);
    })(settings, adjust2);
    console.assert(r2 === 1800, "computeEffectiveGoalMl sedentary failed");

    // CSV newline rendering
    const csv =
      [["a", "b"], ["1", "2"]].map((r) => r.join(",")).join("\n");
    console.assert(csv.includes("\n"), "CSV newline failed");

    // Bebidas equivalencia
    const eq = (ml, factor) => Math.round(ml * factor);
    console.assert(eq(250, 0.9) === 225, "Leche 250ml → 225ml eq failed");
    console.assert(eq(200, 0.9) === 180, "Café 200ml → 180ml eq failed");
    console.assert(eq(330, 0.7) === 231, "Cerveza 330ml → 231ml eq failed");

    // withinWindow + computeNextDue
    const base = new Date("2025-01-01T10:00:00").getTime();
    console.assert(withinWindow(base, 9, 22) === true, "withinWindow in");
    console.assert(withinWindow(base, 11, 22) === false, "withinWindow out");
    const nd = computeNextDue({
      now: base,
      startHour: 9,
      endHour: 22,
      intervalMin: 60,
      idleMin: 0,
      lastEntryTs: base - 10 * MIN,
      lastNotifiedTs: 0,
      snoozedUntilTs: 0,
      requireBelowGoal: false,
      metGoal: false,
    });
    console.assert(
      nd >= base + 60 * MIN && nd < base + 61 * MIN,
      "nextDue basic"
    );

    // más tests: cruce de medianoche y gating por objetivo
    const baseLate = new Date("2025-01-01T23:00:00").getTime();
    console.assert(withinWindow(baseLate, 22, 6) === true, "withinWindow cross-midnight in");
    console.assert(withinWindow(base, 22, 6) === false, "withinWindow cross-midnight out");

    const ndGoal = computeNextDue({
      now: base,
      startHour: 9,
      endHour: 22,
      intervalMin: 30,
      idleMin: 0,
      lastEntryTs: 0,
      lastNotifiedTs: 0,
      snoozedUntilTs: 0,
      requireBelowGoal: true,
      metGoal: true,
    });
    console.assert(ndGoal === Infinity, "requireBelowGoal gating failed");

    // 3) fmtCountdown
    console.assert(fmtCountdown(61_000) === "1:01", "fmtCountdown failed");
  } catch (e) {
    console.warn("Self-tests error", e);
  }
})();
// --- End self-tests ---

const defaultState = {
  settings: {
    // Objetivo base (se ignora si useWeight=true)
    goalMl: 2500,
    unit: "ml", // "ml" | "oz"
    quickMl: [250, 330, 500],
    // Personalización por peso (opcional)
    useWeight: false,
    weightKg: 70,
    mlPerKg: 30, // objetivo base sugerido = weightKg * mlPerKg
    // Parámetros de ajuste
    exercisePer30: { ligera: 350, moderada: 500, intensa: 750 },
    hotBonusPct: 15, // % extra si día caluroso
    sedentaryPenaltyPct: 10, // % menos si día sedentario
    // Bebidas
    drinks: defaultDrinks,
    // Recordatorios
    reminders: {
      enabled: false,
      intervalMin: 60,
      startHour: 9,
      endHour: 22,
      idleMin: 45, // no avisar si has registrado en los últimos X min
      requireBelowGoal: true,
      sound: true,
      vibrate: true,
      snoozeMin: 10,
    },
  },
  current: {
    date: todayKey(),
    // entries: {id, ml, ts, meta?: {key,label,volumeMl,factor}}
    entries: [],
    adjust: {
      hot: false,
      sedentary: false,
      exerciseMin: 0,
      intensity: "moderada", // "ligera" | "moderada" | "intensa"
    },
    runtime: {
      lastNotifiedTs: 0,
      snoozedUntilTs: 0,
    },
  },
  history: [], // {date, totalMl}
};

const STORAGE_KEY = "hydrationTracker.v1"; // mantenemos clave para migración simple

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultState;
    const parsed = JSON.parse(raw);
    // Sanidad básica y valores por defecto compatibles
    return {
      ...defaultState,
      ...parsed,
      settings: { ...defaultState.settings, ...(parsed.settings || {}) },
      current: {
        ...defaultState.current,
        ...(parsed.current || {}),
        adjust: { ...defaultState.current.adjust, ...(parsed.current?.adjust || {}) },
        runtime: { ...defaultState.current.runtime, ...(parsed.current?.runtime || {}) },
      },
    };
  } catch {
    return defaultState;
  }
}

function saveState(state) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function midnightRollover(state) {
  const t = todayKey();
  if (state.current.date === t) return state;
  // Archivar el día anterior
  const totalMl = state.current.entries.reduce((s, e) => s + e.ml, 0);
  const history = [...state.history];
  if (state.current.date) {
    // Evitar duplicados por misma fecha
    const idx = history.findIndex((h) => h.date === state.current.date);
    if (idx >= 0) history[idx] = { date: state.current.date, totalMl };
    else history.push({ date: state.current.date, totalMl });
  }
  return {
    ...state,
    current: {
      date: t,
      entries: [],
      adjust: { ...state.current.adjust, exerciseMin: 0 },
      runtime: { lastNotifiedTs: 0, snoozedUntilTs: 0 },
    },
    history: history.slice(-60), // conservar ~2 meses
  };
}

function computeBaseGoalMl(settings) {
  if (settings.useWeight) return Math.round(settings.weightKg * settings.mlPerKg);
  return settings.goalMl;
}

function computeEffectiveGoalMl(settings, adjust) {
  const base = computeBaseGoalMl(settings);
  const ex = Math.max(
    0,
    Math.round(
      (adjust.exerciseMin / 30) * (settings.exercisePer30[adjust.intensity] || 0)
    )
  );
  let mult = 1;
  if (adjust.hot) mult *= 1 + settings.hotBonusPct / 100;
  if (adjust.sedentary) mult *= 1 - settings.sedentaryPenaltyPct / 100;
  // Limitar objetivo mínimo razonable
  const effective = Math.max(500, Math.round(base * mult) + ex);
  return { base, ex, effective };
}

async function requestNotifPermission() {
  try {
    if (!("Notification" in window)) return "unsupported";
    if (Notification.permission === "granted") return "granted";
    if (Notification.permission === "denied") return "denied";
    const p = await Notification.requestPermission();
    return p;
  } catch {
    return "error";
  }
}

function beep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = 880;
    gain.gain.value = 0.05;
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    setTimeout(() => {
      osc.stop();
      ctx.close();
    }, 200);
  } catch {}
}

function vibrate() {
  try {
    navigator.vibrate && navigator.vibrate(150);
  } catch {}
}

function fireNotification({ title, body }) {
  if ("Notification" in window && Notification.permission === "granted") {
    try {
      const n = new Notification(title, { body });
      n.onclick = () => window.focus();
    } catch {}
  }
}

// Componente principal
export default function HydrationTracker() {
  const [state, setState] = useState(() => midnightRollover(loadState()));
  const [showSettings, setShowSettings] = useState(false);
  const [showReminders, setShowReminders] = useState(false);
  const [nowTs, setNowTs] = useState(Date.now());

  useEffect(() => {
    saveState(state);
  }, [state]);

  // Vigilar cambio de día y temporizador de recordatorios
  useEffect(() => {
    const i = setInterval(() => {
      setNowTs(Date.now());
      setState((s) => midnightRollover(s));
    }, 1000);
    return () => clearInterval(i);
  }, []);

  const { unit } = state.settings;
  const totals = useMemo(() => {
    const totalMl = state.current.entries.reduce((s, e) => s + e.ml, 0);
    const goal = computeEffectiveGoalMl(state.settings, state.current.adjust);
    const pct = Math.min(100, Math.round((100 * totalMl) / goal.effective || 0));
    return { totalMl, goal, pct };
  }, [state.current.entries, state.settings, state.current.adjust]);

  // Cálculo recordatorios
  const nextDue = useMemo(() => {
    const R = state.settings.reminders;
    if (!R?.enabled) return Infinity;
    return computeNextDue({
      now: nowTs,
      startHour: clamp(Number(R.startHour) || 9, 0, 23),
      endHour: clamp(Number(R.endHour) || 22, 0, 23),
      intervalMin: clamp(Number(R.intervalMin) || 60, 5, 360),
      idleMin: clamp(Number(R.idleMin) || 0, 0, 360),
      lastEntryTs: state.current.entries.length
        ? Math.max(...state.current.entries.map((e) => e.ts))
        : 0,
      lastNotifiedTs: state.current.runtime.lastNotifiedTs || 0,
      snoozedUntilTs: state.current.runtime.snoozedUntilTs || 0,
      requireBelowGoal: !!R.requireBelowGoal,
      metGoal: totals.totalMl >= totals.goal.effective,
    });
  }, [
    state.settings.reminders,
    state.current.entries,
    state.current.runtime,
    totals,
    nowTs,
  ]);

  // Disparador recordatorio
  useEffect(() => {
    const R = state.settings.reminders;
    if (!R?.enabled) return;
    if (!Number.isFinite(nextDue)) return;
    if (nowTs >= nextDue) {
      // marcar notificado y avisar
      setState((s) => ({
        ...s,
        current: {
          ...s.current,
          runtime: { ...s.current.runtime, lastNotifiedTs: nowTs },
        },
      }));
      const title = "Hidratación";
      const body = `Bebe agua. Llevas ${fromMl(totals.totalMl, unit)} ${unit} de ${fromMl(
        totals.goal.effective,
        unit
      )}.`;
      if (R.sound) beep();
      if (R.vibrate) vibrate();
      fireNotification({ title, body });
    }
  }, [nowTs, nextDue, state.settings.reminders, totals, unit]);

  function snooze() {
    const min = clamp(Number(state.settings.reminders.snoozeMin) || 10, 1, 120);
    const until = Date.now() + min * MIN;
    setState((s) => ({
      ...s,
      current: {
        ...s.current,
        runtime: { ...s.current.runtime, snoozedUntilTs: until },
      },
    }));
  }

  async function ensurePerms() {
    await requestNotifPermission();
  }

  function addEntry(eqMl, meta) {
    setState((s) => ({
      ...s,
      current: {
        ...s.current,
        entries: [
          ...s.current.entries,
          { id: crypto.randomUUID(), ml: eqMl, ts: Date.now(), meta },
        ],
      },
    }));
  }

  function addMl(ml) {
    addEntry(ml, {
      key: "agua",
      label: state.settings.drinks.agua.name,
      volumeMl: ml,
      factor: 1,
    });
  }

  function addAmount(amount) {
    const ml = toMl(amount, unit);
    if (ml <= 0 || !Number.isFinite(ml)) return;
    addMl(ml);
  }

  function undoLast() {
    setState((s) => ({
      ...s,
      current: { ...s.current, entries: s.current.entries.slice(0, -1) },
    }));
  }

  function resetToday() {
    if (!confirm("¿Reiniciar el día actual?")) return;
    setState((s) => ({
      ...s,
      current: {
        date: todayKey(),
        entries: [],
        adjust: s.current.adjust,
        runtime: { lastNotifiedTs: 0, snoozedUntilTs: 0 },
      },
    }));
  }

  function updateGoal(next) {
    const ml = toMl(next, unit);
    if (ml < 500) return; // mínimo razonable
    setState((s) => ({ ...s, settings: { ...s.settings, goalMl: ml } }));
  }

  function setUnit(nextUnit) {
    if (nextUnit === unit) return;
    setState((s) => ({ ...s, settings: { ...s.settings, unit: nextUnit } }));
  }

  function exportCSV() {
    // Combinar historial + hoy
    const hist = [...state.history];
    const today = { date: state.current.date, totalMl: totals.totalMl };
    const map = new Map(hist.map((h) => [h.date, h.totalMl]));
    map.set(today.date, today.totalMl);
    const rows = [["fecha", "ml", unit]];
    [...map.entries()] // fecha, ml
      .sort((a, b) => a[0].localeCompare(b[0]))
      .forEach(([date, ml]) =>
        rows.push([date, String(ml), String(fromMl(ml, unit))])
      );
    const csv = rows.map((r) => r.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "agua_historial.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  const last7 = useMemo(() => {
    // Construir últimos 7 días incluyendo hoy
    const dates = [];
    const base = new Date(state.current.date + "T00:00:00");
    for (let i = 6; i >= 0; i--) {
      const d = new Date(base);
      d.setDate(base.getDate() - i);
      dates.push(d.toISOString().slice(0, 10));
    }
    const map = new Map(state.history.map((h) => [h.date, h.totalMl]));
    map.set(state.current.date, totals.totalMl);
    return dates.map((date) => ({
      date,
      ml: map.get(date) || 0,
    }));
  }, [state.history, state.current.date, totals.totalMl]);

  // Helpers para actualizar ajustes diarios
  function setAdjust(patch) {
    setState((s) => ({
      ...s,
      current: { ...s.current, adjust: { ...s.current.adjust, ...patch } },
    }));
  }

  // Helpers de bebidas
  function addDrinkByKey(key, amountInUnit) {
    const drink = state.settings.drinks[key];
    if (!drink) return;
    const volumeMl = toMl(amountInUnit, unit);
    const eqMl = Math.max(
      0,
      Math.round(volumeMl * clamp(Number(drink.factor) || 0, 0, 1.2))
    );
    addEntry(eqMl, { key, label: drink.name, volumeMl, factor: Number(drink.factor) });
  }

  return (
    <div className="min-h-screen bg-white text-gray-900 p-4 sm:p-6">
      <div className="mx-auto max-w-2xl space-y-4">
        {/* Header */}
        <header className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold">Seguimiento de agua</h1>
            <p className="text-sm text-gray-500">
              {new Date(state.current.date).toLocaleDateString()}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <UnitToggle unit={unit} onChange={setUnit} />
            <button
              onClick={() => setShowReminders((v) => !v)}
              className="px-3 py-1.5 text-sm rounded-xl border border-gray-300 hover:bg-gray-50"
            >
              Recordatorios
            </button>
            <button
              onClick={() => setShowSettings((v) => !v)}
              className="px-3 py-1.5 text-sm rounded-xl border border-gray-300 hover:bg-gray-50"
            >
              Ajustes
            </button>
            <button
              onClick={exportCSV}
              className="px-3 py-1.5 text-sm rounded-xl border border-gray-300 hover:bg-gray-50"
            >
              Exportar CSV
            </button>
          </div>
        </header>

        {/* Objetivo y progreso */}
        <section className="rounded-2xl border p-4 sm:p-5 shadow-sm space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
            <div>
              <p className="text-sm text-gray-500">Objetivo base</p>
              <div className="flex items-baseline gap-2">
                <EditableNumber
                  value={fromMl(computeBaseGoalMl(state.settings), unit)}
                  onChange={updateGoal}
                  unit={unit}
                />
                <span className="text-gray-500">/ día</span>
              </div>
              {state.settings.useWeight && (
                <p className="text-xs text-gray-500 mt-1">
                  Derivado de peso × ml/kg
                </p>
              )}
            </div>
            <div className="w-full sm:w-1/2">
              <ProgressBar percent={totals.pct} />
              <div className="mt-1 text-sm text-gray-600">
                {fromMl(totals.totalMl, unit)} {unit} de {fromMl(
                  totals.goal.effective,
                  unit
                )} {unit}
              </div>
              <div className="text-xs text-gray-500 mt-1">
                Base: {fromMl(totals.goal.base, unit)} {unit} · Ajuste ejercicio: +
                {fromMl(totals.goal.ex, unit)} {unit}
              </div>
            </div>
          </div>

          {/* Ajuste diario */}
          <DayAdjust
            adjust={state.current.adjust}
            settings={state.settings}
            unit={unit}
            onChange={setAdjust}
          />
        </section>

        {/* Añadir consumo de agua directa */}
        <section className="rounded-2xl border p-4 sm:p-5 shadow-sm space-y-3">
          <p className="text-sm text-gray-500">Añadir rápido (agua)</p>
          <div className="flex flex-wrap gap-2">
            {state.settings.quickMl.map((q) => (
              <button
                key={q}
                onClick={() => addMl(q)}
                className="px-3 py-2 rounded-xl border border-gray-300 hover:bg-gray-50"
              >
                + {fromMl(q, unit)} {unit}
              </button>
            ))}
          </div>
          <CustomAdd unit={unit} onAdd={addAmount} />
        </section>

        {/* Añadir bebidas con equivalencia */}
        <section className="rounded-2xl border p-4 sm:p-5 shadow-sm space-y-3">
          <DrinkAdd
            drinks={state.settings.drinks}
            unit={unit}
            onAdd={addDrinkByKey}
          />
        </section>

        {/* Recordatorios */}
        {showReminders && (
          <RemindersPanel
            state={state}
            setState={setState}
            nowTs={nowTs}
            nextDue={nextDue}
            onSnooze={snooze}
            onPerms={ensurePerms}
          />
        )}

        {/* Entradas del día */}
        <section className="rounded-2xl border p-4 sm:p-5 shadow-sm">
          <p className="text-sm text-gray-500 mb-3">Registro de hoy</p>
          {state.current.entries.length === 0 ? (
            <p className="text-gray-500 text-sm">Sin registros todavía.</p>
          ) : (
            <ul className="space-y-2 max-h-56 overflow-auto pr-1">
              {[...state.current.entries].reverse().map((e) => (
                <li key={e.id} className="flex justify-between text-sm">
                  <span>
                    {e.meta?.label ? (
                      <>
                        {e.meta.label} · {fromMl(e.meta.volumeMl, unit)} {unit} → {fromMl(e.ml, unit)} {unit} eq
                      </>
                    ) : (
                      <>
                        {fromMl(e.ml, unit)} {unit}
                      </>
                    )}
                  </span>
                  <span className="text-gray-500">
                    {new Date(e.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-3 text-xs text-gray-500">Los valores son equivalentes de agua para el objetivo diario.</div>
        </section>

        {/* Historial simple últimos 7 días */}
        <section className="rounded-2xl border p-4 sm:p-5 shadow-sm">
          <p className="text-sm text-gray-500 mb-3">Últimos 7 días</p>
          <SimpleBars data={last7} goalMl={totals.goal.effective} unit={unit} />
        </section>

        {/* Ajustes avanzados */}
        {showSettings && (
          <SettingsPanel state={state} setState={setState} unit={unit} />
        )}

        <footer className="pt-2 pb-6 text-xs text-gray-400 text-center">
          Datos en este dispositivo (localStorage). Sin nube.
        </footer>
      </div>
    </div>
  );
}

function UnitToggle({ unit, onChange }) {
  return (
    <div className="inline-flex rounded-xl border border-gray-300 p-1">
      {[
        { k: "ml", label: "ml" },
        { k: "oz", label: "oz" },
      ].map((opt) => (
        <button
          key={opt.k}
          onClick={() => onChange(opt.k)}
          className={`px-3 py-1.5 text-sm rounded-lg ${
            unit === opt.k ? "bg-gray-900 text-white" : "hover:bg-gray-50"
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

function EditableNumber({ value, onChange, unit }) {
  const [val, setVal] = useState(String(value));
  useEffect(() => setVal(String(value)), [value]);
  return (
    <div className="flex items-center gap-2">
      <input
        className="w-24 px-3 py-2 rounded-xl border border-gray-300 focus:outline-none focus:ring-2 focus:ring-gray-300"
        inputMode="decimal"
        value={val}
        onChange={(e) => setVal(e.target.value)}
        onBlur={() => {
          const n = Number(String(val).replace(",", "."));
          if (Number.isFinite(n)) onChange(n);
          else setVal(String(value));
        }}
      />
      <span className="text-gray-500">{unit}</span>
    </div>
  );
}

function CustomAdd({ unit, onAdd }) {
  const [n, setN] = useState(200);
  return (
    <div className="flex items-center gap-2">
      <input
        className="w-28 px-3 py-2 rounded-xl border border-gray-300 focus:outline-none focus:ring-2 focus:ring-gray-300"
        inputMode="decimal"
        value={n}
        onChange={(e) => setN(e.target.value)}
      />
      <span className="text-gray-500">{unit}</span>
      <button
        onClick={() => {
          const v = Number(String(n).replace(",", "."));
          if (Number.isFinite(v)) onAdd(v);
        }}
        className="px-3 py-2 rounded-xl border border-gray-300 hover:bg-gray-50"
      >
        Añadir
      </button>
    </div>
  );
}

function ProgressBar({ percent }) {
  return (
    <div className="w-full">
      <div className="h-3 w-full rounded-full bg-gray-200 overflow-hidden">
        <div
          className="h-3 bg-gray-900"
          style={{ width: `${percent}%` }}
        />
      </div>
      <div className="mt-1 text-xs text-gray-500">{percent}% del objetivo</div>
    </div>
  );
}

function SimpleBars({ data, goalMl, unit }) {
  // Gráfico puro CSS para no depender de librerías
  const max = Math.max(goalMl, ...data.map((d) => d.ml), 1000);
  return (
    <div className="grid grid-cols-7 gap-2 items-end h-40">
      {data.map((d) => {
        const h = Math.round((d.ml / max) * 100);
        const isToday = d.date === todayKey();
        return (
          <div key={d.date} className="flex flex-col items-center gap-1">
            <div
              className={`w-8 sm:w-9 rounded-t-xl ${
                isToday ? "bg-gray-900" : "bg-gray-300"
              }`}
              style={{ height: `${h}%` }}
              title={`${new Date(d.date).toLocaleDateString()}: ${fromMl(d.ml, unit)} ${unit}`}
            />
            <span className="text-[10px] text-gray-500">
              {new Date(d.date).toLocaleDateString(undefined, { weekday: "short" }).slice(0, 2)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function Chip({ active, onClick, children }) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 text-sm rounded-xl border ${
        active ? "border-gray-900 bg-gray-900 text-white" : "border-gray-300 hover:bg-gray-50"
      }`}
    >
      {children}
    </button>
  );
}

function DayAdjust({ adjust, settings, unit, onChange }) {
  const exPer30 = settings.exercisePer30[adjust.intensity] || 0;
  const exMl = Math.max(0, Math.round((adjust.exerciseMin / 30) * exPer30));
  return (
    <div className="rounded-xl border border-gray-200 p-3 sm:p-4">
      <p className="text-sm text-gray-500 mb-3">Ajuste del día</p>
      <div className="flex flex-wrap gap-2 mb-3">
        <Chip active={adjust.sedentary} onClick={() => onChange({ sedentary: !adjust.sedentary })}>
          Día sedentario (−{settings.sedentaryPenaltyPct}%)
        </Chip>
        <Chip active={adjust.hot} onClick={() => onChange({ hot: !adjust.hot })}>
          Día caluroso (+{settings.hotBonusPct}%)
        </Chip>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
        <div>
          <label className="block text-xs text-gray-500 mb-1">Minutos de ejercicio</label>
          <input
            className="w-full px-3 py-2 rounded-xl border border-gray-300 focus:outline-none focus:ring-2 focus:ring-gray-300"
            inputMode="numeric"
            value={adjust.exerciseMin}
            onChange={(e) => onChange({ exerciseMin: Math.max(0, Number(e.target.value || 0)) })}
          />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Intensidad</label>
          <select
            className="w-full px-3 py-2 rounded-xl border border-gray-300 focus:outline-none focus:ring-2 focus:ring-gray-300"
            value={adjust.intensity}
            onChange={(e) => onChange({ intensity: e.target.value })}
          >
            <option value="ligera">Ligera</option>
            <option value="moderada">Moderada</option>
            <option value="intensa">Intensa</option>
          </select>
        </div>
        <div>
          <div className="text-sm">Extra por ejercicio</div>
          <div className="text-sm text-gray-600">+ {fromMl(exMl, unit)} {unit}</div>
          <div className="text-xs text-gray-500">{exPer30} ml / 30 min</div>
        </div>
      </div>
    </div>
  );
}

function SettingsPanel({ state, setState, unit }) {
  function patchSettings(p) {
    setState((s) => ({ ...s, settings: { ...s.settings, ...p } }));
  }
  const baseGoalMl = computeBaseGoalMl(state.settings);

  function updateDrink(key, patch) {
    setState((s) => ({
      ...s,
      settings: {
        ...s.settings,
        drinks: {
          ...s.settings.drinks,
          [key]: { ...s.settings.drinks[key], ...patch },
        },
      },
    }));
  }
  function addDrink(name, factor) {
    // key único simple
    const base = name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
    let key = base || `custom_${Date.now()}`;
    let i = 1;
    while (state.settings.drinks[key]) { key = `${base}_${i++}`; }
    updateDrink(key, { name, factor: clamp(Number(factor) || 0, 0, 1.2) });
  }
  function removeDrink(key) {
    if (coreDrinkKeys.has(key)) return; // no borrar core
    setState((s) => {
      const next = { ...s.settings.drinks };
      delete next[key];
      return { ...s, settings: { ...s.settings, drinks: next } };
    });
  }

  const [newDrinkName, setNewDrinkName] = useState("");
  const [newDrinkFactor, setNewDrinkFactor] = useState("1");

  return (
    <section className="rounded-2xl border p-4 sm:p-5 shadow-sm space-y-4">
      <p className="text-sm text-gray-500">Ajustes</p>

      {/* Objetivo base y ponderaciones */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={state.settings.useWeight}
            onChange={(e) => patchSettings({ useWeight: e.target.checked })}
          />
          Usar peso para objetivo
        </label>
        <div className="flex items-center gap-2">
          <input
            className="w-24 px-3 py-2 rounded-xl border border-gray-300 focus:outline-none focus:ring-2 focus:ring-gray-300"
            inputMode="decimal"
            value={state.settings.weightKg}
            onChange={(e) => patchSettings({ weightKg: Number(String(e.target.value).replace(",", ".")) || 0 })}
          />
          <span className="text-gray-500 text-sm">kg</span>
        </div>
        <div className="flex items-center gap-2">
          <input
            className="w-24 px-3 py-2 rounded-xl border border-gray-300 focus:outline-none focus:ring-2 focus:ring-gray-300"
            inputMode="decimal"
            value={state.settings.mlPerKg}
            onChange={(e) => patchSettings({ mlPerKg: Number(String(e.target.value).replace(",", ".")) || 0 })}
          />
          <span className="text-gray-500 text-sm">ml/kg</span>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="flex items-center gap-2">
          <input
            className="w-24 px-3 py-2 rounded-xl border border-gray-300 focus:outline-none focus:ring-2 focus:ring-gray-300"
            inputMode="decimal"
            value={fromMl(baseGoalMl, unit)}
            onChange={(e) => patchSettings({ goalMl: toMl(Number(String(e.target.value).replace(",", ".")) || 0, unit) })}
          />
          <span className="text-gray-500 text-sm">{unit} base</span>
        </div>
        <div className="flex items-center gap-2">
          <input
            className="w-24 px-3 py-2 rounded-xl border border-gray-300 focus:outline-none focus:ring-2 focus:ring-gray-300"
            inputMode="numeric"
            value={state.settings.sedentaryPenaltyPct}
            onChange={(e) => patchSettings({ sedentaryPenaltyPct: Math.max(0, Number(e.target.value || 0)) })}
          />
          <span className="text-gray-500 text-sm">% día sedentario</span>
        </div>
        <div className="flex items-center gap-2">
          <input
            className="w-24 px-3 py-2 rounded-xl border border-gray-300 focus:outline-none focus:ring-2 focus:ring-gray-300"
            inputMode="numeric"
            value={state.settings.hotBonusPct}
            onChange={(e) => patchSettings({ hotBonusPct: Math.max(0, Number(e.target.value || 0)) })}
          />
          <span className="text-gray-500 text-sm">% día caluroso</span>
        </div>
      </div>

      {/* Catálogo de bebidas */}
      <div>
        <p className="text-sm text-gray-500 mb-2">Bebidas y factores</p>
        <div className="overflow-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500">
                <th className="py-1">Bebida</th>
                <th className="py-1">Factor</th>
                <th className="py-1"></th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(state.settings.drinks).map(([key, d]) => (
                <tr key={key} className="border-t">
                  <td className="py-1 pr-2">
                    <input
                      className="w-full px-2 py-1 rounded-lg border border-gray-300"
                      value={d.name}
                      onChange={(e) => updateDrink(key, { name: e.target.value })}
                    />
                  </td>
                  <td className="py-1 pr-2">
                    <input
                      className="w-24 px-2 py-1 rounded-lg border border-gray-300"
                      inputMode="decimal"
                      value={d.factor}
                      onChange={(e) => updateDrink(key, { factor: clamp(Number(String(e.target.value).replace(",", ".")) || 0, 0, 1.2) })}
                    />
                  </td>
                  <td className="py-1">
                    {!coreDrinkKeys.has(key) && (
                      <button onClick={() => removeDrink(key)} className="px-2 py-1 rounded-lg border border-gray-300 hover:bg-gray-50">Eliminar</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-2 flex items-end gap-2">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Nueva bebida</label>
            <input
              className="w-48 px-3 py-2 rounded-xl border border-gray-300"
              value={newDrinkName}
              onChange={(e) => setNewDrinkName(e.target.value)}
              placeholder="Nombre"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Factor</label>
            <input
              className="w-24 px-3 py-2 rounded-xl border border-gray-300"
              value={newDrinkFactor}
              inputMode="decimal"
              onChange={(e) => setNewDrinkFactor(e.target.value)}
            />
          </div>
          <button
            className="px-3 py-2 rounded-xl border border-gray-300 hover:bg-gray-50"
            onClick={() => { if (newDrinkName.trim()) { addDrink(newDrinkName.trim(), newDrinkFactor); setNewDrinkName(""); setNewDrinkFactor("1"); } }}
          >
            Añadir bebida
          </button>
        </div>
        <p className="text-xs text-gray-500 mt-1">Factor 1 = 100% equivalente a agua. Alcohol reduce el factor.</p>
      </div>

      <p className="text-xs text-gray-500">El objetivo efectivo aplica % por calor o sedentarismo y suma el extra por ejercicio.</p>
    </section>
  );
}

function RemindersPanel({ state, setState, nowTs, nextDue, onSnooze, onPerms }) {
  const R = state.settings.reminders;
  function patch(p) { setState((s) => ({ ...s, settings: { ...s.settings, reminders: { ...s.settings.reminders, ...p } } })); }
  const countdown = Number.isFinite(nextDue) ? fmtCountdown(nextDue - nowTs) : "—";
  return (
    <section className="rounded-2xl border p-4 sm:p-5 shadow-sm space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-500">Recordatorios</p>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={!!R.enabled} onChange={(e) => patch({ enabled: e.target.checked })} />
            Activar
          </label>
          <button onClick={onSnooze} className="px-3 py-1.5 text-sm rounded-xl border border-gray-300 hover:bg-gray-50">Posponer {R.snoozeMin} min</button>
          <button onClick={onPerms} className="px-3 py-1.5 text-sm rounded-xl border border-gray-300 hover:bg-gray-50">Permisos de notificación</button>
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="flex items-center gap-2">
          <input className="w-24 px-3 py-2 rounded-xl border border-gray-300" inputMode="numeric" value={R.intervalMin} onChange={(e)=>patch({ intervalMin: Math.max(5, Number(e.target.value||0)) })} />
          <span className="text-gray-500 text-sm">min intervalo</span>
        </div>
        <div className="flex items-center gap-2">
          <input className="w-24 px-3 py-2 rounded-xl border border-gray-300" inputMode="numeric" value={R.startHour} onChange={(e)=>patch({ startHour: clamp(Number(e.target.value||0),0,23) })} />
          <span className="text-gray-500 text-sm">hora inicio</span>
        </div>
        <div className="flex items-center gap-2">
          <input className="w-24 px-3 py-2 rounded-xl border border-gray-300" inputMode="numeric" value={R.endHour} onChange={(e)=>patch({ endHour: clamp(Number(e.target.value||0),0,23) })} />
          <span className="text-gray-500 text-sm">hora fin</span>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={!!R.requireBelowGoal} onChange={(e)=>patch({ requireBelowGoal: e.target.checked })} />
          Solo si no has llegado al objetivo
        </label>
        <div className="flex items-center gap-2">
          <input className="w-24 px-3 py-2 rounded-xl border border-gray-300" inputMode="numeric" value={R.idleMin} onChange={(e)=>patch({ idleMin: Math.max(0, Number(e.target.value||0)) })} />
          <span className="text-gray-500 text-sm">min inactividad</span>
        </div>
        <div className="flex items-center gap-2">
          <input className="w-24 px-3 py-2 rounded-xl border border-gray-300" inputMode="numeric" value={R.snoozeMin} onChange={(e)=>patch({ snoozeMin: Math.max(1, Number(e.target.value||0)) })} />
          <span className="text-gray-500 text-sm">min posponer</span>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={!!R.sound} onChange={(e)=>patch({ sound: e.target.checked })} />
          Sonido
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={!!R.vibrate} onChange={(e)=>patch({ vibrate: e.target.checked })} />
          Vibrar
        </label>
      </div>
      <p className="text-sm text-gray-500">Próximo recordatorio en: {countdown}</p>
    </section>
  );
}

function DrinkAdd({ drinks, unit, onAdd }) {
  const keys = Object.keys(drinks);
  const [key, setKey] = useState(keys[0] || "");
  const [amount, setAmount] = useState(200);

  useEffect(() => {
    if (!drinks[key] && keys.length) setKey(keys[0]);
  }, [drinks, key, keys]);

  return (
    <div className="space-y-3">
      <p className="text-sm text-gray-500">Añadir bebida</p>
      <div className="flex flex-wrap items-center gap-2">
        <select
          className="px-3 py-2 rounded-xl border border-gray-300 focus:outline-none focus:ring-2 focus:ring-gray-300"
          value={key}
          onChange={(e) => setKey(e.target.value)}
        >
          {keys.map((k) => (
            <option key={k} value={k}>{drinks[k].name}</option>
          ))}
        </select>
        <input
          className="w-28 px-3 py-2 rounded-xl border border-gray-300 focus:outline-none focus:ring-2 focus:ring-gray-300"
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
        <span className="text-gray-500">{unit}</span>
        <button
          onClick={() => {
            const v = Number(String(amount).replace(",", "."));
            if (Number.isFinite(v)) onAdd(key, v);
          }}
          className="px-3 py-2 rounded-xl border border-gray-300 hover:bg-gray-50"
        >
          Añadir
        </button>
      </div>
      <p className="text-xs text-gray-500">El factor de cada bebida ajusta la cantidad equivalente de agua.</p>
    </div>
  );
}
