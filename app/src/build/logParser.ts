import * as vscode from 'vscode';
import * as path from 'path';

export interface ParsedDiagnostic {
  file: string;
  line: number;
  severity: vscode.DiagnosticSeverity;
  message: string;
}

/**
 * Parse a LaTeX engine log into structured diagnostics.
 *
 * Recognises two common forms:
 *   - `file:line: message`  (file-line-error style; emitted by pdflatex/xelatex
 *     with `-file-line-error` and by tectonic in error summaries)
 *   - `! LaTeX Error: ...` followed by `l.<n>` on a later line (classic style)
 *   - `LaTeX Warning: ... on input line N.`
 *
 * This is intentionally conservative — false negatives are preferred to
 * false positives polluting the Problems panel.
 */
export function parseLatexLog(log: string, rootDir: string): ParsedDiagnostic[] {
  const diagnostics: ParsedDiagnostic[] = [];
  const lines = log.split(/\r?\n/);

  const fileLineError = /^(?:\.\/)?([^:\n]+\.(?:tex|sty|cls|ltx)):(\d+):\s*(.+)$/i;
  const latexWarning = /^(LaTeX|Package\s+\S+)\s+Warning:\s+(.+?)(?:\s+on input line\s+(\d+))?\.?$/i;
  const bangError = /^!\s*(.+)$/;
  const lineRef = /^l\.(\d+)\b/;

  let pendingBang: string | null = null;
  let pendingFile: string | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    const m1 = line.match(fileLineError);
    if (m1) {
      diagnostics.push({
        file: path.resolve(rootDir, m1[1]),
        line: Math.max(0, parseInt(m1[2], 10) - 1),
        severity: vscode.DiagnosticSeverity.Error,
        message: m1[3].trim()
      });
      continue;
    }

    const m2 = line.match(latexWarning);
    if (m2) {
      diagnostics.push({
        file: pendingFile ?? path.resolve(rootDir, 'unknown.tex'),
        line: m2[3] ? Math.max(0, parseInt(m2[3], 10) - 1) : 0,
        severity: vscode.DiagnosticSeverity.Warning,
        message: `${m2[1]}: ${m2[2].trim()}`
      });
      continue;
    }

    const m3 = line.match(bangError);
    if (m3) {
      pendingBang = m3[1].trim();
      continue;
    }

    if (pendingBang) {
      const m4 = line.match(lineRef);
      if (m4) {
        diagnostics.push({
          file: pendingFile ?? path.resolve(rootDir, 'unknown.tex'),
          line: Math.max(0, parseInt(m4[1], 10) - 1),
          severity: vscode.DiagnosticSeverity.Error,
          message: pendingBang
        });
        pendingBang = null;
      }
    }

    // Track the most recently opened source file (very rough; TeX log is messy).
    const openFile = line.match(/\(((?:\.\/)?[^()\s]+\.(?:tex|sty|cls|ltx))/i);
    if (openFile) {
      pendingFile = path.resolve(rootDir, openFile[1]);
    }
  }

  return diagnostics;
}

/** Group parsed diagnostics by file and publish to the given collection. */
export function publishDiagnostics(
  collection: vscode.DiagnosticCollection,
  parsed: ParsedDiagnostic[]
): void {
  collection.clear();
  const byFile = new Map<string, vscode.Diagnostic[]>();
  for (const d of parsed) {
    const range = new vscode.Range(d.line, 0, d.line, Number.MAX_SAFE_INTEGER);
    const diag = new vscode.Diagnostic(range, d.message, d.severity);
    diag.source = 'LaTeX Studio';
    const arr = byFile.get(d.file) ?? [];
    arr.push(diag);
    byFile.set(d.file, arr);
  }
  for (const [file, diags] of byFile) {
    collection.set(vscode.Uri.file(file), diags);
  }
}
