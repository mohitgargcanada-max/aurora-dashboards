import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repoRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));

async function workflow(name) {
  return readFile(resolve(repoRoot, `.github/workflows/${name}`), "utf8");
}

function steps(source) {
  const out = [];
  let current = null;
  for (const line of source.split(/\r?\n/)) {
    const match = line.match(/^ {6}- name: (.+)$/);
    if (match) {
      if (current) out.push(current);
      current = { name: match[1], lines: [line] };
    } else if (current) {
      current.lines.push(line);
    }
  }
  if (current) out.push(current);
  return out;
}

function pagesSteps(source) {
  return steps(source).filter(step =>
    /Prepare .*GitHub Pages artifact|Upload GitHub Pages artifact|Deploy GitHub Pages/.test(step.name)
  );
}

test("all dashboard workflows call the shared Pages artifact builder", async () => {
  const us = await workflow("us-dashboard.yml");
  const india = await workflow("india-dashboard.yml");
  const canada = await workflow("canada-dashboard.yml");

  assert.match(us, /bash scripts\/prepare-dashboard-pages-artifact\.sh public --required-market us/);
  assert.match(india, /bash scripts\/prepare-dashboard-pages-artifact\.sh public --required-market india/);
  assert.match(canada, /bash scripts\/prepare-dashboard-pages-artifact\.sh public --required-market canada/);
});

test("Pages artifact preparation, upload, and deploy remain success-only", async () => {
  for (const name of ["us-dashboard.yml", "india-dashboard.yml", "canada-dashboard.yml"]) {
    const source = await workflow(name);
    for (const step of pagesSteps(source)) {
      const block = step.lines.join("\n");
      assert.doesNotMatch(block, /if:\s*always\(\)/, `${name} ${step.name} must not use always()`);
      assert.match(block, /if:\s*success\(\)/, `${name} ${step.name} must use success()`);
    }
  }
});

test("US JSON contract validation still precedes commit and Pages deploy", async () => {
  const us = await workflow("us-dashboard.yml");
  const validationIndex = us.indexOf("- name: Validate US JSON export contract");
  const commitIndex = us.indexOf("- name: Commit updated US outputs");
  const prepareIndex = us.indexOf("- name: Prepare GitHub Pages artifact");
  const uploadIndex = us.indexOf("- name: Upload GitHub Pages artifact");
  const deployIndex = us.indexOf("- name: Deploy GitHub Pages");

  assert.ok(validationIndex >= 0, "US workflow must validate JSON export contract");
  assert.ok(validationIndex < commitIndex, "US validation must run before output commit");
  assert.ok(validationIndex < prepareIndex, "US validation must run before Pages preparation");
  assert.ok(prepareIndex < uploadIndex, "US Pages preparation must run before upload");
  assert.ok(uploadIndex < deployIndex, "US Pages upload must run before deploy");
});
