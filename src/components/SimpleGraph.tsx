import React, { useMemo, useRef, useState, useEffect, useCallback } from "react";

type SeriesPoint = { t?: number; value: number };

interface Props {
  data: SeriesPoint[];
  time: number;             // FBX time (s)
  jsonDuration: number;     // duration of the JSON series (s)
  fbxDuration: number;      // duration of the FBX (s)
  height?: number;          // default 180
  title?: string;
  yLabel?: string;          // now shown under the title (not bottom-left)
  onSeek?: (tJson: number) => void;
}

/* ---- helpers ---- */

function useMeasure<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [rect, setRect] = useState<DOMRect | null>(null);
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(() => {
      const r = ref.current!.getBoundingClientRect();
      setRect(r);
    });
    ro.observe(ref.current);
    setRect(ref.current.getBoundingClientRect());
    return () => ro.disconnect();
  }, []);
  return { ref, rect };
}

function nearestIndexByT(arr: SeriesPoint[], t: number) {
  let lo = 0, hi = arr.length - 1;
  if (hi <= 0) return 0;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    const mt = arr[mid].t ?? 0;
    if (mt < t) lo = mid + 1;
    else hi = mid;
  }
  const j = lo;
  const i = Math.max(0, Math.min(arr.length - 1, j));
  const iPrev = Math.max(0, i - 1);
  const dt1 = Math.abs((arr[i].t ?? 0) - t);
  const dt0 = Math.abs((arr[iPrev].t ?? 0) - t);
  return dt0 <= dt1 ? iPrev : i;
}

/* ---- component ---- */

const SimpleGraph: React.FC<Props> = ({
  data,
  time,
  jsonDuration,
  fbxDuration,
  height = 180,
  title,
  yLabel = "Value",
  onSeek,
}) => {
  const { ref, rect } = useMeasure<HTMLDivElement>();

  // x domain
  const xMin = 0;
  const xMax = jsonDuration > 0
    ? jsonDuration
    : Math.max(0, (data.length ? (data[data.length - 1].t ?? 0) : 0));

  // y domain
  const { yMin, yMax } = useMemo(() => {
    if (!data || data.length === 0) return { yMin: 0, yMax: 1 };
    let min = Infinity, max = -Infinity;
    for (const d of data) {
      const v = d.value;
      if (Number.isFinite(v)) {
        if (v < min) min = v;
        if (v > max) max = v;
      }
    }
    if (!Number.isFinite(min) || !Number.isFinite(max)) return { yMin: 0, yMax: 1 };
    if (min === max) {
      const pad = Math.abs(min) > 1 ? Math.abs(min) * 0.05 : 0.5;
      return { yMin: min - pad, yMax: max + pad };
    }
    const pad = (max - min) * 0.08;
    return { yMin: min - pad, yMax: max + pad };
  }, [data]);

  // ticks
  const yTicks = useMemo(() => {
    const n = 4;
    const res: number[] = [];
    if (yMax <= yMin) return res;
    for (let i = 0; i <= n; i++) res.push(yMin + (i / n) * (yMax - yMin));
    return res;
  }, [yMin, yMax]);

  const xTicks = useMemo(() => {
    const n = 5;
    const res: number[] = [];
    if (xMax <= xMin) return res;
    for (let i = 0; i <= n; i++) res.push(xMin + (i / n) * (xMax - xMin));
    return res;
  }, [xMin, xMax]);

  // DYNAMIC left margin so y-tick labels never clip
  const tickStrings = yTicks.map((v) => v.toFixed(2));
  const maxChars = Math.max(4, ...tickStrings.map((s) => s.length)); // e.g. "-1930.42"
  const CHAR_W = 7;                    // ~px at 11px font
  const labelPad = 10;                 // space between labels and plot
  const dynamicLeft = Math.min(120, Math.max(56, maxChars * CHAR_W + labelPad + 8));

  // margins (top leaves room for title & yLabel; bottom for x labels)
  const margin = { top: (title || yLabel) ? 34 : 20, right: 18, bottom: 36, left: dynamicLeft };

  const width = Math.max(160, (rect?.width ?? 420));
  const innerW = Math.max(10, width - margin.left - margin.right);
  const innerH = Math.max(10, height - margin.top - margin.bottom);

  // scales
  const xToPx = useCallback((t: number) => {
    if (xMax <= xMin) return margin.left;
    const u = (t - xMin) / (xMax - xMin);
    return margin.left + u * innerW;
  }, [xMin, xMax, innerW, margin.left]);

  const pxToX = useCallback((px: number) => {
    if (xMax <= xMin) return 0;
    const u = (px - margin.left) / innerW;
    return xMin + Math.min(1, Math.max(0, u)) * (xMax - xMin);
  }, [xMin, xMax, innerW, margin.left]);

  const yToPx = useCallback((y: number) => {
    if (yMax <= yMin) return margin.top + innerH / 2;
    const u = (y - yMin) / (yMax - yMin);
    return margin.top + (1 - u) * innerH;
  }, [yMin, yMax, innerH, margin.top]);

  // path
  const pathD = useMemo(() => {
    if (!data || data.length === 0) return "";
    let d = "";
    for (let i = 0; i < data.length; i++) {
      const t = data[i].t ?? (i / Math.max(1, data.length - 1)) * (xMax - xMin);
      const x = xToPx(t);
      const y = yToPx(data[i].value);
      d += (i === 0 ? `M ${x} ${y}` : ` L ${x} ${y}`);
    }
    return d;
  }, [data, xToPx, yToPx, xMax, xMin]);

  // current playhead in JSON time
  const currentJsonTime =
    fbxDuration > 0 && xMax > 0 ? (time / fbxDuration) * xMax : time;
  const playheadX = xToPx(Math.min(xMax, Math.max(xMin, currentJsonTime)));

  // hover + seek
  const [hoverX, setHoverX] = useState<number | null>(null);
  const [hoverT, setHoverT] = useState<number | null>(null);
  const [hoverVal, setHoverVal] = useState<number | null>(null);

  const updateHover = useCallback((clientX: number, clientY: number) => {
    if (!ref.current) return;
    const box = ref.current.getBoundingClientRect();
    const localX = clientX - box.left;
    const localY = clientY - box.top;
    if (
      localX < margin.left ||
      localX > width - margin.right ||
      localY < margin.top ||
      localY > height - margin.bottom
    ) {
      setHoverX(null); setHoverT(null); setHoverVal(null);
      return;
    }
    const tJson = pxToX(localX);
    let val: number | null = null;
    if (data && data.length > 0) {
      const idx = nearestIndexByT(data, tJson);
      val = data[idx]?.value ?? null;
    }
    setHoverX(localX);
    setHoverT(tJson);
    setHoverVal(val);
  }, [ref, margin, width, height, pxToX, data]);

  const clearHover = useCallback(() => {
    setHoverX(null); setHoverT(null); setHoverVal(null);
  }, []);

  const downRef = useRef(false);
  const onPointerDown = useCallback((e: React.PointerEvent) => {
    downRef.current = true;
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    updateHover(e.clientX, e.clientY);
    if (onSeek && hoverT != null) onSeek(hoverT);
  }, [updateHover, onSeek, hoverT]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    updateHover(e.clientX, e.clientY);
    if (downRef.current && onSeek && hoverT != null) onSeek(hoverT);
  }, [updateHover, onSeek, hoverT]);

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    downRef.current = false;
    (e.currentTarget as Element).releasePointerCapture(e.pointerId);
  }, []);

  // tooltip
  const tooltip = useMemo(() => {
    if (hoverX == null || hoverT == null || hoverVal == null) return null;
    const px = hoverX;
    const py = yToPx(hoverVal);
    const anchorRight = px > margin.left + innerW * 0.6;
    const style: React.CSSProperties = {
      position: "absolute",
      left: Math.round(Math.min(width - 120, Math.max(margin.left, anchorRight ? px - 110 : px + 8))),
      top: Math.round(Math.max(margin.top, py - 28)),
      background: "rgba(15,18,22,0.9)",
      border: "1px solid rgba(255,255,255,0.12)",
      borderRadius: 8,
      fontSize: 12,
      padding: "6px 8px",
      pointerEvents: "none",
      color: "#e9eef7",
      zIndex: 2,
      boxShadow: "0 2px 10px rgba(0,0,0,0.35)",
      whiteSpace: "nowrap",
    };
    return { style, text: `${hoverVal.toFixed(2)} @ ${hoverT.toFixed(3)}s`, cx: px, cy: py };
  }, [hoverX, hoverT, hoverVal, yToPx, margin.left, margin.top, innerW, width]);

  if (!data || data.length === 0) {
    return <div ref={ref} style={{ width: "100%", height }} />;
  }

  return (
    <div ref={ref} style={{ width: "100%", height, position: "relative" }}>
      <svg width={width} height={height} role="img" aria-label={title ?? "signal"}>
        {/* Background */}
        <rect x={0} y={0} width={width} height={height} fill="rgba(12,14,18,0.6)" rx={10} />

        {/* Title + (small) yLabel as subtitle */}
        {(title || yLabel) && (
          <>
            {title && (
              <text x={margin.left} y={16} fill="#cfd6e2" fontSize={12} fontWeight={700}>
                {title}
              </text>
            )}
            {yLabel && (
              <text x={margin.left} y={30} fill="#9fb1c7" fontSize={11}>
                {yLabel}
              </text>
            )}
          </>
        )}

        {/* Y grid + labels (never clipped thanks to dynamic left margin) */}
        {yTicks.map((yv, i) => {
          const y = yToPx(yv);
          const label = yv.toFixed(2);
          return (
            <g key={`yg-${i}`}>
              <line
                x1={margin.left}
                x2={width - margin.right}
                y1={y}
                y2={y}
                stroke="rgba(200,220,255,0.10)"
                strokeWidth={1}
              />
              <text
                x={margin.left - 6}
                y={y + 3}
                textAnchor="end"
                fill="#9fb1c7"
                fontSize={11}
              >
                {label}
              </text>
            </g>
          );
        })}

        {/* X grid + labels */}
        {xTicks.map((xv, i) => {
          const x = xToPx(xv);
          return (
            <g key={`xg-${i}`}>
              <line
                x1={x}
                x2={x}
                y1={margin.top}
                y2={height - margin.bottom}
                stroke="rgba(200,220,255,0.06)"
                strokeWidth={1}
              />
              <text
                x={x}
                y={height - margin.bottom + 18}
                textAnchor="middle"
                fill="#9fb1c7"
                fontSize={11}
              >
                {xv.toFixed(2)}s
              </text>
            </g>
          );
        })}

        {/* Signal */}
        <path d={pathD} fill="none" stroke="#e5812b" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />

        {/* Playhead */}
        <line
          x1={playheadX}
          x2={playheadX}
          y1={margin.top}
          y2={height - margin.bottom}
          stroke="#ffffff"
          strokeWidth={1.2}
          opacity={0.9}
        />

        {/* Hover line (dotted) */}
        {hoverX != null && (
          <line
            x1={hoverX}
            x2={hoverX}
            y1={margin.top}
            y2={height - margin.bottom}
            stroke="#e5812b"
            strokeWidth={1.2}
            strokeDasharray="4 4"
            opacity={0.9}
          />
        )}

        {/* Hover marker */}
        {tooltip && (
          <circle cx={tooltip.cx} cy={tooltip.cy} r={3.5} fill="#e5812b" stroke="#fff" strokeWidth={1} />
        )}

        {/* Interaction layer */}
        <rect
          x={margin.left}
          y={margin.top}
          width={innerW}
          height={innerH}
          fill="transparent"
          style={{ cursor: "crosshair" }}
          onPointerDown={(e) => {
            downRef.current = true;
            (e.currentTarget as Element).setPointerCapture(e.pointerId);
            updateHover(e.clientX, e.clientY);
            if (onSeek && hoverT != null) onSeek(hoverT);
          }}
          onPointerMove={(e) => {
            updateHover(e.clientX, e.clientY);
            if (downRef.current && onSeek && hoverT != null) onSeek(hoverT);
          }}
          onPointerUp={(e) => {
            downRef.current = false;
            (e.currentTarget as Element).releasePointerCapture(e.pointerId);
          }}
          onPointerLeave={() => {
            downRef.current = false;
            clearHover();
          }}
          onPointerCancel={() => {
            downRef.current = false;
            clearHover();
          }}
        />
      </svg>

      {/* Tooltip */}
      {tooltip && (
        <div style={tooltip.style}>
          <div style={{ fontWeight: 700 }}>{tooltip.text.split(" @ ")[0]}</div>
          <div style={{ opacity: 0.85 }}>{tooltip.text.split(" @ ")[1]}</div>
        </div>
      )}
    </div>
  );
};

export default SimpleGraph;
