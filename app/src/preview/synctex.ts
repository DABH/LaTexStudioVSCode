import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as zlib from 'zlib';
import { resolveRootTex, resolveOutputDir, expectedPdfPath } from '../build/rootResolver';

export interface SyncTexHit {
  page: number;     // 1-based
  x: number;        // PDF points
  y: number;        // PDF points
  width: number;
  height: number;
}

/**
 * Minimal pure-TS forward-search reader for SyncTeX `.synctex.gz` files.
 *
 * The SyncTeX format groups records by source file and contains hierarchical
 * boxes for each typeset object. For forward search we want: given a source
 * file + line number, find the visual rectangle(s) in the PDF.
 *
 * We parse only the records we need: file map (`Input:tag:filename`), hbox/
 * vbox openings (`[`, `(`), and leaf nodes (`h`, `v`, `x`, `k`, `g`) with
 * their `line:tag` headers. Coordinates are stored in scaled points (sp);
 * 65536 sp = 1 pt.
 */
export async function forwardSearch(
  doc: vscode.TextDocument,
  line: number
): Promise<SyncTexHit | null> {
  const rootTex = resolveRootTex(doc);
  const outDir = resolveOutputDir(rootTex);
  const pdf = expectedPdfPath(rootTex, outDir);
  const syncFile = pdf.replace(/\.pdf$/i, '.synctex.gz');
  if (!fs.existsSync(syncFile)) {
    return null;
  }
  let raw: Buffer;
  try {
    raw = await new Promise((resolve, reject) => {
      const buffers: Buffer[] = [];
      fs.createReadStream(syncFile)
        .pipe(zlib.createGunzip())
        .on('data', (b: Buffer) => buffers.push(b))
        .on('end', () => resolve(Buffer.concat(buffers)))
        .on('error', reject);
    });
  } catch {
    return null;
  }
  const text = raw.toString('utf8');

  // Build tag → filename map.
  const tagToFile = new Map<number, string>();
  const inputRe = /^Input:(\d+):(.+)$/gm;
  let im: RegExpExecArray | null;
  while ((im = inputRe.exec(text)) !== null) {
    tagToFile.set(parseInt(im[1], 10), im[2].trim());
  }

  // Find the tag for our document.
  const docPath = doc.uri.fsPath;
  let wantedTag = -1;
  for (const [tag, file] of tagToFile) {
    const abs = path.isAbsolute(file) ? file : path.resolve(path.dirname(rootTex), file);
    if (abs === docPath || path.normalize(file) === path.normalize(docPath)) {
      wantedTag = tag;
      break;
    }
  }
  if (wantedTag < 0) return null;

  // Walk through lines, tracking the current page and looking for records
  // matching "<kind><tag>,<line>:..." with tag == wantedTag.
  // Record kinds we accept (in order of preference): h (horizontal), v, x.
  const lines = text.split('\n');
  let currentPage = -1;
  let best: SyncTexHit | null = null;
  let bestLineDelta = Number.POSITIVE_INFINITY;
  const targetLine = line + 1; // SyncTeX is 1-based

  const pageRe = /^\{(\d+)/;
  const recordRe = /^([hvxkg(\[])(\d+),(\d+)(?::(-?\d+),(-?\d+)(?::(-?\d+),(-?\d+),(-?\d+))?)?/;

  for (const ln of lines) {
    const p = ln.match(pageRe);
    if (p) {
      currentPage = parseInt(p[1], 10);
      continue;
    }
    const m = ln.match(recordRe);
    if (!m) continue;
    const tag = parseInt(m[2], 10);
    if (tag !== wantedTag) continue;
    const recLine = parseInt(m[3], 10);
    const delta = Math.abs(recLine - targetLine);
    if (delta > bestLineDelta) continue;
    if (m[4] === undefined) continue; // no coords on this record
    const x = parseInt(m[4], 10);
    const y = parseInt(m[5], 10);
    const w = m[6] !== undefined ? parseInt(m[6], 10) : 0;
    const h = m[7] !== undefined ? parseInt(m[7], 10) : 0;
    const d = m[8] !== undefined ? parseInt(m[8], 10) : 0;
    // Convert sp → pt (1 pt = 65536 sp). Keep PDF coordinate convention:
    // SyncTeX gives (x, y) at the baseline; height extends upward by 'h',
    // depth downward by 'd'.
    const SP = 65536;
    const hit: SyncTexHit = {
      page: Math.max(1, currentPage),
      x: x / SP,
      y: y / SP,
      width: (w || 100 * SP) / SP,
      height: ((h + d) || 12 * SP) / SP
    };
    if (delta < bestLineDelta) {
      best = hit;
      bestLineDelta = delta;
    } else if (delta === bestLineDelta && !best) {
      best = hit;
    }
  }
  return best;
}
