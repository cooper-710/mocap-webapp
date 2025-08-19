// src/components/ThreeView.tsx
import React, {
  useMemo,
  useState,
  useEffect,
  useCallback,
  useRef,
} from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls, Grid, Line, ContactShadows } from "@react-three/drei";
import * as THREE from "three";
import FBXModel from "./FBXModel";
import SimpleGraph from "./SimpleGraph";
import GraphHoloPanel from "./GraphHoloPanel";
import { parseExcelToDataSets } from "../utils/excel";
import type { RowsBySheet } from "../utils/excel";

type SeriesPoint = { t?: number; value: number };
type Mode = "player" | "admin";
type Layout = "right" | "bottom";
type PanelMode = "docked" | "in3d";

const FPS = 120;
const isBrowser = typeof window !== "undefined";

// Training floor dimensions (meters-ish)
const FLOOR_W = 10;
const FLOOR_D = 6;

/* --------------------------- Training Floor --------------------------- */
function TrainingFloor() {
  // Bounded “stage” dimensions (meters)
  const halfW = FLOOR_W / 2;
  const halfD = FLOOR_D / 2;

  // Rectangle path for the orange boundary
  const boundaryPoints = useMemo(
    () => [
      [-halfW, 0, -halfD],
      [halfW, 0, -halfD],
      [halfW, 0, halfD],
      [-halfW, 0, halfD],
      [-halfW, 0, -halfD],
    ],
    [halfW, halfD]
  );

  return (
    <group>
      {/* Matte base plane (very dark, non-reflective) */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.001, 0]}>
        <planeGeometry args={[FLOOR_W, FLOOR_D]} />
        <meshStandardMaterial color="#0b0e12" roughness={1} metalness={0} />
      </mesh>

      {/* Localized grid INSIDE the boundary (no infinite feel) */}
      <Grid
        args={[FLOOR_W, FLOOR_D]} // size = stage only
        position={[0, 0.0004, 0]} // lift to avoid z-fighting
        rotation={[-Math.PI / 2, 0, 0]}
        cellSize={0.5} // small cells
        cellThickness={0.22}
        sectionSize={2.5} // larger sections
        sectionThickness={1.05}
        infiniteGrid={false}
        followCamera={false} // prevents those vertical “wall” lines
        fadeDistance={0}
        fadeStrength={0}
        cellColor="rgba(142,168,194,0.18)" // subtle cool
        sectionColor="rgba(229,129,43,0.26)" // Sequence orange hint
      />

      {/* Orange perimeter (brand) */}
      <Line
        points={boundaryPoints as unknown as [number, number, number][]}
        color="#E5812B"
        lineWidth={1.4}
        transparent
        opacity={0.95}
        toneMapped={false}
      />

      {/* Soft inner glow around edges to lift the stage */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.0002, 0]}>
        <planeGeometry args={[FLOOR_W * 0.985, FLOOR_D * 0.985]} />
        <meshBasicMaterial transparent opacity={0.18} color="#E5812B" />
      </mesh>

      {/* Contact shadow to “pin” the rig to the floor (no huge diagonal shadow) */}
      <ContactShadows
        position={[0, 0.002, 0]}
        opacity={0.35}
        scale={Math.max(FLOOR_W, FLOOR_D) + 1.6}
        blur={2.8}
        far={10}
        resolution={1024}
        frames={1}
      />
    </group>
  );
}

/* ------------------------------- Scene ------------------------------- */
function Scene({
  fbxUrl,
  time,
  onReadyDuration,
}: {
  fbxUrl: string | null;
  time: number;
  onReadyDuration: (dur: number) => void;
}) {
  const axes = useMemo(() => new THREE.AxesHelper(1.5), []);
  return (
    <>
      <hemisphereLight intensity={0.7} groundColor="#0d0f13" />
      <ambientLight intensity={0.25} />
      {/* No castShadow to avoid big ground shadow; ContactShadows handles the pinning */}
      <directionalLight position={[6, 10, 6]} intensity={1.05} color="#ffd1a3" />

      {/* Stylized training floor */}
      <TrainingFloor />

      <primitive object={axes} position={[0, 0.01, 0]} />

      {fbxUrl && (
        <FBXModel
          url={fbxUrl}
          scale={0.01}
          position={[0, 0, 0]}
          rotation={[0, 0, 0]}
          time={time}
          onReadyDuration={onReadyDuration}
        />
      )}
    </>
  );
}

/* ---------------------------- Main Component ---------------------------- */
export default function ThreeView() {
  const params = isBrowser ? new URLSearchParams(window.location.search) : new URLSearchParams();
  const initialMode: Mode = params.get("mode") === "admin" ? "admin" : "player";
  const [mode] = useState<Mode>(initialMode);
  const isPlayer = mode === "player";

  // Compact/mobile detection (works on laptops/desktops/phones)
  const [isCompact, setIsCompact] = useState<boolean>(() =>
    isBrowser ? window.matchMedia("(max-width: 900px), (max-height: 700px)").matches : false
  );
  useEffect(() => {
    if (!isBrowser) return;
    const mq = window.matchMedia("(max-width: 900px), (max-height: 700px)");
    const onChange = () => setIsCompact(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  /* Playback */
  const [fbxUrl, setFbxUrl] = useState<string | null>(null);
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState(1); // 0.1 .. 2.0
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [snapFrames, setSnapFrames] = useState(true);

  /* Data (multi-sheet) */
  const [rowsBySheet, setRowsBySheet] = useState<RowsBySheet | null>(null);
  const [sheetNames, setSheetNames] = useState<string[]>([]);
  const [sheet, setSheet] = useState<string | null>(null);

  const [rows, setRows] = useState<any[] | null>(null);
  const [channels, setChannels] = useState<string[]>([]);

  const [selectedChannel, setSelectedChannel] = useState<string | null>(null);
  const [series, setSeries] = useState<SeriesPoint[] | null>(null);

  const [selectedChannelB, setSelectedChannelB] = useState<string | null>(null);
  const [seriesB, setSeriesB] = useState<SeriesPoint[] | null>(null);

  const [jsonDuration, setJsonDuration] = useState(0);

  /* Layout + panels */
  const [graphDock, setGraphDock] = useState<Layout>("bottom");
  const [panelMode, setPanelMode] = useState<PanelMode>("docked");

  // Player-editable visibility (persisted)
  const storedShowMain = isBrowser ? localStorage.getItem("seq_showMainGraph") : null;
  const storedShowSecond =
    isBrowser ? localStorage.getItem("seq_showSecondGraph") ?? localStorage.getItem("seq_showMiniGraph") : null;

  const [showMainGraph, setShowMainGraph] = useState<boolean>(storedShowMain ? storedShowMain === "1" : true);
  const [showSecond, setShowSecond] = useState<boolean>(storedShowSecond ? storedShowSecond === "1" : true);

  useEffect(() => {
    if (isBrowser) localStorage.setItem("seq_showMainGraph", showMainGraph ? "1" : "0");
  }, [showMainGraph]);
  useEffect(() => {
    if (!isBrowser) return;
    localStorage.setItem("seq_showSecondGraph", showSecond ? "1" : "0");
    localStorage.removeItem("seq_showMiniGraph"); // migrate old key
  }, [showSecond]);

  // 3D panel positions (admin can drag in In-3D mode)
  const [posMain, setPosMain] = useState<[number, number, number]>([3.8, 0.02, -2.6]);
  const [posSecond, setPosSecond] = useState<[number, number, number]>([1.0, 0.02, -4.2]);

  /* ---------------- Dock sizing (checkbox driven) ---------------- */
  const requestedGraphCount = (showMainGraph ? 1 : 0) + (showSecond ? 1 : 0);
  const dockPct = requestedGraphCount === 2 ? 0.30 : requestedGraphCount === 1 ? 0.20 : 0;

  const [dockPx, setDockPx] = useState(() =>
    Math.round((isBrowser ? window.innerHeight : 900) * dockPct)
  );
  useEffect(() => {
    if (!isBrowser) return;
    setDockPx(Math.round(window.innerHeight * dockPct));
    const onResize = () => setDockPx(Math.round(window.innerHeight * dockPct));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [dockPct]);

  /* ------------------------------ URL preload ------------------------------ */
  useEffect(() => {
    const fbx = params.get("fbx");
    const json = params.get("json");
    const excel = params.get("excel");
    const chMain = params.get("chMain");
    const chSecond = params.get("chMini");
    const sheetMain = params.get("sheetMain");

    if (fbx) setFbxUrl(fbx);
    if (params.get("layout") === "right") setGraphDock("right");
    if (params.get("panels") === "in3d") setPanelMode("in3d");

    (async () => {
      try {
        if (excel) {
          const blob = await fetch(excel).then((r) => r.blob());
          const sets = await parseExcelToDataSets(blob as any, FPS);
          const names = Object.keys(sets);
          if (!names.length) throw new Error("Excel has no usable sheets.");

          const chosen =
            (sheetMain && names.includes(sheetMain) ? sheetMain : undefined) ??
            names.find((n) => /joint.*position/i.test(n)) ??
            names.find((n) => /baseball.*data/i.test(n)) ??
            names[0];

          setRowsBySheet(sets);
          setSheetNames(names);
          setSheet(chosen);
          setRows(sets[chosen]);

          if (chMain) setSelectedChannel(chMain);
          if (chSecond) setSelectedChannelB(chSecond);
          return;
        }

        if (json) {
          const parsed = await fetch(json).then((r) => r.json());
          const arr = normalizeToArray(parsed) ?? [];
          const sets: RowsBySheet = { Data: arr };
          setRowsBySheet(sets);
          setSheetNames(["Data"]);
          setSheet("Data");
          setRows(arr);
          if (chMain) setSelectedChannel(chMain);
          if (chSecond) setSelectedChannelB(chSecond);
        }
      } catch (err) {
        console.error("Preload error:", err);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* Clean blob URLs */
  useEffect(() => {
    return () => {
      if (fbxUrl?.startsWith("blob:")) URL.revokeObjectURL(fbxUrl);
    };
  }, [fbxUrl]);

  /* ------------------------------ Admin uploads ------------------------------ */
  function handleFbxFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (fbxUrl?.startsWith("blob:")) URL.revokeObjectURL(fbxUrl);
    setFbxUrl(URL.createObjectURL(file));
    setPlaying(true);
    setTime(0);
  }

  async function handleJsonFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const arr = normalizeToArray(parsed) ?? [];
      const sets: RowsBySheet = { Data: arr };
      setRowsBySheet(sets);
      setSheetNames(["Data"]);
      setSheet("Data");
      setRows(arr);
    } catch (err: any) {
      console.error("JSON load error:", err);
      alert(`Couldn't read that JSON.\n\n${err?.message ?? err}`);
    }
  }

  async function handleExcelFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const sets = await parseExcelToDataSets(file, FPS);
      const names = Object.keys(sets);
      if (!names.length) throw new Error("No usable sheets found.");

      const preferred =
        names.find((n) => /joint.*position/i.test(n)) ??
        names.find((n) => /baseball.*data/i.test(n)) ??
        names[0];

      setRowsBySheet(sets);
      setSheetNames(names);
      setSheet(preferred);
      setRows(sets[preferred]);
      setPlaying(true);
      setTime(0);
    } catch (err: any) {
      console.error("Excel load error:", err);
      alert(`Couldn't read that Excel file.\n\n${err?.message ?? err}`);
    }
  }

  function exportCurrentJSON() {
    if (!rows || rows.length === 0) return;
    const blob = new Blob([JSON.stringify(rows)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${(sheet ?? "data").replace(/\s+/g, "_")}.json`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 800);
    a.remove();
  }

  /* ------------------------------ Helpers ------------------------------ */
  function normalizeToArray(obj: any): any[] | null {
    if (Array.isArray(obj)) return obj;
    if (obj && typeof obj === "object") {
      for (const key of ["data", "frames", "samples", "points", "series"]) {
        if (Array.isArray((obj as any)[key])) return (obj as any)[key];
      }
    }
    return null;
  }

  function prettyLabel(k: string): string {
    const parts = k.split("/").filter(Boolean);
    const tail = parts.slice(-2).join(" / ");
    return (tail || k).replace(/_/g, " ");
  }

  function listNumericChannels(data: Array<Record<string, unknown>>): string[] {
    const set = new Set<string>();
    for (const d of data) {
      if (!d || typeof d !== "object") continue;
      for (const k of Object.keys(d)) {
        if (k === "t" || k === "time" || k === "frame") continue;
        const v = (d as any)[k];
        if (typeof v === "number" && Number.isFinite(v)) set.add(k);
      }
    }
    return Array.from(set).sort();
  }

  function pickPreferredChannel(list: string[]): string | null {
    return (
      list.find((k) => /Wrist.*Velocity/i.test(k)) ??
      list.find((k) => /Velocity/i.test(k)) ??
      list.find((k) => /Rotation/i.test(k)) ??
      list[0] ??
      null
    );
  }

  function buildSeries(
    data: Array<Record<string, unknown>>,
    channel: string | null
  ): { pts: SeriesPoint[]; dur: number } {
    if (!data || data.length === 0 || !channel) return { pts: [], dur: 0 };

    const hasT = data.some((d) => typeof (d as any)?.t === "number");
    const hasTime = data.some((d) => typeof (d as any)?.time === "number");
    const tKey: "t" | "time" | null = hasT ? "t" : hasTime ? "time" : null;

    const n = data.length;
    const pts: SeriesPoint[] = [];

    for (let i = 0; i < n; i++) {
      const row = data[i] as any;
      const rawV = row?.[channel];
      if (typeof rawV !== "number" || !Number.isFinite(rawV)) continue;

      let t: number;
      if (tKey) {
        const tv = Number(row[tKey]);
        if (!Number.isFinite(tv)) continue;
        t = tv;
      } else {
        t = n > 1 ? i / (n - 1) : 0;
      }
      pts.push({ t, value: rawV });
    }

    if (pts.length === 0) return { pts: [], dur: 0 };

    const t0 = pts[0].t ?? 0;
    const t1 = pts[pts.length - 1].t ?? 0;
    const dur = Math.max(0, t1 - t0);

    const normalized: SeriesPoint[] = pts.map((p) => ({
      t: (p.t ?? 0) - t0,
      value: p.value,
    }));

    return { pts: normalized, dur };
  }

  /* Recompute when sheet changes */
  useEffect(() => {
    if (!rowsBySheet || !sheet) return;
    const newRows = rowsBySheet[sheet];
    setRows(newRows);

    const chs = listNumericChannels(newRows);
    setChannels(chs);

    setSelectedChannel((prev) => (prev && chs.includes(prev) ? prev : pickPreferredChannel(chs)));
    setSelectedChannelB((prev) => {
      if (prev && chs.includes(prev)) return prev;
      const first = pickPreferredChannel(chs);
      const second = chs.find((k) => k !== first) ?? first ?? null;
      return second;
    });
  }, [rowsBySheet, sheet]);

  /* Recompute when channels change */
  useEffect(() => {
    if (!rows || !selectedChannel) return;
    const { pts, dur } = buildSeries(rows, selectedChannel);
    setSeries(pts);
    setJsonDuration(dur);
  }, [rows, selectedChannel]);

  useEffect(() => {
    if (!rows || !selectedChannelB) return;
    const { pts } = buildSeries(rows, selectedChannelB);
    setSeriesB(pts);
  }, [rows, selectedChannelB]);

  /* FBX duration */
  const onReadyDuration = useCallback((dur: number) => {
    setDuration(dur);
    setTime((t) => (dur > 0 ? (t % dur + dur) % dur : 0));
  }, []);

  /* Playback loop (stable 0.1–2.0×) */
  const rafRef = useRef<number | null>(null);
  const lastTsRef = useRef<number | null>(null);
  const subFrameAccRef = useRef<number>(0); // accumulates fractional time while snapping

  const cancelLoop = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    lastTsRef.current = null;
  }, []);

  // reset accumulator on key param changes
  useEffect(() => {
    subFrameAccRef.current = 0;
  }, [speed, snapFrames, playing, duration]);

  const startLoop = useCallback(() => {
    cancelLoop();

    const loop = (ts: number) => {
      if (lastTsRef.current == null) lastTsRef.current = ts;
      const dtRaw = (ts - lastTsRef.current) / 1000;
      lastTsRef.current = ts;

      // clamp to avoid huge jumps coming back from a hidden tab
      const dt = Math.min(Math.max(dtRaw, 0), 0.05);

      setTime((prev) => {
        if (!playing || duration <= 0) return prev;

        // clamp slider range
        let s = Math.min(2, Math.max(0.1, speed));

        // advance by real time first
        const delta = dt * s;

        if (!snapFrames) {
          let next = prev + delta;
          if (duration > 0) next = ((next % duration) + duration) % duration;
          return next;
        }

        // --- snapped-to-frame advancement with subframe accumulator ---
        const step = 1 / FPS;
        let acc = subFrameAccRef.current + delta;

        // number of whole frame steps we can advance this tick
        const frames = Math.floor(acc / step);
        subFrameAccRef.current = acc - frames * step;

        if (frames <= 0) return prev; // not enough to tick one frame yet

        let next = prev + frames * step;

        // wrap & clamp to just shy of the end to avoid overshoot
        if (duration > 0) {
          next = ((next % duration) + duration) % duration;
          next = Math.min(Math.max(0, next), Math.max(0, duration - step / 2));
        }
        return next;
      });

      rafRef.current = requestAnimationFrame(loop);
    };

    rafRef.current = requestAnimationFrame(loop);
  }, [cancelLoop, playing, duration, speed, snapFrames]);

  useEffect(() => {
    startLoop();
    return cancelLoop;
  }, [startLoop, cancelLoop]);

  /* Seek from graphs (map JSON time → FBX time) */
  const handleGraphSeek = useCallback(
    (tJson: number) => {
      if (duration > 0 && jsonDuration > 0) {
        let t = (tJson / jsonDuration) * duration;
        if (snapFrames) t = Math.round(t * FPS) / FPS;
        setTime(Math.max(0, Math.min(duration, t)));
      } else if (duration > 0) {
        let t = Math.max(0, Math.min(duration, tJson));
        if (snapFrames) t = Math.round(t * FPS) / FPS;
        setTime(t);
      }
    },
    [duration, jsonDuration, snapFrames]
  );

  const fmt = (s: number) => `${s.toFixed(2)}s`;

  const toolbarVars = (isPlayer
    ? ({ ["--brand-img" as any]: "56px", ["--brand-text" as any]: "24px" })
    : ({ ["--brand-img" as any]: "28px", ["--brand-text" as any]: "18px" })) as React.CSSProperties;

  /* ------------------------------- UI ------------------------------- */
  const PANEL_PAD_TOP = 12;
  const PANEL_PAD_BOTTOM = 34; // leaves room for iOS handle + our border
  const ROW_GAP = 14;
  const EXTRA_CHROME = 12;

  const availableGraphs = (series ? 1 : 0) + (seriesB ? 1 : 0);
  const activeGraphCount = Math.min(requestedGraphCount, availableGraphs);

  const shouldShowBottomDock =
    panelMode === "docked" && graphDock === "bottom" && requestedGraphCount > 0;

  const dockHeightPx = shouldShowBottomDock ? dockPx : 0;

  const innerChrome = PANEL_PAD_TOP + PANEL_PAD_BOTTOM + EXTRA_CHROME;
  const graphRows = requestedGraphCount > 1 ? 2 : 1; // avoid name clash with `rows` state
  const computedSlot = Math.floor((dockHeightPx - innerChrome - (graphRows > 1 ? ROW_GAP : 0)) / graphRows);
  const perGraphHeight = Math.max(isCompact ? 100 : 120, computedSlot);

  return (
    <div
      style={{
        width: "100vw",
        height: "100vh",
        position: "relative",
        overflow: "hidden",
      }}
    >
      {/* Top bar */}
      <div className={`toolbar ${isPlayer ? "is-player" : "is-admin"}`} style={toolbarVars}>
        <div className="brand" aria-label="Sequence">
          <img src="/Logo.png" alt="Sequence logo" />
          <span className="name">SEQUENCE</span>
        </div>

        {/* Admin-only uploads */}
        {mode === "admin" && (
          <>
            <label className="btn" style={{ cursor: "pointer" }}>
              Upload .fbx
              <input type="file" accept=".fbx" onChange={handleFbxFile} style={{ display: "none" }} />
            </label>
            <label className="btn" style={{ cursor: "pointer" }}>
              Upload JSON
              <input type="file" accept=".json,application/json" onChange={handleJsonFile} style={{ display: "none" }} />
            </label>
            <label className="btn" style={{ cursor: "pointer" }}>
              Upload Excel
              <input type="file" accept=".xlsx,.xls,.csv" onChange={handleExcelFile} style={{ display: "none" }} />
            </label>
            <button className="btn ghost" onClick={exportCurrentJSON} disabled={!rows || rows.length === 0}>
              Export JSON
            </button>
          </>
        )}

        {/* Dataset (if multiple) */}
        {sheetNames.length > 1 && (
          <div className="ctrl">
            <span className="label">Dataset</span>
            <select
              className="select"
              value={sheet ?? ""}
              onChange={(e) => setSheet(e.target.value)}
              title={sheet ?? undefined}
            >
              {sheetNames.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Channels */}
        {channels.length > 0 && (
          <>
            <div className="ctrl">
              <span className="label">Main channel</span>
              <select
                className="select"
                value={selectedChannel ?? ""}
                onChange={(e) => setSelectedChannel(e.target.value)}
                title={selectedChannel ?? undefined}
              >
                {channels.map((k) => (
                  <option key={k} value={k}>
                    {k.split("/").slice(-2).join(" / ").replace(/_/g, " ")}
                  </option>
                ))}
              </select>
            </div>

            <div className="ctrl">
              <span className="label">Second channel</span>
              <select
                className="select"
                value={selectedChannelB ?? ""}
                onChange={(e) => setSelectedChannelB(e.target.value)}
                title={selectedChannelB ?? undefined}
              >
                {channels.map((k) => (
                  <option key={k} value={k}>
                    {k.split("/").slice(-2).join(" / ").replace(/_/g, " ")}
                  </option>
                ))}
              </select>
            </div>
          </>
        )}

        {/* Player toggles */}
        <label className="toggle">
          <input
            type="checkbox"
            checked={showMainGraph}
            onChange={(e) => setShowMainGraph(e.target.checked)}
          />
          <span>Main graph</span>
        </label>
        <label className="toggle">
          <input
            type="checkbox"
            checked={showSecond}
            onChange={(e) => setShowSecond(e.target.checked)}
          />
          <span>Second graph</span>
        </label>

        {/* Admin-only layout & snap */}
        {mode === "admin" && (
          <>
            <div className="ctrl">
              <span className="label">Layout</span>
              <select
                className="select"
                value={graphDock}
                onChange={(e) => setGraphDock(e.target.value as Layout)}
              >
                <option value="right">Right (stacked)</option>
                <option value="bottom">Bottom</option>
              </select>
            </div>

            <div className="ctrl">
              <span className="label">Panels</span>
              <select
                className="select"
                value={panelMode}
                onChange={(e) => setPanelMode(e.target.value as PanelMode)}
              >
                <option value="docked">Docked UI</option>
                <option value="in3d">In-3D (holograms)</option>
              </select>
            </div>

            <label className="toggle">
              <input
                type="checkbox"
                checked={snapFrames}
                onChange={(e) => setSnapFrames(e.target.checked)}
              />
              <span>Snap to frames</span>
            </label>
          </>
        )}

        {/* Time slider */}
        <div className="ctrl grow">
          <span className="label">Time</span>
          <input
            className="slider"
            type="range"
            min={0}
            max={Math.max(0.001, duration || 0.001)}
            step={snapFrames ? 1 / FPS : Math.max(0.001, (duration || 1) / 1000)}
            value={Math.min(time, duration || 0)}
            onChange={(e) => {
              const t = parseFloat(e.target.value);
              setTime(snapFrames ? Math.round(t * FPS) / FPS : t);
            }}
            disabled={duration <= 0}
            style={{ width: isCompact ? 180 : isPlayer ? 360 : 260 }}
          />
          {mode === "admin" && (
            <span className="small">{`${fmt(time)} / ${fmt(duration || 0)} • ${FPS} fps`}</span>
          )}
        </div>

        {/* Speed */}
        <div className="ctrl">
          <span className="label">Speed</span>
          <input
            className="slider"
            type="range"
            min={0.1}
            max={2}
            step={0.1}
            value={speed}
            onChange={(e) => setSpeed(parseFloat(e.target.value))}
            disabled={duration <= 0}
            style={{ width: isCompact ? 140 : 160 }}
          />
          <span className="small">{speed.toFixed(1)}x</span>
        </div>

        {/* Transport */}
        <button className="btn primary" onClick={() => setPlaying((p) => !p)} disabled={duration <= 0}>
          {playing ? "Pause" : "Play"}
        </button>
        <button className="btn" onClick={() => setTime(0)} disabled={duration <= 0}>
          Reset
        </button>
      </div>

      {/* 3D + (optional) hologram panels */}
      <Canvas
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: 0,
          bottom: panelMode === "docked" && graphDock === "bottom" && requestedGraphCount > 0 ? dockPx : 0,
        }}
        dpr={isCompact ? [1, 1.25] : [1, 2]}
        camera={{ position: [4, 3, 6], fov: 45 }}
        gl={{ antialias: true, powerPreference: isCompact ? "low-power" : "high-performance" }}
        onCreated={({ gl }) => {
          gl.outputColorSpace = THREE.SRGBColorSpace;
          gl.toneMapping = THREE.ACESFilmicToneMapping;
          gl.toneMappingExposure = 1.0;
          gl.shadowMap.enabled = false; // disable the big diagonal ground shadow
        }}
      >
        <Scene fbxUrl={fbxUrl} time={time} onReadyDuration={onReadyDuration} />
        <OrbitControls enableDamping dampingFactor={0.08} />

        {/* In-3D graph panels (Admin can drag them; Players see them fixed) */}
        {panelMode === "in3d" && showMainGraph && series && selectedChannel && (
          <GraphHoloPanel
            title={`Signal • ${sheet ? sheet + " • " : ""}${prettyLabel(selectedChannel)}`}
            position={posMain}
            setPosition={setPosMain}
            draggable={mode === "admin"}
          >
            <SimpleGraph
              data={series}
              time={time}
              jsonDuration={jsonDuration || 0}
              fbxDuration={duration || 0}
              height={200}
              title=""
              yLabel="Value"
              onSeek={handleGraphSeek}
            />
          </GraphHoloPanel>
        )}

        {panelMode === "in3d" && showSecond && seriesB && selectedChannelB && (
          <GraphHoloPanel
            title={`Signal • ${sheet ? sheet + " • " : ""}${prettyLabel(selectedChannelB)}`}
            position={posSecond}
            setPosition={setPosSecond}
            draggable={mode === "admin"}
          >
            <SimpleGraph
              data={seriesB}
              time={time}
              jsonDuration={jsonDuration || 0}
              fbxDuration={duration || 0}
              height={200}
              title=""
              yLabel="Value"
              onSeek={handleGraphSeek}
            />
          </GraphHoloPanel>
        )}
      </Canvas>

      {/* Docked graphs (classic UI, bottom) */}
      {panelMode === "docked" && graphDock === "bottom" && requestedGraphCount > 0 && (
        <div
          className="panel-wrap"
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: 0,
            height: dockPx,
            padding: "12px 12px calc(14px + env(safe-area-inset-bottom, 0px))",
            boxSizing: "border-box",
            overflow: "hidden",
          }}
        >
          {activeGraphCount > 0 ? (
            <div
              style={{
                height: "100%",
                display: "flex",
                flexDirection: "column",
                gap: 14,
                overflowY: "auto", // allow scroll on very small screens
                paddingRight: 4,
              }}
            >
              {showMainGraph && series && selectedChannel && (
                <SimpleGraph
                  data={series}
                  time={time}
                  jsonDuration={jsonDuration || 0}
                  fbxDuration={duration || 0}
                  height={perGraphHeight}
                  title={`Signal · ${sheet ? sheet + " · " : ""}${prettyLabel(selectedChannel)}`}
                  yLabel="Value"
                  onSeek={handleGraphSeek}
                />
              )}
              {showSecond && seriesB && selectedChannelB && (
                <SimpleGraph
                  data={seriesB}
                  time={time}
                  jsonDuration={jsonDuration || 0}
                  fbxDuration={duration || 0}
                  height={perGraphHeight}
                  title={`Signal · ${sheet ? sheet + " · " : ""}${prettyLabel(selectedChannelB)}`}
                  yLabel="Value"
                  onSeek={handleGraphSeek}
                />
              )}
            </div>
          ) : null}
        </div>
      )}

      {/* Right-docked graphs */}
      {panelMode === "docked" && graphDock === "right" && requestedGraphCount > 0 && (
        <div
          className="panel-wrap"
          style={{
            position: "absolute",
            top: isCompact ? 86 : 90,
            right: 12,
            bottom: 12,
            width: isCompact ? Math.min(380, Math.round((isBrowser ? window.innerWidth : 1200) * 0.55)) : 420,
            overflow: "hidden",
          }}
        >
          <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", gap: 12, overflowY: "auto" }}>
            {showMainGraph && series && selectedChannel && (
              <SimpleGraph
                data={series}
                time={time}
                jsonDuration={jsonDuration || 0}
                fbxDuration={duration || 0}
                height={isCompact ? 160 : 180}
                title={`Signal · ${sheet ? sheet + " · " : ""}${prettyLabel(selectedChannel)}`}
                yLabel="Value"
                onSeek={handleGraphSeek}
              />
            )}
            {showSecond && seriesB && selectedChannelB && (
              <SimpleGraph
                data={seriesB}
                time={time}
                jsonDuration={jsonDuration || 0}
                fbxDuration={duration || 0}
                height={isCompact ? 160 : 180}
                title={`Signal · ${sheet ? sheet + " · " : ""}${prettyLabel(selectedChannelB)}`}
                yLabel="Value"
                onSeek={handleGraphSeek}
              />
            )}
          </div>
        </div>
      )}

      {/* Theme & polish */}
      <style>{`
        /* ---------- Theme tokens ---------- */
        .toolbar, .panel-wrap, .select, .btn {
          font-family: Inter, ui-sans-serif, -apple-system, Segoe UI, Roboto, Helvetica, Arial, "Apple Color Emoji", "Segoe UI Emoji";
        }
        :root {
          --bg-0: #0b0e12;
          --bg-1: #0f141a;
          --panel: rgba(14,18,23,0.68);
          --border: rgba(255,255,255,0.08);
          --border-strong: rgba(255,255,255,0.12);
          --text: #e6edf7;
          --muted: #cfd6e2;
          --accent: #e5812b;
          --accent-deep: #cf6a14;
          --glow: rgba(229,129,43,0.45);
          --shadow: 0 12px 40px rgba(0,0,0,0.45);
        }

        /* ---------- Toolbar (glassy) ---------- */
        .toolbar {
          position: absolute;
          top: 12px;
          left: 12px;
          right: 12px;
          display: flex;
          flex-wrap: wrap;          /* wrap on compact screens */
          align-items: center;
          gap: 12px;
          row-gap: 10px;
          padding: 12px 14px;
          border-radius: 14px;
          background:
            radial-gradient(900px 140px at 10% -60%, rgba(229,129,43,0.09), transparent 65%),
            linear-gradient(180deg, rgba(18,22,28,0.82), rgba(12,15,20,0.62));
          backdrop-filter: saturate(1.15) blur(10px);
          border: 1px solid var(--border);
          box-shadow: var(--shadow), inset 0 1px rgba(255,255,255,0.06);
          z-index: 10;
          pointer-events: auto;
          min-height: 64px;
        }

        .brand {
          display: flex;
          align-items: center;
          gap: 10px;
          margin-right: 8px;
        }
        .brand img {
          width: var(--brand-img);
          height: var(--brand-img);
          object-fit: contain;
          border-radius: 50%;
          box-shadow: 0 0 0 1px rgba(255,255,255,0.12), 0 6px 18px rgba(0,0,0,0.35);
        }
        .brand .name {
          font-weight: 800;
          letter-spacing: 0.06em;
          color: var(--text);
          font-size: var(--brand-text);
          text-shadow: 0 1px 0 rgba(0,0,0,0.35);
        }

        /* ---------- Control groups ---------- */
        .ctrl { display: flex; align-items: center; gap: 6px; }
        .ctrl.grow { min-width: 320px; }

        .label { font-size: 12px; color: var(--muted); opacity: 0.9; }
        .small { font-size: 12px; color: var(--muted); opacity: 0.85; }

        /* ---------- Selects ---------- */
        .select {
          appearance: none;
          background: linear-gradient(180deg, #12171e, #0f141a);
          color: var(--text);
          border: 1px solid var(--border-strong);
          border-radius: 10px;
          padding: 6px 28px 6px 10px;
          font-size: 12px;
          outline: none;
          height: 32px;
          box-shadow: inset 0 0 0 1px rgba(255,255,255,0.02);
          transition: border-color .18s ease, box-shadow .18s ease, transform .06s ease;
          background-image:
            linear-gradient(180deg, transparent 0 50%, rgba(255,255,255,0.02) 50% 100%),
            radial-gradient(circle at right 12px center, var(--accent) 0 2px, transparent 3px);
          background-repeat: no-repeat;
        }

        /* ---------- Buttons & Sliders ---------- */
        .btn {
          background: linear-gradient(180deg, #1b222c, #141a22);
          color: #d7dde6;
          border: 1px solid var(--border-strong);
          border-radius: 11px;
          height: 32px;
          padding: 0 12px;
          font-size: 12px;
          display: inline-flex;
          align-items: center;
          gap: 6px;
          box-shadow: inset 0 0 0 1px rgba(255,255,255,0.02);
        }
        .btn.primary {
          background: linear-gradient(180deg, var(--accent), var(--accent-deep));
          color: #0b0e12;
          border-color: rgba(255,180,120,0.9);
          font-weight: 700;
          box-shadow: 0 0 0 1px rgba(255,255,255,0.06), 0 6px 24px var(--glow);
        }

        .slider {
          -webkit-appearance: none;
          width: 160px;
          height: 6px;
          border-radius: 999px;
          background: linear-gradient(90deg, rgba(229,129,43,0.35), rgba(207,106,20,0.25));
          box-shadow: inset 0 1px 1px rgba(255,255,255,0.06), 0 0 0 1px var(--border);
          outline: none;
        }

        /* ---------- Toggles (checkboxes) ---------- */
        .toggle { display:flex; align-items:center; gap:6px; color: var(--muted); font-size:12px; }
        .toggle input { accent-color: var(--accent); }

        /* ---------- Docked panel underlay ---------- */
        .panel-wrap {
          pointer-events: auto;
          border-radius: 14px;
          background: linear-gradient(180deg, rgba(14,18,23,0.66), rgba(10,13,17,0.58));
          border: 1px solid var(--border);
          box-shadow: var(--shadow), inset 0 1px rgba(255,255,255,0.04);
        }

        /* Keep grid colors */
        :root {
          --grid-cell: rgba(80, 110, 140, 0.25);
          --grid-section: rgba(120, 160, 200, 0.35);
        }

        /* ---------- Mobile / Compact tweaks ---------- */
        @media (max-width: 900px), (max-height: 700px) {
          .toolbar { gap: 8px; padding: 10px 12px; }
          .brand .name { display: none; }      /* keep just the logo */
          .ctrl.grow { min-width: 180px; }
          .btn { height: 30px; font-size: 12px; padding: 0 10px; }
          .select { height: 30px; font-size: 12px; }
          .small { font-size: 11px; }
        }

        @media (prefers-reduced-motion: reduce) {
          .btn, .select, .slider, .toolbar { transition: none !important; }
        }
      `}</style>
    </div>
  );
}
