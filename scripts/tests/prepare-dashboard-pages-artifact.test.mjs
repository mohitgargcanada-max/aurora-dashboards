import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { access, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repoRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const scriptSource = await readFile(resolve(repoRoot, "scripts/prepare-dashboard-pages-artifact.sh"), "utf8");
const bashPath = [
  process.env.AURORA_TEST_BASH,
  "C:\\Program Files\\Git\\bin\\bash.exe",
  "C:\\Program Files\\Git\\usr\\bin\\bash.exe"
].find(path => path && existsSync(path)) || "bash";

const htmlPaths = {
  us: "markets/us/AURORA_US_Dashboard.html",
  india: "markets/india/AURORA_India_Unified_Dashboard.html",
  canada: "markets/canada/AURORA_Canada_Unified_Dashboard.html"
};

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function fixtureRoot() {
  const root = await mkdtemp(join(tmpdir(), "aurora-pages-"));
  await mkdir(join(root, "scripts"), { recursive: true });
  await writeFile(join(root, "scripts/prepare-dashboard-pages-artifact.sh"), scriptSource);
  return root;
}

async function writeMarket(root, market, jsonNames = ["latest.json"]) {
  const htmlPath = join(root, htmlPaths[market]);
  await mkdir(dirname(htmlPath), { recursive: true });
  await writeFile(htmlPath, `<!doctype html><title>${market}</title>`);

  const dataDir = join(root, `markets/${market}/dashboard/data`);
  await mkdir(dataDir, { recursive: true });
  for (const name of jsonNames) {
    await writeFile(join(dataDir, name), JSON.stringify({ market, name }));
  }
}

function runBuilder(root, requiredMarket = "us") {
  return spawnSync(bashPath, [
    "--noprofile",
    "--norc",
    join(root, "scripts/prepare-dashboard-pages-artifact.sh"),
    "public",
    "--required-market",
    requiredMarket
  ], { cwd: root, encoding: "utf8" });
}

async function allFiles(root, prefix = "") {
  const entries = await readdir(join(root, prefix), { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) files.push(...await allFiles(root, rel));
    else files.push(rel);
  }
  return files;
}

test("shared artifact packages all available dashboards", async () => {
  const root = await fixtureRoot();
  try {
    await writeMarket(root, "us", ["latest.json", "us-full-dashboard-scan.json"]);
    await writeMarket(root, "india", ["india-full-dashboard-scan.json"]);

    const result = runBuilder(root, "us");
    assert.equal(result.status, 0, result.stderr);
    assert.equal(await exists(join(root, "public/index.html")), true);
    assert.equal(await exists(join(root, "public/us/index.html")), true);
    assert.equal(await exists(join(root, "public/india/index.html")), true);
    assert.equal(await exists(join(root, "public/canada/index.html")), true);
    assert.equal(await exists(join(root, "public/.nojekyll")), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("required current market missing fails", async () => {
  const root = await fixtureRoot();
  try {
    const result = runBuilder(root, "us");
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Required us dashboard HTML missing or empty/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("non-required market missing succeeds with placeholders", async () => {
  const root = await fixtureRoot();
  try {
    await writeMarket(root, "us");
    const result = runBuilder(root, "us");
    assert.equal(result.status, 0, result.stderr);
    assert.match(await readFile(join(root, "public/india/index.html"), "utf8"), /has not been published/);
    assert.match(await readFile(join(root, "public/canada/index.html"), "utf8"), /has not been published/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("dashboard JSON is copied without cache or compressed files", async () => {
  const root = await fixtureRoot();
  try {
    await writeMarket(root, "us", ["latest.json", "us-dashboard-state.json"]);
    await mkdir(join(root, "markets/us/dashboard/cache"), { recursive: true });
    await writeFile(join(root, "markets/us/dashboard/cache/leak.json"), "{}");
    const dataDir = join(root, "markets/us/dashboard/data");
    for (const name of ["data.parquet", "events.jsonl.gz", "bars.csv.gz", "archive.zip"]) {
      await writeFile(join(dataDir, name), "not-public");
    }

    const result = runBuilder(root, "us");
    assert.equal(result.status, 0, result.stderr);
    assert.equal(await exists(join(root, "public/us/dashboard/data/latest.json")), true);
    assert.equal(await exists(join(root, "public/us/dashboard/data/us-dashboard-state.json")), true);

    const files = await allFiles(join(root, "public"));
    assert.equal(files.some(file => file.includes("cache/")), false);
    assert.equal(files.some(file => /\.(parquet|jsonl\.gz|csv\.gz|zip)$/.test(file)), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("legacy redirect pages exist for all market dashboard URLs", async () => {
  const root = await fixtureRoot();
  try {
    await writeMarket(root, "us");
    const result = runBuilder(root, "us");
    assert.equal(result.status, 0, result.stderr);
    for (const legacy of [
      "public/markets/us/AURORA_US_Dashboard.html",
      "public/markets/india/AURORA_India_Unified_Dashboard.html",
      "public/markets/canada/AURORA_Canada_Unified_Dashboard.html"
    ]) {
      assert.equal(await exists(join(root, legacy)), true, legacy);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
