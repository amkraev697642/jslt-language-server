// End to end: starts the real server and speaks LSP to it over stdio.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
let proc, buf = Buffer.alloc(0), nextId = 1, stopping = false;
const pending = new Map(), notes = [], waiters = [];
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jslt-lsp-"));
const uri = (f) => pathToFileURL(path.join(dir, f)).href;

function onData(d) {
  buf = Buffer.concat([buf, d]);
  for (;;) {
    const i = buf.indexOf("\r\n\r\n");
    if (i < 0) return;
    const len = +/Content-Length: (\d+)/i.exec(buf.subarray(0, i).toString())[1];
    if (buf.length < i + 4 + len) return;
    const msg = JSON.parse(buf.subarray(i + 4, i + 4 + len).toString());
    buf = buf.subarray(i + 4 + len);
    if (msg.id !== undefined && pending.has(msg.id)) pending.get(msg.id)(msg);
    else if (msg.method) { notes.push(msg); waiters.slice().forEach((w) => w()); }
  }
}
const frame = (o) => { const s = JSON.stringify(o); proc.stdin.write(`Content-Length: ${Buffer.byteLength(s)}\r\n\r\n${s}`); };
const request = (method, params) => new Promise((resolve) => { const id = nextId++; pending.set(id, resolve); frame({ jsonrpc: "2.0", id, method, params }); });
const notify = (method, params) => frame({ jsonrpc: "2.0", method, params });
// the next publishDiagnostics for a document, after `since` notifications
const diagnostics = (u, since) => new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error("no diagnostics for " + u)), 5000);
  const check = () => {
    const n = notes.slice(since).filter((m) => m.method === "textDocument/publishDiagnostics" && m.params.uri === u).pop();
    if (n) { clearTimeout(t); waiters.splice(waiters.indexOf(check), 1); resolve(n.params.diagnostics); }
  };
  waiters.push(check); check();
});
const open = (f, text) => { notify("textDocument/didOpen", { textDocument: { uri: uri(f), languageId: "jslt", version: 1, text } }); };

before(async () => {
  // JSLT_SERVER=/path/to/server.cjs runs the same tests against a bundled build (the VS Code extension ships one)
  const entry = process.env.JSLT_SERVER || path.join(here, "../src/server.js");
  proc = spawn(process.execPath, ["--conditions=source", entry, "--stdio"], { stdio: ["pipe", "pipe", "inherit"] });
  proc.stdout.on("data", onData);
  proc.on("exit", (code) => { if (!stopping) { console.error(`server exited early (${code})`); process.exit(1); } });
  const init = await request("initialize", { processId: process.pid, rootUri: null, capabilities: {} });
  assert.ok(init.result.capabilities.hoverProvider);
  assert.ok(init.result.capabilities.completionProvider);
  assert.ok(init.result.capabilities.documentFormattingProvider);
  notify("initialized", {});
});
after(() => { stopping = true; proc.kill(); fs.rmSync(dir, { recursive: true, force: true }); });

test("diagnostics appear on open, move with the edit and clear when fixed", async () => {
  const since = notes.length;
  open("a.jslt", '{ "a": uppercase(.b }');
  const [d] = await diagnostics(uri("a.jslt"), since);
  assert.equal(d.range.start.line, 0);
  assert.equal(d.range.start.character, 20);
  assert.match(d.message, /expected RPAREN/);
  assert.equal(d.source, "jslt");
  const since2 = notes.length;
  notify("textDocument/didChange", { textDocument: { uri: uri("a.jslt"), version: 2 }, contentChanges: [{ text: '{ "a": uppercase(.b) }' }] });
  assert.deepEqual(await diagnostics(uri("a.jslt"), since2), []);
});

test("completion: built-ins, variables and import aliases", async () => {
  fs.writeFileSync(path.join(dir, "lib.jslt"), "def money(n) $n\ndef other() 1");
  const text = 'import "lib.jslt" as lib\nlet total = 1\n{ "a": upp, "b": $to, "c": lib:mo }';
  open("c.jslt", text);
  const at = (needle) => ({ line: 2, character: text.split("\n")[2].indexOf(needle) + needle.length });
  const labels = async (needle) => {
    const r = await request("textDocument/completion", { textDocument: { uri: uri("c.jslt") }, position: at(needle) });
    return r.result;
  };
  const fn = await labels("upp");
  const upper = fn.find((i) => i.label === "uppercase");
  assert.equal(upper.kind, 3);
  assert.equal(upper.textEdit.newText, "uppercase(");
  assert.deepEqual(upper.textEdit.range, { start: { line: 2, character: 7 }, end: { line: 2, character: 10 } });
  assert.deepEqual((await labels("$to")).map((i) => i.label), ["total"]);
  assert.deepEqual((await labels("lib:mo")).map((i) => i.label).sort(), ["money", "other"]);
});

test("hover shows the signature and doc; nothing for plain words", async () => {
  open("h.jslt", '{ "a": uppercase(.name) }');
  const hover = await request("textDocument/hover", { textDocument: { uri: uri("h.jslt") }, position: { line: 0, character: 11 } });
  assert.match(hover.result.contents.value, /uppercase\(string\)/);
  assert.match(hover.result.contents.value, /Upper-cases/);
  assert.deepEqual(hover.result.range, { start: { line: 0, character: 7 }, end: { line: 0, character: 16 } });
  const none = await request("textDocument/hover", { textDocument: { uri: uri("h.jslt") }, position: { line: 0, character: 21 } });
  assert.equal(none.result, null);
});

test("formatting re-indents bracketed lines and returns no edit when already formatted", async () => {
  open("f.jslt", '{\n"a": [\n1\n]\n}');
  const r = await request("textDocument/formatting", { textDocument: { uri: uri("f.jslt") }, options: { tabSize: 2, insertSpaces: true } });
  assert.equal(r.result[0].newText, '{\n  "a": [\n    1\n  ]\n}\n');
  open("g.jslt", '{\n  "a": 1\n}\n');
  assert.deepEqual((await request("textDocument/formatting", { textDocument: { uri: uri("g.jslt") }, options: {} })).result, []);
});

test("an open copy of an imported file wins over disk, and an error inside it reaches the importer", async () => {
  fs.writeFileSync(path.join(dir, "ok.jslt"), "def f(x) $x");
  const since = notes.length;
  open("m.jslt", 'import "ok.jslt" as ok\n{ "a": ok:f(.a) }');
  assert.deepEqual(await diagnostics(uri("m.jslt"), since), []);
  const since2 = notes.length;
  open("ok.jslt", "def f(x");   // unsaved, broken: the editor's copy is what counts
  const [d] = await diagnostics(uri("m.jslt"), since2);
  assert.equal(d.range.start.line, 0);
  assert.match(d.message, /^ok\.jslt:/);
});
