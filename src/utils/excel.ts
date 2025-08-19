// src/utils/excel.ts
import { read, utils } from "xlsx";

export type Row = Record<string, number>;
export type RowsBySheet = Record<string, Row[]>;

/** Parse a File chosen via <input> */
export async function parseExcelToDataSets(file: File, fpsGuess = 120): Promise<RowsBySheet> {
  const buf = await file.arrayBuffer();
  return parseWorkbookArrayBuffer(buf, fpsGuess);
}

/** Parse an Excel file fetched from a URL (served from /public) */
export async function parseExcelUrlToDataSets(url: string, fpsGuess = 120): Promise<RowsBySheet> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch Excel: ${res.status} ${res.statusText}`);
  const buf = await res.arrayBuffer();
  return parseWorkbookArrayBuffer(buf, fpsGuess);
}

/** Core parser used by both helpers */
export function parseWorkbookArrayBuffer(buf: ArrayBuffer, fpsGuess = 120): RowsBySheet {
  const wb = read(buf, { type: "array" });
  const out: RowsBySheet = {};

  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName];
    if (!ws) continue;

    const table: any[][] = utils.sheet_to_json(ws, { header: 1, defval: null, raw: true });
    if (!Array.isArray(table) || table.length === 0) continue;

    const { headers, dataRows } = detectHeaderAndExtract(table);
    if (!headers.length || dataRows.length === 0) continue;

    const rowsRaw = toObjects(headers, dataRows);
    const cleaned = normalizeSheet(rowsRaw, fpsGuess);
    if (cleaned.length && cleaned.some((r) => Object.keys(r).some((k) => k !== "t"))) {
      out[sheetName] = cleaned;
    }
  }
  return out;
}

/** Legacy single-sheet helper retained for compatibility. */
export async function parseExcelToRows(file: File, fpsGuess = 120): Promise<Row[]> {
  const sets = await parseExcelToDataSets(file, fpsGuess);
  const names = Object.keys(sets);
  const pref =
    names.find((n) => /joint.*position/i.test(n)) ??
    names.find((n) => /baseball.*data/i.test(n)) ??
    names.find((n) => /signal|data|sheet1/i.test(n)) ??
    names[0];
  return pref ? sets[pref] : [];
}

/* -------------------- header + normalize helpers -------------------- */

function detectHeaderAndExtract(table: any[][]): { headers: string[]; dataRows: any[][] } {
  const scanUpto = Math.min(table.length, 20);
  let bestIdx = 0;
  let bestScore = -1;

  for (let i = 0; i < scanUpto; i++) {
    const row = table[i] ?? [];
    const nonEmpty = row.filter((c) => typeof c === "string" && c.trim() !== "").length;
    const hasTime = row.some((c) => typeof c === "string" && /^(t|time|timestamp)$/i.test(c.trim()));
    const hasFrame = row.some((c) => typeof c === "string" && /frame/i.test(c.trim()));

    let score = nonEmpty + (hasTime ? 3 : 0) + (hasFrame ? 2 : 0);
    if (nonEmpty <= 1) score -= 3; // penalize title-only rows

    if (score > bestScore) {
      bestScore = score;
      bestIdx = i;
    }
  }

  const rawHeaders = (table[bestIdx] ?? []).map((v) => (v == null ? "" : String(v)));
  const headers = dedupeHeaders(
    rawHeaders.map((h, i) => {
      const t = h.trim();
      return t !== "" ? t : `EMPTY ${i + 1}`;
    })
  );

  const dataRows = table.slice(bestIdx + 1);
  return { headers, dataRows };
}

function toObjects(headers: string[], dataRows: any[][]): Array<Record<string, any>> {
  const out: Array<Record<string, any>> = [];
  for (const r of dataRows) {
    const obj: Record<string, any> = {};
    for (let i = 0; i < headers.length; i++) {
      const key = headers[i];
      obj[key] = i < r.length ? r[i] : null;
    }
    out.push(obj);
  }
  return out;
}

function dedupeHeaders(hs: string[]): string[] {
  const seen = new Map<string, number>();
  return hs.map((h) => {
    const base = h;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return n === 1 ? base : `${base} (${n})`;
  });
}

function normalizeSheet(rowsRaw: any[], fpsGuess = 120): Row[] {
  if (!rowsRaw.length) return [];

  const keys = Object.keys(rowsRaw[0] ?? {});
  const timeKey =
    keys.find((k) => /^t$/i.test(k)) ??
    keys.find((k) => /^time$/i.test(k)) ??
    keys.find((k) => /timestamp/i.test(k)) ??
    keys.find((k) => /(time).*?(s|sec|seconds)/i.test(k));
  const msKey = keys.find((k) => /(ms|millisecond)/i.test(k));
  const frameKey = keys.find((k) => /^frame(s)?$/i.test(k) || /frame ?index/i.test(k));

  const num = (v: any) => {
    if (typeof v === "number") return v;
    if (v == null) return NaN;
    const s = String(v).trim().replace(/,/g, "");
    const n = Number(s);
    return Number.isFinite(n) ? n : NaN;
  };

  let ts0 = 0;
  if (!timeKey && keys.some((k) => /timestamp/i.test(k))) {
    const k = keys.find((k) => /timestamp/i.test(k))!;
    const first = rowsRaw.find((r) => r[k] != null)?.[k];
    const p = typeof first === "number" ? first : Date.parse(first);
    if (isFinite(p)) ts0 = p;
  }

  const out: Row[] = [];
  for (let i = 0; i < rowsRaw.length; i++) {
    const r = rowsRaw[i];
    const row: Row = {};
    let tSec = NaN;

    if (timeKey) {
      const v = r[timeKey];
      const n = num(v);
      const looksMs =
        !!msKey ||
        (Number.isFinite(n) && n > 50 && averageDelta(rowsRaw, timeKey) > 10);
      tSec = Number.isFinite(n) ? (looksMs ? n / 1000 : n) : NaN;
    } else if (frameKey) {
      const f = num(r[frameKey]);
      tSec = Number.isFinite(f) ? f / (fpsGuess || 120) : NaN;
    } else if (keys.some((k) => /timestamp/i.test(k))) {
      const k = keys.find((k) => /timestamp/i.test(k))!;
      const ts = typeof r[k] === "number" ? (r[k] as number) : Date.parse(r[k]);
      tSec = Number.isFinite(ts) ? (ts - ts0) / 1000 : NaN;
    }

    if (!Number.isFinite(tSec)) tSec = rowsRaw.length > 1 ? i / (rowsRaw.length - 1) : 0;
    row.t = tSec;

    for (const k of keys) {
      if (k === timeKey || k === frameKey) continue;
      if (/^t$|^time$|timestamp|ms|millisecond/i.test(k)) continue;
      const v = num(r[k]);
      if (Number.isFinite(v)) row[k] = v;
    }

    if (Object.keys(row).some((k) => k !== "t")) out.push(row);
  }

  return out;
}

function averageDelta(rows: any[], key: string): number {
  const vals: number[] = [];
  for (const r of rows) {
    const x = r[key];
    const n = typeof x === "number" ? x : Number(x);
    if (Number.isFinite(n)) vals.push(n);
  }
  if (vals.length < 2) return NaN;
  let sum = 0;
  for (let i = 1; i < vals.length; i++) sum += Math.abs(vals[i] - vals[i - 1]);
  return sum / (vals.length - 1);
}
