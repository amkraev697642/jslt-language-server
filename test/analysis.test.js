import { test } from "node:test";
import assert from "node:assert/strict";
import { diagnose, importedFiles } from "../src/analysis.js";

const reader = (files) => (n) => (n in files ? files[n] : null);

test("diagnose: clean program, syntax error range, unknown function", () => {
  assert.deepEqual(diagnose('{ "a": uppercase(.b) }', "m.jslt", reader({})), []);
  const text = '{ "a": uppercase(.b }';
  const [d] = diagnose(text, "m.jslt", reader({}));
  assert.equal(text.slice(d.from, d.to), "}");
  assert.match(d.message, /expected RPAREN/);
  const [u] = diagnose('{ "a": nosuch(.b) }', "m.jslt", reader({}));
  assert.match(u.message, /nosuch/);
});

test("diagnose: imports resolve; an error inside an imported file lands on its import statement", () => {
  const main = 'import "lib.jslt" as lib\n{ "x": lib:f(.a) }';
  assert.deepEqual(diagnose(main, "main.jslt", reader({ "lib.jslt": "def f(x) $x" })), []);
  const [d] = diagnose(main, "main.jslt", reader({ "lib.jslt": "def f(x\n" }));
  assert.equal(main.slice(d.from, d.to), 'import "lib.jslt"');
  assert.match(d.message, /^lib\.jslt:\d+:\d+: /);
  const [missing] = diagnose(main, "main.jslt", reader({}));
  assert.match(missing.message, /lib\.jslt/);
});

test("importedFiles reads each imported file once and skips unreadable ones", () => {
  const text = 'import "a.jslt" as a\nimport "gone.jslt" as g';
  const files = importedFiles(text, reader({ "a.jslt": "def x() 1" }));
  assert.deepEqual([...files.keys()], ["a.jslt"]);
});
