import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const workflowPath = fileURLToPath(new URL("../../../../.github/workflows/us-dashboard.yml", import.meta.url));
const workflow = (await readFile(workflowPath, "utf8")).replace(/\r\n/g, "\n");

function stepBlock(name) {
  const start = workflow.indexOf(`- name: ${name}`);
  assert.notEqual(start, -1, `${name} step missing`);
  const next = workflow.indexOf("\n      - name:", start + 1);
  return workflow.slice(start, next === -1 ? workflow.length : next);
}

test("US publish and deploy steps do not run under always guards", () => {
  for (const name of [
    "Commit updated US outputs",
    "Prepare GitHub Pages artifact",
    "Configure GitHub Pages",
    "Upload GitHub Pages artifact",
    "Deploy GitHub Pages"
  ]) {
    const block = stepBlock(name);
    assert.doesNotMatch(block, /always\(\)/, `${name} must not use always()`);
    assert.match(block, /if: success\(\) && \(github\.event_name != 'schedule' \|\| env\.RUN_US_DASHBOARD == '1'\)/, `${name} must be success-gated`);
  }
});

test("US workflow validates JSON export contract before commit and deploy", () => {
  const validationIndex = workflow.indexOf("- name: Validate US JSON export contract");
  const commitIndex = workflow.indexOf("- name: Commit updated US outputs");
  const deployIndex = workflow.indexOf("- name: Deploy GitHub Pages");
  assert.ok(validationIndex > -1, "validation step missing");
  assert.ok(validationIndex < commitIndex, "validation must run before commit");
  assert.ok(validationIndex < deployIndex, "validation must run before deploy");
  assert.match(stepBlock("Validate US JSON export contract"), /validate-json-export-contract\.mjs --run-start-iso "\$US_DASHBOARD_RUN_START_ISO"/);
});

test("US workflow keeps active ledger mode quoted and default-off", () => {
  const inputMatch = workflow.match(/\n      active_ledger_mode:\n([\s\S]*?)(?=\n  schedule:)/);
  assert.ok(inputMatch, "active_ledger_mode input missing");
  assert.match(inputMatch[1], /default: "off"/);
  assert.match(inputMatch[1], /- "off"/);
  assert.match(inputMatch[1], /- "dry-run"/);
  assert.match(inputMatch[1], /- "apply"/);
});
