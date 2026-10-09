const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const security = require("../js/data-validation.js");
const root = path.resolve(__dirname, "..");
const read = file => JSON.parse(fs.readFileSync(path.join(root, file), "utf8"));
const index = read("data/index.json");
const dataset = read("data/settlement/R6.json");
const manifest = index.datasets.find(item => item.type === "settlement" && item.year === "R6");
const trends = read("data/trends.json");

test("all actual datasets and graph series pass validation", () => {
  security.validateIndex(index);
  for (const item of index.datasets) security.validateDataset(read(`data/${item.file}`), item);
  security.validateTrends(trends);
});

for (const url of ["https://example.invalid/R6.pdf", "javascript:alert(1)", "data:text/html,test", "file:///R6.pdf",
  "http://www.city.kawasaki.jp/230/cmsfiles/contents/R6.pdf", "https://www.city.kawasaki.jp.evil.invalid/230/cmsfiles/contents/R6.pdf",
  "https://www.city.kawasaki.jp@evil.invalid/230/cmsfiles/contents/R6.pdf", "https://user:password@www.city.kawasaki.jp/230/cmsfiles/contents/R6.pdf",
  "https://www.city.kawasaki.jp:444/230/cmsfiles/contents/R6.pdf", "https://www.city.kawasaki.jp/230/page/R6.pdf",
  "https://www.city.kawasaki.jp/230/cmsfiles/contents/R6.pdf?next=evil", "https://www.city.kawasaki.jp/230/cmsfiles/contents/R6.pdf#x",
  "https://www.city.kawasaki.jp/230/cmsfiles/contents/%2e%2e/R6.pdf"]) {
  test(`reject unsafe source: ${url}`, () => assert.throws(() => security.sourcePdfUrl(url)));
}

for (const file of ["../js/app.js", "../marker.json", "/budget/R6.json", "https://example.invalid/data.json", "budget/R6.json?q=x",
  "budget/r6.json", "budget/R0.json", "budget/R6.json#x", "settlement\\R6.json", "budget/%52%36.json"]) {
  test(`reject unsafe filename: ${file}`, () => assert.throws(() => security.datasetFile(file)));
}

const datasetCases = {
  "numeric string": value => { value.items[0].current = "100"; },
  "infinite amount": value => { value.items[0].current = Infinity; },
  "negative amount": value => { value.items[0].current = -1; },
  "unsafe integer": value => { value.items[0].current = Number.MAX_SAFE_INTEGER; },
  "fractional amount": value => { value.items[0].current = 0.5; },
  "bad item type": value => { value.items[0] = []; },
  "record count": value => { value.recordCount++; },
  "total mismatch": value => { value.items[0].current++; },
  "active count mismatch": value => { value.activeCount--; },
  "wrong year": value => { value.year = "R5"; },
  "wrong unit": value => { value.unit = "円"; },
  "invalid date": value => { value.updatedAt = "2026-02-30"; },
  "foreign PDF": value => { value.sourceUrl = "https://example.invalid/R6.pdf"; },
};
for (const [label, modify] of Object.entries(datasetCases)) {
  test(`reject dataset with ${label}`, () => {
    const value = structuredClone(dataset); modify(value);
    assert.throws(() => security.validateDataset(value, manifest));
  });
}
test("HTML-shaped names remain text data, not silently altered", () => {
  const value = structuredClone(dataset);
  const text = '<img src=x onerror="alert(1)">'; value.items[0].name = text;
  assert.equal(security.validateDataset(value, manifest).items[0].name, text);
});
test("reject invalid manifest paths before requesting them", () => {
  const value = structuredClone(index); value.datasets[0].file = "../marker.json";
  assert.throws(() => security.validateIndex(value));
});
test("reject empty or duplicate manifest", () => {
  const empty = structuredClone(index); empty.datasets = [];
  assert.throws(() => security.validateIndex(empty));
  const duplicate = structuredClone(index); duplicate.datasets.push(duplicate.datasets[0]);
  assert.throws(() => security.validateIndex(duplicate));
});
test("reject bad trend numbers and unsorted years", () => {
  const bad = structuredClone(trends); Object.values(bad.series)[0].points[0].budget = "1";
  assert.throws(() => security.validateTrends(bad));
  const duplicate = structuredClone(trends); const series = Object.values(duplicate.series)[0]; series.points.push(series.points[0]);
  assert.throws(() => security.validateTrends(duplicate));
});
test("reject inherited property-like trend keys and excessive points", () => {
  const bad = structuredClone(trends); bad.series.constructor = { name: "constructor", points: [] };
  assert.throws(() => security.validateTrends(bad));
  const large = structuredClone(trends); Object.values(large.series)[0].points = Array(201).fill({});
  assert.throws(() => security.validateTrends(large));
});
