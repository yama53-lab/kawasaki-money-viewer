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
const generalAccount = read("data/general-account/R8.json");

test("all actual datasets and graph series pass validation", () => {
  security.validateIndex(index);
  for (const item of index.datasets) security.validateDataset(read(`data/${item.file}`), item);
  security.validateTrends(trends);
  security.validateGeneralAccount(generalAccount);
});

for (const url of ["https://example.invalid/230/page/0000186101.html", "http://www.city.kawasaki.jp/230/page/0000186101.html",
  "https://www.city.kawasaki.jp.evil.invalid/230/page/0000186101.html", "https://www.city.kawasaki.jp/230/page/../secret.html",
  "https://www.city.kawasaki.jp/230/page/0000186101.html?x=1"]) {
  test(`reject unsafe source page: ${url}`, () => assert.throws(() => security.sourcePageUrl(url)));
}

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

test("shared JSON loader reads same-origin data", async () => {
  const originals = { document: globalThis.document, location: globalThis.location, fetch: globalThis.fetch };
  const bytes = new TextEncoder().encode('{"ok":true}');
  globalThis.document = { baseURI: "https://viewer.example/general-account.html" };
  globalThis.location = { origin: "https://viewer.example" };
  globalThis.fetch = async () => ({
    ok: true,
    headers: { get: name => name === "content-type" ? "application/json; charset=utf-8" : String(bytes.byteLength) },
    body: { getReader: () => {
      let sent = false;
      return { read: async () => sent ? { done: true } : (sent = true, { done: false, value: bytes }) };
    } },
  });
  try {
    assert.deepEqual(await security.fetchJson("data/example.json", 1024), { ok: true });
  } finally {
    Object.assign(globalThis, originals);
  }
});

test("shared JSON loader rejects local file URLs before fetch", async () => {
  const originals = { document: globalThis.document, location: globalThis.location, fetch: globalThis.fetch };
  let requested = false;
  globalThis.document = { baseURI: "file:///tmp/index.html" };
  globalThis.location = { origin: "null" };
  globalThis.fetch = async () => { requested = true; };
  try {
    await assert.rejects(security.fetchJson("data/example.json", 1024));
    assert.equal(requested, false);
  } finally {
    Object.assign(globalThis, originals);
  }
});

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

const generalAccountCases = {
  "wrong total": value => { value.summary.current++; },
  "unsafe source page": value => { value.sourcePageUrl = "https://example.invalid/source"; },
  "unsafe source PDF": value => { value.sourceUrl = "https://example.invalid/source.pdf"; },
  "revenue mismatch": value => { value.revenue[0].current++; },
  "purpose resource mismatch": value => { value.expenditurePurpose[0].generalResources++; },
  "nature child mismatch": value => { value.expenditureNature[0].items[0].current++; },
  "per-capita mismatch": value => { value.perCapita[0].yen++; },
  "numeric string": value => { value.summary.population = "1559207"; },
};
for (const [label, modify] of Object.entries(generalAccountCases)) {
  test(`reject general account data with ${label}`, () => {
    const value = structuredClone(generalAccount); modify(value);
    assert.throws(() => security.validateGeneralAccount(value));
  });
}
test("reject inherited property-like trend keys and excessive points", () => {
  const bad = structuredClone(trends); bad.series.constructor = { name: "constructor", points: [] };
  assert.throws(() => security.validateTrends(bad));
  const large = structuredClone(trends); Object.values(large.series)[0].points = Array(201).fill({});
  assert.throws(() => security.validateTrends(large));
});

// Exercise the actual bar builder without starting the page or fetching data.
const vm = require("node:vm");
const appSource = fs.readFileSync(path.join(root, "js/app.js"), "utf8");
const generalAccountSource = fs.readFileSync(path.join(root, "js/general-account.js"), "utf8");
test("both pages use the shared JSON loader", () => {
  assert.match(appSource, /const fetchJson = DataSecurity\.fetchJson/);
  assert.match(generalAccountSource, /DataSecurity\.fetchJson\(GENERAL_ACCOUNT_URL/);
});
const barStart = appSource.indexOf("function createTrendBar(");
const barEnd = appSource.indexOf("function renderTrendChart(", barStart);
assert.ok(barStart >= 0 && barEnd > barStart);
const makeElement = tagName => {
  const element = {
    tagName, className: "", style: {}, attributes: {}, children: [], listeners: {},
    setAttribute(name, value) { this.attributes[name] = value; },
    append(...children) { this.children.push(...children); },
    addEventListener(name, handler) { this.listeners[name] = handler; },
  };
  element.classList = { add(name) { element.className += ` ${name}`; } };
  return element;
};
const barContext = vm.createContext({
  document: { createElement: makeElement },
  displayTrendYear: () => "R2",
  formatReadableAmount: value => `${value * 1000}円`,
  formatSourceAmount: value => `${value}千円`,
});
vm.runInContext(appSource.slice(barStart, barEnd), barContext);
for (const type of ["budget", "settlement"]) {
  test(`${type} zero uses a neutral label and keeps the tooltip`, () => {
    const bar = barContext.createTrendBar({ [type]: 0 }, type, 2000);
    assert.equal(bar.tagName, "button");
    assert.ok(bar.className.includes("trend-bar--zero"));
    assert.equal(bar.style.height, undefined);
    assert.equal(bar.children[0].textContent, "0");
    assert.equal(bar.children[0].attributes["aria-hidden"], "true");
    assert.ok(bar.attributes["aria-label"].includes("0円"));
    assert.equal(bar.children[1].className, "trend-tooltip");
    assert.equal(bar.children[1].children[1].textContent, "0円");
    assert.equal(bar.children[1].children[2].textContent, "原資料：0千円");
    assert.equal(typeof bar.listeners.pointerenter, "function");
    assert.equal(typeof bar.listeners.focus, "function");
  });
  test(`${type} positive amounts retain their colored bar`, () => {
    const bar = barContext.createTrendBar({ [type]: 500 }, type, 2000);
    assert.ok(!bar.className.includes("trend-bar--zero"));
    assert.equal(bar.style.height, "25%");
    assert.equal(bar.children[0].className, "trend-tooltip");
  });
  test(`${type} missing amounts are distinct from zero`, () => {
    const bar = barContext.createTrendBar({ [type]: null }, type, 2000);
    assert.equal(bar.tagName, "span");
    assert.equal(bar.className, "trend-bar-missing");
    assert.ok(bar.attributes["aria-label"].includes("データなし"));
    assert.equal(bar.children.length, 0);
  });
}
