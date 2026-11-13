#!/usr/bin/env node
/*
 * Loads the shipped <script id="patient-core"> from booth05/index.html and runs calls given on stdin.
 * Used by patient_guard.py --self-test to check that the Python mirror gives byte-identical results.
 * stdin: [{"fn": "buildPatientPrompt", "args": [...], "caseId": "case01"?}]   (caseId -> the case is passed as the first argument)
 * stdout: [{"ok": value} | {"error": message}]
 */
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

function loadCore() {
  const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  const m = html.match(/<script id="patient-core">([\s\S]*?)<\/script>/);
  if (!m) throw new Error('<script id="patient-core"> not found in booth05/index.html');
  const warnings = [];
  const sandbox = { module: { exports: {} }, console: { log() {}, warn: (s) => warnings.push(String(s)) } };
  vm.createContext(sandbox);
  vm.runInContext(m[1], sandbox, { filename: "patient-core" });
  const C = sandbox.module.exports;
  C._warnings = warnings;
  return C;
}
module.exports = { loadCore };

if (require.main === module) {
  const C = loadCore();
  const calls = JSON.parse(fs.readFileSync(0, "utf8"));
  const out = calls.map((x) => {
    try {
      const args = x.caseId ? [C.CASES.find((c) => c.id === x.caseId)].concat(x.args) : x.args;
      const v = C[x.fn](...args);
      return { ok: v === undefined ? null : JSON.parse(JSON.stringify(v)) };
    } catch (e) {
      return { error: String(e && e.message) };
    }
  });
  process.stdout.write(JSON.stringify(out));
}
