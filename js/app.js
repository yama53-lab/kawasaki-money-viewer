const INDEX_URL = "data/index.json";
const PAGE_SIZE = 30;
const MAX_KEYWORD_LENGTH = 200;

const state = {
  index: null,
  dataset: null,
  items: [],
  type: "settlement",
  year: "R6",
  visible: PAGE_SIZE,
  loadToken: 0,
  trendToken: 0,
};

const elements = {
  typeButtons: [...document.querySelectorAll("[data-type]")],
  year: document.querySelector("#year-select"),
  status: document.querySelector("#dataset-status"),
  keyword: document.querySelector("#keyword"),
  bureau: document.querySelector("#bureau-filter"),
  recipient: document.querySelector("#recipient-filter"),
  amount: document.querySelector("#amount-filter"),
  change: document.querySelector("#change-filter"),
  sort: document.querySelector("#sort-select"),
  body: document.querySelector("#result-body"),
  active: document.querySelector("#active-filters"),
  empty: document.querySelector("#empty-state"),
  more: document.querySelector("#load-more"),
  reset: document.querySelector("#reset-button"),
  template: document.querySelector("#result-row-template"),
  trendDialog: document.querySelector("#trend-dialog"),
  trendClose: document.querySelector("#trend-close"),
  trendTitle: document.querySelector("#trend-title"),
  trendMeta: document.querySelector("#trend-meta"),
  trendLoading: document.querySelector("#trend-loading"),
  trendChart: document.querySelector("#trend-chart"),
  trendYAxis: document.querySelector("#trend-y-axis"),
  trendScroll: document.querySelector(".trend-scroll"),
  trendPlot: document.querySelector("#trend-plot"),
  trendNote: document.querySelector("#trend-note"),
};

let trendIndexPromise = null;

async function fetchJson(relativePath, maximumBytes) {
  const url = new URL(relativePath, document.baseURI);
  if (url.origin !== location.origin || !["http:", "https:"].includes(url.protocol)) throw new Error("同一サイト以外のデータは読み込めません");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch(url, { signal: controller.signal, redirect: "error", mode: "same-origin", credentials: "omit" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    if (response.headers.get("content-type")?.split(";")[0].trim() !== "application/json") throw new Error("JSON以外の応答です");
    if (Number(response.headers.get("content-length")) > maximumBytes) throw new Error("データの容量が大きすぎます");
    const reader = response.body.getReader();
    const chunks = [];
    let length = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maximumBytes) {
        await reader.cancel();
        throw new Error("データの容量が大きすぎます");
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } finally {
    clearTimeout(timeout);
    controller.abort();
  }
}

function setSourceLink(link, value) {
  link.href = DataSecurity.sourcePdfUrl(value);
  link.removeAttribute("aria-disabled");
  link.removeAttribute("tabindex");
}

function setSearchDisabled(disabled) {
  [elements.keyword, elements.bureau, elements.recipient, elements.amount, elements.change, elements.sort, elements.reset, elements.more].forEach((control) => { control.disabled = disabled; });
}

function clearDatasetDisplay() {
  state.dataset = null;
  state.items = [];
  elements.body.replaceChildren();
  elements.active.replaceChildren();
  elements.more.hidden = true;
  if (elements.trendDialog.open) elements.trendDialog.close();
  for (const id of ["summary-count", "summary-total", "summary-change", "source-dataset", "source-updated", "source-count"]) document.querySelector(`#${id}`).textContent = "—";
  for (const id of ["summary-count-note", "summary-change-note"]) document.querySelector(`#${id}`).textContent = "";
  for (const id of ["summary-total-source", "summary-change-source"]) document.querySelector(`#${id}`).textContent = "原資料：—";
  for (const [id, label] of [["summary-count-label", "掲載件数"], ["summary-total-label", "対象年度の金額"], ["summary-change-label", "前年度からの増減"]]) document.querySelector(`#${id}`).textContent = label;
  for (const id of ["source-pdf-link", "source-budget-pdf-link"]) {
    const link = document.querySelector(`#${id}`);
    link.removeAttribute("href");
    link.setAttribute("aria-disabled", "true");
    link.setAttribute("tabindex", "-1");
  }
  document.querySelector("#source-budget-pdf-link").hidden = true;
  document.querySelector("#dataset-kicker").textContent = "予算・決算データ";
  document.title = "かわさき Money Viewer";
  setSearchDisabled(true);
}

const yen = new Intl.NumberFormat("ja-JP");
const decimal = new Intl.NumberFormat("ja-JP", { maximumFractionDigits: 1 });
const normalize = (value) => String(value ?? "").normalize("NFKC").toLowerCase();
const normalizeName = (value) => normalize(value)
  .replace(/[\s\u3000・･]/g, "")
  .replace(/[‐‑‒–—―－]/g, "-");
const formatSourceAmount = (value) => value === null
  ? "—"
  : `${value < 0 ? "−" : ""}${yen.format(Math.abs(value))}千円`;

function formatReadableAmount(value) {
  if (value === null) return "—";
  const absolute = Math.abs(value);
  const sign = value < 0 ? "−" : "";
  if (absolute >= 100000) {
    const scaled = absolute / 100000;
    const isExactAtOneDecimal = Math.abs((scaled * 10) - Math.round(scaled * 10)) < Number.EPSILON;
    return `${sign}${isExactAtOneDecimal ? "" : "約"}${decimal.format(scaled)}億円`;
  }
  if (absolute >= 10) return `${sign}${decimal.format(absolute / 10)}万円`;
  return `${sign}${yen.format(absolute * 1000)}円`;
}

function setAmountContent(element, value) {
  const primary = document.createElement("span");
  primary.className = "amount-primary";
  primary.textContent = formatReadableAmount(value);
  element.replaceChildren(primary);
  if (value !== null) {
    const source = document.createElement("span");
    source.className = "amount-source";
    source.textContent = formatSourceAmount(value);
    element.append(source);
    element.setAttribute("aria-label", `${primary.textContent}、原資料 ${source.textContent}`);
  }
}

function niceMaximum(value) {
  if (value <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const normalized = value / magnitude;
  const factor = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return factor * magnitude;
}

function formatAxisAmount(value) {
  if (value >= 100000) return `${decimal.format(value / 100000)}億円`;
  if (value >= 10) return `${decimal.format(value / 10)}万円`;
  return `${yen.format(value * 1000)}円`;
}

function shortYearLabel(value) {
  return String(value || "")
    .replace("平成", "H")
    .replace("令和元", "R1")
    .replace("令和", "R")
    .replace("年度", "");
}

function displayTrendYear(point) {
  const budget = shortYearLabel(point.budgetYearLabel);
  const settlement = shortYearLabel(point.settlementYearLabel);
  if (budget && settlement && budget !== settlement) return `${budget}/${settlement}`;
  return budget || settlement;
}

async function loadTrendIndex() {
  if (!trendIndexPromise) {
    trendIndexPromise = fetchJson("data/trends.json", 16 * 1024 * 1024)
      .then(DataSecurity.validateTrends).catch((error) => { trendIndexPromise = null; throw error; });
  }
  return trendIndexPromise;
}

function positionTrendTooltip(bar) {
  const tooltip = bar.querySelector(".trend-tooltip");
  const viewport = elements.trendScroll.getBoundingClientRect();
  const bounds = bar.getBoundingClientRect();
  tooltip.style.setProperty("--tooltip-available-width", `${Math.max(1, viewport.width - 8)}px`);
  const width = tooltip.getBoundingClientRect().width;
  if (!width) return;
  const center = bounds.left + bounds.width / 2;
  const left = Math.max(viewport.left + 4, Math.min(center - width / 2, viewport.right - width - 4));
  tooltip.style.left = `${left - bounds.left - bar.clientLeft}px`;
  tooltip.style.transform = "none";
  tooltip.style.setProperty("--tooltip-arrow-left", `${Math.max(6, Math.min(width - 6, center - left))}px`);
}

function createTrendBar(point, type, maximum) {
  const value = point[type];
  const label = type === "budget" ? "予算" : "決算";
  if (value === null) {
    const missing = document.createElement("span");
    missing.className = "trend-bar-missing";
    missing.setAttribute("aria-label", `${displayTrendYear(point)} ${label}データなし`);
    return missing;
  }

  const bar = document.createElement("button");
  bar.type = "button";
  bar.className = `trend-bar trend-bar--${type}`;
  if (value === 0) {
    bar.classList.add("trend-bar--zero");
    const zero = document.createElement("span");
    zero.className = "trend-zero-label";
    zero.textContent = "0";
    zero.setAttribute("aria-hidden", "true");
    bar.append(zero);
  } else {
    bar.style.height = `${Math.max((value / maximum) * 100, 0.8)}%`;
  }
  bar.setAttribute(
    "aria-label",
    `${displayTrendYear(point)} ${label} ${formatReadableAmount(value)}、原資料 ${formatSourceAmount(value)}`,
  );

  const tooltip = document.createElement("span");
  tooltip.className = "trend-tooltip";
  const heading = document.createElement("strong");
  heading.textContent = `${displayTrendYear(point)} ${label}`;
  const readable = document.createElement("span");
  readable.textContent = formatReadableAmount(value);
  const source = document.createElement("small");
  source.textContent = `原資料：${formatSourceAmount(value)}`;
  tooltip.append(heading, readable, source);
  bar.append(tooltip);
  const positionTooltip = () => requestAnimationFrame(() => positionTrendTooltip(bar));
  bar.addEventListener("pointerenter", positionTooltip);
  bar.addEventListener("focus", positionTooltip);
  return bar;
}

function renderTrendChart(series) {
  const values = series.points.flatMap((point) => [point.budget, point.settlement]).filter((value) => value !== null);
  const maximum = niceMaximum(Math.max(...values, 0));
  const naturalWidthRem = series.points.length * 4.6;
  elements.trendYAxis.replaceChildren();
  elements.trendPlot.replaceChildren();
  elements.trendPlot.style.minWidth = `${naturalWidthRem}rem`;

  for (let index = 0; index <= 4; index += 1) {
    const value = maximum * (1 - index / 4);
    const label = document.createElement("span");
    label.style.top = `${index * 4.5}rem`;
    label.textContent = formatAxisAmount(value);
    elements.trendYAxis.append(label);

    const line = document.createElement("i");
    line.className = "trend-grid-line";
    line.style.top = `${5 + index * 4.5}rem`;
    elements.trendPlot.append(line);
  }

  const groups = document.createElement("div");
  groups.className = "trend-groups";
  series.points.forEach((point) => {
    const group = document.createElement("div");
    group.className = "trend-year-group";
    group.dataset.sortYear = String(point.sortYear);
    const bars = document.createElement("div");
    bars.className = "trend-bars";
    bars.append(
      createTrendBar(point, "budget", maximum),
      createTrendBar(point, "settlement", maximum),
    );
    const year = document.createElement("span");
    year.className = "trend-year-label";
    year.textContent = displayTrendYear(point);
    group.append(bars, year);
    groups.append(group);
  });
  elements.trendPlot.append(groups);

  const selectedYear = availableDatasets().find((dataset) => dataset.year === state.year)?.sortYear;
  requestAnimationFrame(() => {
    const target = groups.querySelector(`[data-sort-year="${selectedYear}"]`);
    if (!target) return;

    groups.style.paddingInline = "0";
    const viewportWidth = elements.trendScroll.clientWidth;
    const rootFontSize = Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    const naturalWidth = naturalWidthRem * rootFontSize;

    if (naturalWidth <= viewportWidth) {
      elements.trendPlot.style.minWidth = "0";
      elements.trendScroll.scrollLeft = 0;
      return;
    }

    elements.trendPlot.style.minWidth = `${naturalWidth}px`;

    requestAnimationFrame(() => {
      elements.trendScroll.scrollLeft = Math.max(
        0,
        target.offsetLeft + target.offsetWidth / 2 - elements.trendScroll.clientWidth / 2,
      );
    });
  });
}

async function openTrendDialog(item) {
  const requestId = ++state.trendToken;
  elements.trendTitle.textContent = item.name;
  elements.trendMeta.textContent = `${item.bureau || "所管局の記載なし"} / 交付先：${item.recipient || "原資料に記載なし"}`;
  elements.trendLoading.hidden = false;
  elements.trendLoading.textContent = "年度別データを読み込んでいます…";
  elements.trendChart.hidden = true;
  elements.trendNote.textContent = "";
  if (!elements.trendDialog.open) elements.trendDialog.showModal();

  try {
    const trends = await loadTrendIndex();
    if (requestId !== state.trendToken || !elements.trendDialog.open) return;
    const key = normalizeName(item.name);
    const series = Object.hasOwn(trends.series, key) ? trends.series[key] : null;
    if (!series || series.points.length === 0) throw new Error("Trend series not found");
    elements.trendLoading.hidden = true;
    elements.trendChart.hidden = false;
    renderTrendChart(series);
    const missingSettlement = series.points.some((point) => point.budget !== null && point.settlement === null);
    elements.trendNote.textContent = `棒にマウスを合わせるか、キーボードで選択すると正確な金額を確認できます。${missingSettlement ? "決算データがない年度は予算のみ表示しています。" : ""}`;
  } catch (error) {
    if (requestId !== state.trendToken || !elements.trendDialog.open) return;
    console.error(error);
    elements.trendLoading.textContent = "年度別データを読み込めませんでした。";
  }
}

function getChangeType(item) {
  if (item.previous === null) return "unavailable";
  if (item.current > 0 && item.previous === 0) return "new";
  if (item.current === 0 && item.previous > 0) return "ended";
  if (item.current > item.previous) return "increase";
  if (item.current < item.previous) return "decrease";
  return "same";
}

function getComparisonType(item) {
  if (item.budget === null) return "new";
  if (item.settlement === null) return "ended";
  if (item.settlement > item.budget) return "increase";
  if (item.settlement < item.budget) return "decrease";
  return "same";
}

function replaceOptions(select, firstLabel, values) {
  select.replaceChildren();
  const first = document.createElement("option");
  first.value = "";
  first.textContent = firstLabel;
  select.append(first);
  values.filter(Boolean).sort((a, b) => a.localeCompare(b, "ja")).forEach((value) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value;
    select.append(option);
  });
}

function setOptions(select, options) {
  select.replaceChildren(...options.map(([value, label]) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    return option;
  }));
}

function comparisonDatasets() {
  const budgets = state.index.datasets.filter((dataset) => dataset.type === "budget");
  return state.index.datasets
    .filter((dataset) => dataset.type === "settlement")
    .map((settlement) => {
      const budget = budgets.find((candidate) => candidate.sortYear === settlement.sortYear);
      if (!budget) return null;
      const optionLabel = budget.yearLabel === settlement.yearLabel
        ? settlement.yearLabel
        : `${settlement.yearLabel}（予算：${budget.yearLabel}）`;
      return {
        type: "comparison",
        typeLabel: "予算・決算比較",
        year: String(settlement.sortYear),
        yearLabel: settlement.yearLabel,
        optionLabel,
        sortYear: settlement.sortYear,
        budget,
        settlement,
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.sortYear - a.sortYear);
}

function availableDatasets(type = state.type) {
  if (type === "comparison") return comparisonDatasets();
  return state.index.datasets
    .filter((dataset) => dataset.type === type)
    .sort((a, b) => b.sortYear - a.sortYear);
}

function populateYears() {
  const datasets = availableDatasets();
  elements.year.replaceChildren();
  datasets.forEach((dataset) => {
    const option = document.createElement("option");
    option.value = dataset.year;
    option.textContent = dataset.optionLabel || dataset.yearLabel;
    elements.year.append(option);
  });
  const preferred = datasets.some((dataset) => dataset.year === state.year)
    ? state.year
    : datasets[0].year;
  state.year = preferred;
  elements.year.value = preferred;
}

function selectedManifest() {
  return state.index.datasets.find(
    (dataset) => dataset.type === state.type && dataset.year === state.year,
  );
}

function selectedComparisonPair() {
  return comparisonDatasets().find((dataset) => dataset.year === state.year);
}

function configureModeControls() {
  if (state.type === "comparison") {
    setOptions(elements.change, [
      ["", "すべて"],
      ["increase", "決算が予算を上回る"],
      ["decrease", "決算が予算を下回る"],
      ["same", "予算と決算が同額"],
      ["ended", "予算のみに掲載"],
      ["new", "決算のみに掲載"],
    ]);
    setOptions(elements.sort, [
      ["settlement-desc", "決算額：大きい順"],
      ["budget-desc", "予算額：大きい順"],
      ["rate-desc", "執行率：高い順"],
      ["variance-magnitude-desc", "差額の大きさ：大きい順"],
      ["number-asc", "掲載順"],
    ]);
  } else {
    setOptions(elements.change, [
      ["", "すべて"],
      ["increase", "増額"],
      ["decrease", "減額"],
      ["same", "同額"],
      ["new", "新規・前年度0円"],
      ["ended", "終了・支出なし"],
    ]);
    setOptions(elements.sort, [
      ["amount-desc", "対象年度額：大きい順"],
      ["change-desc", "増加額：大きい順"],
      ["change-asc", "減少額：大きい順"],
      ["years-desc", "継続年数：長い順"],
      ["number-asc", "掲載順"],
    ]);
  }
}

function updateDatasetUI() {
  const data = state.dataset;
  const isComparison = state.type === "comparison";
  document.body.classList.toggle("comparison-mode", isComparison);
  elements.typeButtons.forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.type === state.type));
  });

  if (isComparison) {
    const variance = data.settlementTotal - data.budgetTotal;
    const rate = data.budgetTotal > 0 ? (data.settlementTotal / data.budgetTotal) * 100 : null;
    document.querySelector("#dataset-kicker").textContent = `${data.yearLabel} 予算・決算比較 / 18年度比較可能`;
    document.querySelector("#summary-count-label").textContent = "名称が一致した項目";
    document.querySelector("#summary-count").textContent = `${yen.format(data.matchedCount)}件`;
    document.querySelector("#summary-count-note").textContent = `全${yen.format(data.recordCount)}件中、名称一致`;
    document.querySelector("#summary-total-label").textContent = `${data.budgetYearLabel} 予算額`;
    document.querySelector("#summary-total").textContent = formatReadableAmount(data.budgetTotal);
    document.querySelector("#summary-total-source").textContent = `原資料：${formatSourceAmount(data.budgetTotal)}`;
    document.querySelector("#summary-change-label").textContent = `${data.yearLabel} 決算額`;
    document.querySelector("#summary-change").textContent = formatReadableAmount(data.settlementTotal);
    document.querySelector("#summary-change-source").textContent = `原資料：${formatSourceAmount(data.settlementTotal)}`;
    document.querySelector("#summary-change-note").textContent = `執行率 ${rate === null ? "—" : `${rate.toFixed(1)}%`} / 予算差 ${formatReadableAmount(variance)}`;
    document.querySelector("#amount-filter-label").textContent = "決算額";
    document.querySelector("#change-filter-label").textContent = "予算比";
    document.querySelector("#current-year-heading").textContent = "予算額";
    document.querySelector("#previous-year-heading").textContent = "決算額";
    document.querySelector("#change-heading").textContent = "予算差";
    document.querySelector("#years-heading").textContent = "執行率";
    document.querySelector("#source-dataset").textContent = `${data.yearLabel}の予算・決算比較`;
    document.querySelector("#source-updated").textContent = data.updatedAt.replaceAll("-", "/");
    document.querySelector("#source-count").textContent = `${yen.format(data.recordCount)}件（名称一致 ${yen.format(data.matchedCount)}件）`;
    const settlementLink = document.querySelector("#source-pdf-link");
    setSourceLink(settlementLink, data.sourceUrl);
    settlementLink.childNodes[0].textContent = "決算PDFを確認する ";
    const budgetLink = document.querySelector("#source-budget-pdf-link");
    setSourceLink(budgetLink, data.budgetSourceUrl);
    budgetLink.hidden = false;
    const datasets = availableDatasets();
    elements.status.textContent = `比較可能：${datasets.at(-1).optionLabel || datasets.at(-1).yearLabel}〜${datasets[0].yearLabel}`;
    elements.change.disabled = false;
    elements.change.title = "";
    document.title = `${data.yearLabel} 予算・決算比較｜かわさき Money Viewer`;
    return;
  }

  const hasPrevious = data.previousTotal !== null;
  const difference = hasPrevious ? data.currentTotal - data.previousTotal : null;
  const comparison = hasPrevious ? `${data.previousYearLabel}との比較` : "原資料に前年度額の掲載なし";
  document.querySelector("#dataset-kicker").textContent = `${data.yearLabel}${data.typeLabel} / 全40年度資料`;
  const zeroAmountCount = data.recordCount - data.activeCount;
  document.querySelector("#summary-count-label").textContent = "掲載件数";
  document.querySelector("#summary-count").textContent = `全${yen.format(data.recordCount)}件`;
  document.querySelector("#summary-count-note").textContent = `${data.typeLabel}額あり ${yen.format(data.activeCount)}件 / 0円 ${yen.format(zeroAmountCount)}件`;
  document.querySelector("#summary-total-label").textContent = `${data.yearLabel} ${data.typeLabel}額`;
  document.querySelector("#summary-total").textContent = formatReadableAmount(data.currentTotal);
  document.querySelector("#summary-total-source").textContent = `原資料：${formatSourceAmount(data.currentTotal)}`;
  document.querySelector("#summary-change-label").textContent = "前年度からの増減";
  document.querySelector("#summary-change").textContent = difference === null
    ? "—"
    : formatReadableAmount(difference);
  document.querySelector("#summary-change-source").textContent = difference === null
    ? "原資料：—"
    : `原資料：${formatSourceAmount(difference)}`;
  document.querySelector("#summary-change-note").textContent = comparison;
  document.querySelector("#amount-filter-label").textContent = `${data.yearLabel} ${data.typeLabel}額`;
  document.querySelector("#change-filter-label").textContent = "前年度比";
  document.querySelector("#current-year-heading").textContent = data.yearLabel;
  document.querySelector("#previous-year-heading").textContent = data.previousYearLabel || "前年度";
  document.querySelector("#change-heading").textContent = "増減";
  document.querySelector("#years-heading").textContent = "継続";
  document.querySelector("#source-dataset").textContent = `${data.yearLabel}${data.typeLabel}${hasPrevious ? `（${data.previousYearLabel}比較）` : ""}`;
  document.querySelector("#source-updated").textContent = data.updatedAt.replaceAll("-", "/");
  document.querySelector("#source-count").textContent = `${yen.format(data.recordCount)}件（支出・計上なしを含む）`;
  const sourceLink = document.querySelector("#source-pdf-link");
  setSourceLink(sourceLink, data.sourceUrl);
  sourceLink.childNodes[0].textContent = "元PDFを確認する ";
  document.querySelector("#source-budget-pdf-link").hidden = true;
  const datasets = availableDatasets();
  elements.status.textContent = `${data.typeLabel} ${datasets.at(-1).yearLabel}〜${datasets[0].yearLabel}を収録`;
  elements.change.disabled = !hasPrevious;
  elements.change.title = hasPrevious ? "" : "この年度の原資料には前年度額が掲載されていません";
  document.title = `${data.yearLabel}${data.typeLabel}｜かわさき Money Viewer`;
}

function rebuildFilters() {
  replaceOptions(elements.bureau, "すべての所管局", [...new Set(state.items.map((item) => item.bureau))]);
  const categories = [...new Set(state.items.map((item) => item.category2).filter(Boolean))];
  replaceOptions(elements.recipient, "すべての区分", categories);
  elements.recipient.disabled = categories.length === 0;
  elements.recipient.title = categories.length ? "" : "この年度の原資料には交付先区分が掲載されていません";
}

function getFilteredItems() {
  const query = normalize(elements.keyword.value.trim());
  const minimum = Number(elements.amount.value || 0);
  const change = elements.change.value;
  const isComparison = state.type === "comparison";
  const filtered = state.items.filter((item) => {
    const haystack = normalize([item.name, item.recipient, item.bureau, item.category1, item.category2, item.category3].join(" "));
    const amount = isComparison ? (item.settlement ?? 0) : item.current;
    const changeType = isComparison ? getComparisonType(item) : getChangeType(item);
    return (
      (!query || haystack.includes(query)) &&
      (!elements.bureau.value || item.bureau === elements.bureau.value) &&
      (!elements.recipient.value || item.category2 === elements.recipient.value) &&
      (!minimum || amount >= minimum) &&
      (!change || changeType === change)
    );
  });

  if (isComparison) {
    const variance = (item) => item.budget === null || item.settlement === null ? Number.NEGATIVE_INFINITY : item.settlement - item.budget;
    const varianceMagnitude = (item) => item.budget === null || item.settlement === null
      ? Number.NEGATIVE_INFINITY
      : Math.abs(item.settlement - item.budget);
    const rate = (item) => item.budget > 0 && item.settlement !== null ? item.settlement / item.budget : Number.NEGATIVE_INFINITY;
    const sorters = {
      "settlement-desc": (a, b) => (b.settlement ?? -1) - (a.settlement ?? -1) || a.order - b.order,
      "budget-desc": (a, b) => (b.budget ?? -1) - (a.budget ?? -1) || a.order - b.order,
      "rate-desc": (a, b) => rate(b) - rate(a) || a.order - b.order,
      "variance-magnitude-desc": (a, b) => varianceMagnitude(b) - varianceMagnitude(a) || variance(b) - variance(a) || a.order - b.order,
      "number-asc": (a, b) => a.order - b.order,
    };
    return filtered.sort(sorters[elements.sort.value]);
  }

  const difference = (item) => item.previous === null ? Number.NEGATIVE_INFINITY : item.current - item.previous;
  const years = (item) => item.years ?? -1;
  const sorters = {
    "amount-desc": (a, b) => b.current - a.current || a.order - b.order,
    "change-desc": (a, b) => difference(b) - difference(a) || a.order - b.order,
    "change-asc": (a, b) => difference(a) - difference(b) || a.order - b.order,
    "years-desc": (a, b) => years(b) - years(a) || a.order - b.order,
    "number-asc": (a, b) => a.order - b.order,
  };
  return filtered.sort(sorters[elements.sort.value]);
}

function renderBadges(container, item) {
  const isComparison = state.type === "comparison";
  const type = isComparison ? getComparisonType(item) : getChangeType(item);
  if (isComparison && type === "new") {
    const badge = document.createElement("span");
    badge.className = "badge badge--new";
    badge.textContent = "決算のみ";
    container.append(badge);
  } else if (isComparison && type === "ended") {
    const badge = document.createElement("span");
    badge.className = "badge";
    badge.textContent = "予算のみ";
    container.append(badge);
  } else if (!isComparison && type === "new") {
    const badge = document.createElement("span");
    badge.className = "badge badge--new";
    badge.textContent = "新規・前年度0円";
    container.append(badge);
  } else if (!isComparison && type === "ended") {
    const badge = document.createElement("span");
    badge.className = "badge";
    badge.textContent = "終了・計上なし";
    container.append(badge);
  }
  if (item.category1) {
    const category = document.createElement("span");
    category.className = "badge";
    category.textContent = item.category1;
    container.append(category);
  }
}

function addMobileComparison(container, label, value, className = "", isAmount = true) {
  const group = document.createElement("div");
  const term = document.createElement("dt");
  const description = document.createElement("dd");
  term.textContent = label;
  if (className) description.className = className;
  if (isAmount) setAmountContent(description, value);
  else description.textContent = value;
  group.append(term, description);
  container.append(group);
}

function renderRow(item) {
  const fragment = elements.template.content.cloneNode(true);
  const isComparison = state.type === "comparison";
  renderBadges(fragment.querySelector(".badge-line"), item);
  fragment.querySelector("strong").textContent = item.name;
  fragment.querySelector(".recipient").textContent = `交付先：${item.recipient || "原資料に記載なし"}`;
  fragment.querySelector(".bureau").textContent = item.bureau;
  fragment.querySelector(".detail-button").addEventListener("click", () => openTrendDialog(item));

  if (isComparison) {
    const diff = item.budget === null || item.settlement === null ? null : item.settlement - item.budget;
    const rate = item.budget > 0 && item.settlement !== null ? (item.settlement / item.budget) * 100 : null;
    const changeClass = diff === null ? "change-same" : diff > 0 ? "change-up" : diff < 0 ? "change-down" : "change-same";
    const rateText = rate === null ? "—" : `${rate.toFixed(1)}%`;
    fragment.querySelector(".mobile-meta").textContent = item.bureau;
    setAmountContent(fragment.querySelector(".current"), item.budget);
    setAmountContent(fragment.querySelector(".previous"), item.settlement);
    const changeCell = fragment.querySelector(".change");
    setAmountContent(changeCell, diff);
    changeCell.classList.add(changeClass);
    fragment.querySelector(".years").textContent = rateText;
    const mobile = fragment.querySelector(".mobile-comparison");
    addMobileComparison(mobile, "予算額", item.budget);
    addMobileComparison(mobile, "決算額", item.settlement);
    addMobileComparison(mobile, "予算差", diff, changeClass);
    addMobileComparison(mobile, "執行率", rateText, "", false);
    return fragment;
  }

  const diff = item.previous === null ? null : item.current - item.previous;
  const changeClass = diff === null ? "change-same" : diff > 0 ? "change-up" : diff < 0 ? "change-down" : "change-same";
  const yearsText = item.years === null ? "継続年数なし" : `継続 ${item.years}年`;
  const previousText = item.previous === null ? "前年度額なし" : `${state.dataset.previousYearLabel} ${formatReadableAmount(item.previous)}`;
  fragment.querySelector(".mobile-meta").textContent = `${item.bureau} / ${yearsText} / ${previousText}`;
  setAmountContent(fragment.querySelector(".current"), item.current);
  fragment.querySelector(".current").dataset.label = state.dataset.yearLabel;
  setAmountContent(fragment.querySelector(".previous"), item.previous);
  const changeCell = fragment.querySelector(".change");
  changeCell.dataset.label = "前年度比";
  changeCell.classList.add(changeClass);
  setAmountContent(changeCell, diff);
  fragment.querySelector(".years").textContent = item.years === null ? "—" : `${item.years}年`;
  return fragment;
}

function renderActiveFilters() {
  elements.active.replaceChildren();
  const filters = [
    ["keyword", elements.keyword.value.trim() && `「${elements.keyword.value.trim()}」`],
    ["bureau", elements.bureau.value],
    ["recipient", elements.recipient.value],
    ["amount", elements.amount.value && elements.amount.selectedOptions[0].textContent],
    ["change", elements.change.value && elements.change.selectedOptions[0].textContent],
  ];
  filters.forEach(([key, label]) => {
    if (!label) return;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "filter-chip";
    button.textContent = label;
    button.setAttribute("aria-label", `${label}の条件を解除`);
    button.addEventListener("click", () => {
      elements[key].value = "";
      state.visible = PAGE_SIZE;
      render();
    });
    elements.active.append(button);
  });
}

function render() {
  if (!state.dataset) return;
  elements.empty.querySelector("strong").textContent = "該当する補助・助成金がありません";
  elements.empty.querySelector("p").textContent = "キーワードを短くするか、条件を減らしてみてください。";
  elements.empty.querySelector("button").hidden = false;
  const items = getFilteredItems();
  elements.body.replaceChildren(...items.slice(0, state.visible).map(renderRow));
  elements.empty.hidden = items.length !== 0;
  elements.more.hidden = state.visible >= items.length;
  if (!elements.more.hidden) elements.more.textContent = `続きを表示（残り${yen.format(items.length - state.visible)}件）`;
  renderActiveFilters();
}

function resetFilters({ renderAfter = true } = {}) {
  [elements.keyword, elements.bureau, elements.recipient, elements.amount, elements.change].forEach((control) => {
    control.value = "";
  });
  elements.sort.value = state.type === "comparison" ? "settlement-desc" : "amount-desc";
  state.visible = PAGE_SIZE;
  if (renderAfter) render();
}

function mergeComparisonData(pair, budget, settlement) {
  const settlementBuckets = new Map();
  settlement.items.forEach((item) => {
    const key = normalizeName(item.name);
    if (!settlementBuckets.has(key)) settlementBuckets.set(key, []);
    settlementBuckets.get(key).push(item);
  });
  const merged = [];
  let matchedCount = 0;
  const addItem = (budgetItem, settlementItem) => {
    const source = settlementItem || budgetItem;
    merged.push({
      order: Math.min(budgetItem?.order ?? Number.MAX_SAFE_INTEGER, settlementItem?.order ?? Number.MAX_SAFE_INTEGER),
      name: source.name,
      budget: budgetItem?.current ?? null,
      settlement: settlementItem?.current ?? null,
      recipient: source.recipient,
      bureau: source.bureau,
      years: source.years,
      category1: source.category1,
      category2: source.category2,
      category3: source.category3,
    });
  };
  budget.items.forEach((budgetItem) => {
    const bucket = settlementBuckets.get(normalizeName(budgetItem.name));
    const settlementItem = bucket?.shift() || null;
    if (settlementItem) matchedCount += 1;
    addItem(budgetItem, settlementItem);
  });
  settlementBuckets.forEach((bucket) => bucket.forEach((settlementItem) => addItem(null, settlementItem)));
  return {
    type: "comparison",
    typeLabel: "予算・決算比較",
    year: pair.year,
    yearLabel: pair.yearLabel,
    budgetYearLabel: budget.yearLabel,
    sourceUrl: settlement.sourceUrl,
    budgetSourceUrl: budget.sourceUrl,
    updatedAt: settlement.updatedAt > budget.updatedAt ? settlement.updatedAt : budget.updatedAt,
    recordCount: merged.length,
    matchedCount,
    budgetTotal: budget.currentTotal,
    settlementTotal: settlement.currentTotal,
    items: merged,
  };
}

async function fetchDataset(manifest) {
  const file = DataSecurity.datasetFile(manifest.file);
  return DataSecurity.validateDataset(await fetchJson(`data/${file}`, 8 * 1024 * 1024), manifest);
}

async function loadDataset() {
  const requestId = ++state.loadToken;
  clearDatasetDisplay();
  elements.empty.hidden = true;
  elements.status.textContent = "データを読み込んでいます…";
  try {
    let dataset;
    if (state.type === "comparison") {
      const pair = selectedComparisonPair();
      if (!pair) throw new Error("Comparison dataset is not listed in index.json");
      const [budget, settlement] = await Promise.all([fetchDataset(pair.budget), fetchDataset(pair.settlement)]);
      dataset = mergeComparisonData(pair, budget, settlement);
    } else {
      const manifest = selectedManifest();
      if (!manifest) throw new Error("Dataset is not listed in index.json");
      dataset = await fetchDataset(manifest);
    }
    if (requestId !== state.loadToken) return;
    state.dataset = dataset;
    state.items = dataset.items;
    setSearchDisabled(false);
    configureModeControls();
    resetFilters({ renderAfter: false });
    rebuildFilters();
    updateDatasetUI();
    render();
  } catch (error) {
    if (requestId === state.loadToken) showError(error);
  }
}

function showError(error) {
  console.error(error);
  clearDatasetDisplay();
  elements.status.textContent = "データを読み込めませんでした";
  elements.empty.hidden = false;
  elements.empty.querySelector("strong").textContent = "データを読み込めませんでした";
  elements.empty.querySelector("p").textContent = "データの取得または安全性の確認に失敗しました。別の年度を選ぶか、時間を置いて再読み込みしてください。ローカルでは簡易サーバー経由で開いてください。";
  elements.empty.querySelector("button").hidden = true;
}

async function init() {
  clearDatasetDisplay();
  try {
    state.index = DataSecurity.validateIndex(await fetchJson(INDEX_URL, 1024 * 1024));
    const requested = new URLSearchParams(location.search);
    const requestedType = requested.get("type");
    const requestedYear = requested.get("year");
    if (["budget", "settlement", "comparison"].includes(requestedType)) state.type = requestedType;
    const requestedDatasets = availableDatasets();
    if (requestedDatasets.some((dataset) => dataset.year === requestedYear)) {
      state.year = requestedYear;
    } else {
      state.year = requestedDatasets[0]?.year || state.year;
    }
    elements.typeButtons.forEach((button) => { button.disabled = button.dataset.type === "comparison" && comparisonDatasets().length === 0; });
    populateYears();
    await loadDataset();
  } catch (error) {
    showError(error);
  }
}

elements.typeButtons.forEach((button) => {
  button.addEventListener("click", async () => {
    if (!state.index || button.disabled) return;
    if (button.dataset.type === state.type) return;
    state.type = button.dataset.type;
    state.year = availableDatasets()[0].year;
    populateYears();
    await loadDataset().catch(showError);
  });
});

elements.year.addEventListener("change", async () => {
  if (!state.index) return;
  state.year = elements.year.value;
  await loadDataset().catch(showError);
});

[elements.keyword, elements.bureau, elements.recipient, elements.amount, elements.change, elements.sort].forEach((control) => {
  control.addEventListener(control === elements.keyword ? "input" : "change", () => {
    if (!state.dataset) return;
    if (control === elements.keyword) elements.keyword.value = elements.keyword.value.slice(0, MAX_KEYWORD_LENGTH);
    state.visible = PAGE_SIZE;
    render();
  });
});

elements.more.addEventListener("click", () => {
  state.visible += PAGE_SIZE;
  render();
});
elements.reset.addEventListener("click", () => resetFilters());
document.querySelector("[data-reset]").addEventListener("click", () => resetFilters());
elements.trendClose.addEventListener("click", () => elements.trendDialog.close());
elements.trendDialog.addEventListener("close", () => { state.trendToken += 1; });
const repositionActiveTooltip = () => {
  elements.trendPlot.querySelectorAll(".trend-bar:hover, .trend-bar:focus").forEach(positionTrendTooltip);
};
elements.trendScroll.addEventListener("scroll", repositionActiveTooltip, { passive: true });
window.addEventListener("resize", repositionActiveTooltip);
elements.trendDialog.addEventListener("click", (event) => {
  if (event.target === elements.trendDialog) elements.trendDialog.close();
});

init();
