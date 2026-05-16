import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { resolveRootTex } from '../build/rootResolver';

/**
 * Provides completion items for three common LaTeX constructs:
 *   \ref{...}, \eqref{...}, \autoref{...}, \pageref{...}, \nameref{...}
 *     → labels harvested from all \label{...} commands in the project.
 *   \cite{...}, \citep{...}, \citet{...}, \nocite{...}
 *     → BibTeX keys harvested from all .bib files referenced by the project.
 *   \includegraphics[...]{...} and \input{...}, \include{...}
 *     → relative file paths under the root directory.
 *
 * Caching is per-root-directory; the cache is invalidated on save of any
 * .tex or .bib file under that root.
 */

interface ProjectIndex {
  labels: Map<string, vscode.Location>;
  bibKeys: Map<string, vscode.Location>;
}

const indexCache = new Map<string, ProjectIndex>();

export function registerCompletion(context: vscode.ExtensionContext): void {
  const provider: vscode.CompletionItemProvider = {
    provideCompletionItems(doc, position) {
      const linePrefix = doc.lineAt(position).text.substring(0, position.character);

      // \ref-family
      const refMatch = linePrefix.match(/\\(?:ref|eqref|autoref|pageref|nameref)\{([^}]*)$/);
      if (refMatch) {
        const idx = ensureIndex(doc);
        const items: vscode.CompletionItem[] = [];
        for (const [label, loc] of idx.labels) {
          const item = new vscode.CompletionItem(label, vscode.CompletionItemKind.Reference);
          item.detail = path.basename(loc.uri.fsPath) + ':' + (loc.range.start.line + 1);
          items.push(item);
        }
        return items;
      }

      // \cite-family
      const citeMatch = linePrefix.match(/\\(?:cite[a-z]*|nocite)(?:\[[^\]]*\])?\{(?:[^},]*,\s*)*([^},]*)$/i);
      if (citeMatch) {
        const idx = ensureIndex(doc);
        const items: vscode.CompletionItem[] = [];
        for (const [key, loc] of idx.bibKeys) {
          const item = new vscode.CompletionItem(key, vscode.CompletionItemKind.Value);
          item.detail = path.basename(loc.uri.fsPath);
          items.push(item);
        }
        return items;
      }

      // \includegraphics / \input / \include — file path completion
      const fileMatch = linePrefix.match(/\\(?:includegraphics|input|include|subfile)(?:\[[^\]]*\])?\{([^}]*)$/);
      if (fileMatch) {
        return completeFilePath(doc, fileMatch[1]);
      }
      return undefined;
    }
  };

  context.subscriptions.push(
    vscode.languages.registerCompletionItemProvider(
      { language: 'latex' },
      provider,
      '{', ',', '/'
    )
  );

  // Invalidate cache when any project file is saved.
  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument((doc) => {
      if (!/\.(tex|ltx|sty|cls|bib)$/i.test(doc.fileName)) return;
      indexCache.clear();
    })
  );
}

function ensureIndex(doc: vscode.TextDocument): ProjectIndex {
  const rootTex = resolveRootTex(doc);
  const rootDir = path.dirname(rootTex);
  const cached = indexCache.get(rootDir);
  if (cached) return cached;
  const idx: ProjectIndex = { labels: new Map(), bibKeys: new Map() };
  indexAllUnder(rootDir, idx);
  indexCache.set(rootDir, idx);
  return idx;
}

/** Walk the root directory (depth-capped) collecting labels and bib keys. */
function indexAllUnder(rootDir: string, idx: ProjectIndex): void {
  const MAX_DEPTH = 5;
  const MAX_FILES = 500;
  let visited = 0;

  const walk = (dir: string, depth: number) => {
    if (depth > MAX_DEPTH || visited > MAX_FILES) return;
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch { return; }
    for (const e of entries) {
      if (visited > MAX_FILES) return;
      if (e.name.startsWith('.') || e.name === 'node_modules') continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        walk(full, depth + 1);
      } else if (/\.(tex|ltx)$/i.test(e.name)) {
        scanTex(full, idx);
        visited++;
      } else if (/\.bib$/i.test(e.name)) {
        scanBib(full, idx);
        visited++;
      }
    }
  };
  walk(rootDir, 0);
}

function scanTex(file: string, idx: ProjectIndex): void {
  let text: string;
  try { text = fs.readFileSync(file, 'utf8'); } catch { return; }
  const uri = vscode.Uri.file(file);
  const labelRe = /\\label\{([^}]+)\}/g;
  let m: RegExpExecArray | null;
  while ((m = labelRe.exec(text)) !== null) {
    const line = text.slice(0, m.index).split(/\r?\n/).length - 1;
    if (!idx.labels.has(m[1])) {
      idx.labels.set(m[1], new vscode.Location(uri, new vscode.Position(line, 0)));
    }
  }
}

function scanBib(file: string, idx: ProjectIndex): void {
  let text: string;
  try { text = fs.readFileSync(file, 'utf8'); } catch { return; }
  const uri = vscode.Uri.file(file);
  // Match @type{key, ...} — captures the key.
  const re = /@\s*[A-Za-z]+\s*\{\s*([^,\s}]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const line = text.slice(0, m.index).split(/\r?\n/).length - 1;
    if (!idx.bibKeys.has(m[1])) {
      idx.bibKeys.set(m[1], new vscode.Location(uri, new vscode.Position(line, 0)));
    }
  }
}

function completeFilePath(doc: vscode.TextDocument, fragment: string): vscode.CompletionItem[] {
  const rootDir = path.dirname(resolveRootTex(doc));
  const fragDir = path.dirname(fragment);
  const baseDir = path.resolve(rootDir, fragDir);
  let entries: fs.Dirent[] = [];
  try {
    entries = fs.readdirSync(baseDir, { withFileTypes: true });
  } catch { return []; }
  const items: vscode.CompletionItem[] = [];
  for (const e of entries) {
    if (e.name.startsWith('.')) continue;
    const kind = e.isDirectory()
      ? vscode.CompletionItemKind.Folder
      : vscode.CompletionItemKind.File;
    const item = new vscode.CompletionItem(e.name, kind);
    if (e.isDirectory()) item.insertText = e.name + '/';
    items.push(item);
  }
  return items;
}
