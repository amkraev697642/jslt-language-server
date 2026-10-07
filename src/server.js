// JSLT language server over stdio or Node IPC (whatever the client starts it with).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  createConnection, ProposedFeatures, TextDocuments, TextDocumentSyncKind, CompletionItemKind, MarkupKind, TextEdit, Range,
} from "vscode-languageserver/node";
import { TextDocument } from "vscode-languageserver-textdocument";
import { candidates, formatJslt, wordInfo } from "jslt-editor/core";
import { diagnose, importedFiles } from "./analysis.js";

const connection = createConnection(ProposedFeatures.all);
const documents = new TextDocuments(TextDocument);

const KINDS = {
  function: CompletionItemKind.Function, variable: CompletionItemKind.Variable, keyword: CompletionItemKind.Keyword,
  namespace: CompletionItemKind.Module, constant: CompletionItemKind.Constant,
};

// Imports resolve next to the document; an open (maybe unsaved) copy wins over the file on disk.
const importReader = (uri) => {
  let dir = process.cwd();
  try { dir = path.dirname(fileURLToPath(uri)); } catch { /* untitled document */ }
  return (name) => {
    const file = path.resolve(dir, name);
    const open = documents.get(pathToFileURL(file).href);
    if (open) return open.getText();
    try { return fs.readFileSync(file, "utf8"); } catch { return null; }
  };
};
const docName = (uri) => { try { return path.basename(fileURLToPath(uri)); } catch { return uri; } };

function validate(doc) {
  const diagnostics = diagnose(doc.getText(), docName(doc.uri), importReader(doc.uri)).map((d) => ({
    range: Range.create(doc.positionAt(d.from), doc.positionAt(d.to)), message: d.message, severity: 1, source: "jslt",
  }));
  connection.sendDiagnostics({ uri: doc.uri, diagnostics });
}
// any edit can change what another open file imports, so recheck them all
const validateAll = () => documents.all().forEach(validate);

connection.onInitialize(() => ({
  capabilities: {
    textDocumentSync: TextDocumentSyncKind.Incremental,
    completionProvider: { triggerCharacters: ["$", ":"] },
    hoverProvider: true,
    documentFormattingProvider: true,
  },
}));

documents.onDidChangeContent(validateAll);
documents.onDidClose((e) => connection.sendDiagnostics({ uri: e.document.uri, diagnostics: [] }));

connection.onCompletion((p) => {
  const doc = documents.get(p.textDocument.uri);
  if (!doc) return [];
  const lineStart = { line: p.position.line, character: 0 };
  const before = doc.getText(Range.create(lineStart, p.position));
  const text = doc.getText();
  const r = candidates(before, text, importedFiles(text, importReader(doc.uri)));
  if (!r) return [];
  const range = Range.create({ line: p.position.line, character: r.from }, p.position);
  return r.options.map((o) => ({
    label: o.label,
    kind: KINDS[o.type],
    detail: o.detail ? o.label + o.detail : undefined,
    documentation: o.info ? { kind: MarkupKind.PlainText, value: o.info } : undefined,
    textEdit: TextEdit.replace(range, o.apply || o.label),
  }));
});

connection.onHover((p) => {
  const doc = documents.get(p.textDocument.uri);
  if (!doc) return null;
  const line = doc.getText(Range.create({ line: p.position.line, character: 0 }, { line: p.position.line + 1, character: 0 })).replace(/\r?\n$/, "");
  const w = wordInfo(line, p.position.character, doc.getText());
  if (!w) return null;
  return {
    contents: { kind: MarkupKind.Markdown, value: "```jslt\n" + w.sig + "\n```\n" + w.doc },
    range: Range.create({ line: p.position.line, character: w.from }, { line: p.position.line, character: w.to }),
  };
});

connection.onDocumentFormatting((p) => {
  const doc = documents.get(p.textDocument.uri);
  if (!doc) return [];
  const text = doc.getText(), out = formatJslt(text);
  return out === text ? [] : [TextEdit.replace(Range.create(doc.positionAt(0), doc.positionAt(text.length)), out)];
});

documents.listen(connection);
connection.listen();
