import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

/**
 * Resolve the "root" .tex file for a given document.
 * Recognises the magic comment `% !TEX root = ../main.tex` (TeXShop / LaTeXWorkshop style).
 * Falls back to the document itself.
 */
export function resolveRootTex(doc: vscode.TextDocument): string {
  const fsPath = doc.uri.fsPath;
  const text = doc.getText();
  const match = text.match(/^\s*%\s*!\s*TEX\s+root\s*=\s*(.+?)\s*$/im);
  if (match) {
    const rel = match[1].trim();
    const abs = path.isAbsolute(rel) ? rel : path.resolve(path.dirname(fsPath), rel);
    if (fs.existsSync(abs)) {
      return abs;
    }
  }
  return fsPath;
}

/**
 * Compute the absolute output directory for a root .tex file based on the
 * `latexStudio.build.outputDirectory` setting.
 */
export function resolveOutputDir(rootTex: string): string {
  const rel = vscode.workspace
    .getConfiguration('latexStudio')
    .get<string>('build.outputDirectory', '.latex-build');
  const dir = path.isAbsolute(rel) ? rel : path.resolve(path.dirname(rootTex), rel);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

/** Expected PDF path inside the build (intermediates) directory. */
export function expectedPdfPath(rootTex: string, outDir: string): string {
  const base = path.basename(rootTex, path.extname(rootTex));
  return path.join(outDir, `${base}.pdf`);
}

/**
 * Final PDF location for the user: sitting next to the source `.tex`, so it
 * is easy to share, link to, and find in the file explorer. The builder
 * copies the freshly compiled PDF here after a successful build.
 */
export function finalPdfPath(rootTex: string): string {
  const base = path.basename(rootTex, path.extname(rootTex));
  return path.join(path.dirname(rootTex), `${base}.pdf`);
}
