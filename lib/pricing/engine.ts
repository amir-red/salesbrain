/**
 * Server-side pricing calculation engine.
 *
 * Loads a versioned .xlsx pricing tool from disk, writes the deal-specific
 * inputs into the workbook (via named ranges, with cell-coordinate fallback),
 * evaluates all formulas with HyperFormula, and reads back the named output
 * cells. Returns a typed `{outputs, pnl}`.
 *
 * Server-only — uses `fs` and HyperFormula's full evaluator.
 */

import fs from 'fs/promises';
import * as XLSX from 'xlsx';
import { HyperFormula } from 'hyperformula';
import {
  CELL_FALLBACKS,
  OUTPUT_NAMES,
  PNL_OUTPUT_NAMES,
  type PricingInputs,
  type PricingOutputs,
  type PricingPnl,
} from './inputs';

export interface PricingCalcResult {
  outputs: PricingOutputs;
  pnl: PricingPnl;
}

/** Reads the workbook, evaluates with the given input overrides, returns
 *  the typed outputs. Single shot — no caching between calls (the workbook
 *  load + HyperFormula init is ~50–200ms for files of this size). */
export async function calculatePricing(
  toolPath: string,
  inputs: Partial<PricingInputs>,
): Promise<PricingCalcResult> {
  const buf = await fs.readFile(toolPath);
  const wb = XLSX.read(buf, { type: 'buffer', cellNF: true, cellFormula: true });

  // ── Convert each SheetJS sheet to a 2D array suitable for HyperFormula ──
  // We pass formulas as-is (HyperFormula parses them) and skip the calculated
  // values SheetJS may also carry — we want HyperFormula to recompute.
  const sheets: Record<string, (string | number | boolean | null)[][]> = {};
  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName];
    sheets[sheetName] = sheetToArray(ws);
  }

  const hf = HyperFormula.buildFromSheets(sheets, {
    licenseKey: 'gpl-v3',                // HyperFormula is MIT/GPL dual-licensed
    smartRounding: true,
  });

  try {
    // ── Apply input overrides ──
    for (const [name, raw] of Object.entries(inputs)) {
      if (raw === undefined) continue;
      const ref = resolveName(wb, name);
      if (!ref) continue;                  // unknown name — skip silently
      const { sheet, row, col } = ref;
      const sheetId = hf.getSheetId(sheet);
      if (sheetId === undefined) continue;
      hf.setCellContents({ sheet: sheetId, row, col }, [[raw as number | string]]);
    }

    // ── Read outputs ──
    const outputs = {} as PricingOutputs;
    for (const name of OUTPUT_NAMES) {
      outputs[name] = readNamedValue(hf, wb, name);
    }
    const pnl = {} as PricingPnl;
    for (const name of PNL_OUTPUT_NAMES) {
      pnl[name] = readNamedValue(hf, wb, name);
    }

    return { outputs, pnl };
  } finally {
    hf.destroy();
  }
}

// ─── Helpers ───────────────────────────────────────────────────────────────

interface CellRef { sheet: string; row: number; col: number; }

/** Resolve a logical name (e.g. 'seats') to a concrete cell. Prefers the
 *  Excel workbook's defined names; falls back to the hardcoded coords in
 *  CELL_FALLBACKS so the engine works even before named ranges are added.
 */
function resolveName(wb: XLSX.WorkBook, name: string): CellRef | null {
  // 1) Try workbook-defined names. SheetJS exposes them on wb.Workbook.Names
  //    as `{Name, Ref}` where Ref looks like "'Sheet Name'!$C$9".
  const defined = wb.Workbook?.Names ?? [];
  const hit = defined.find((d) => d.Name === name);
  if (hit?.Ref) {
    const parsed = parseExcelRef(hit.Ref);
    if (parsed) return parsed;
  }
  // 2) Fall back to the hardcoded coord map.
  const fallback = CELL_FALLBACKS[name];
  if (fallback) {
    const parsed = parseExcelRef(fallback);
    if (parsed) return parsed;
  }
  return null;
}

function readNamedValue(hf: HyperFormula, wb: XLSX.WorkBook, name: string): number | null {
  const ref = resolveName(wb, name);
  if (!ref) return null;
  const sheetId = hf.getSheetId(ref.sheet);
  if (sheetId === undefined) return null;
  const v = hf.getCellValue({ sheet: sheetId, row: ref.row, col: ref.col });
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (v === null || v === undefined) return null;
  if (typeof v === 'object' && 'value' in v) {
    // HyperFormula returns DetailedCellError for error cells.
    return null;
  }
  return null;
}

/** Parse an Excel-style reference like `'1. Sales Calculator'!$C$9` (or
 *  with/without quotes, with/without `$`) into `{sheet, row, col}` using
 *  0-indexed row/col which is what HyperFormula uses. */
function parseExcelRef(ref: string): CellRef | null {
  // Strip any leading "=" (defined names sometimes start with it)
  const r = ref.replace(/^=/, '').trim();
  // Match: optional quoted sheet name, '!', cell coord ($A$1 / A1)
  const m = r.match(/^(?:'([^']+)'|([^!]+))!\$?([A-Z]+)\$?(\d+)$/i);
  if (!m) return null;
  const sheet = (m[1] ?? m[2]).trim();
  const colLetters = m[3].toUpperCase();
  const row1Indexed = parseInt(m[4], 10);
  // Convert letter (A=0, B=1, …, Z=25, AA=26, …) to 0-indexed col
  let col = 0;
  for (let i = 0; i < colLetters.length; i++) {
    col = col * 26 + (colLetters.charCodeAt(i) - 'A'.charCodeAt(0) + 1);
  }
  col -= 1;
  return { sheet, row: row1Indexed - 1, col };
}

/** Convert a SheetJS worksheet to a row-major 2D array. We preserve
 *  formulas (cell.f → "=…") so HyperFormula can re-evaluate them, and
 *  pass through literal values otherwise. */
/** CRITICAL: always iterate from A1 (row 0, col 0). The sheet's `!ref` can
 *  start mid-sheet if there's no data in the top-left (e.g. our pricing tool
 *  uses column B onward, leaving column A empty). HyperFormula uses absolute
 *  0-indexed coords, so any offset in our row arrays would shift every
 *  reference left, returning wrong cells. Force the range to start at A1. */
function sheetToArray(ws: XLSX.WorkSheet): (string | number | boolean | null)[][] {
  if (!ws['!ref']) return [];
  const range = XLSX.utils.decode_range(ws['!ref']);
  const rows: (string | number | boolean | null)[][] = [];
  for (let r = 0; r <= range.e.r; r++) {
    const rowOut: (string | number | boolean | null)[] = [];
    for (let c = 0; c <= range.e.c; c++) {
      const addr = XLSX.utils.encode_cell({ r, c });
      const cell = ws[addr];
      if (!cell) { rowOut.push(null); continue; }
      // Prefer the formula so HyperFormula re-evaluates with our input
      // overrides. Otherwise the literal value.
      if (cell.f) {
        rowOut.push('=' + cell.f);
      } else if (cell.v !== undefined && cell.v !== null) {
        rowOut.push(cell.v as string | number | boolean);
      } else {
        rowOut.push(null);
      }
    }
    rows.push(rowOut);
  }
  return rows;
}

// ─── Active-tool helper (DB lookup) ────────────────────────────────────────

import pool from '../db';

export interface PricingTool {
  id: string;
  version: number;
  filename: string;
  storage_path: string;
  uploaded_at: string;
  is_active: boolean;
  notes: string | null;
}

export async function getActiveTool(): Promise<PricingTool | null> {
  const { rows } = await pool.query<PricingTool>(
    `SELECT id, version, filename, storage_path, uploaded_at, is_active, notes
     FROM pricing_tools WHERE is_active = true LIMIT 1`,
  );
  return rows[0] ?? null;
}

export async function getToolById(id: string): Promise<PricingTool | null> {
  const { rows } = await pool.query<PricingTool>(
    `SELECT id, version, filename, storage_path, uploaded_at, is_active, notes
     FROM pricing_tools WHERE id = $1 LIMIT 1`, [id],
  );
  return rows[0] ?? null;
}
