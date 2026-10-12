const GENERAL_ACCOUNT_INDEX_URL = "data/general-account/index.json";

const integerFormat = new Intl.NumberFormat("ja-JP");
const decimalFormat = new Intl.NumberFormat("ja-JP", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
let generalAccountIndex = null;
let generalAccountLoadToken = 0;

async function fetchGeneralAccountIndex() {
  return DataSecurity.validateGeneralAccountIndex(
    await DataSecurity.fetchJson(GENERAL_ACCOUNT_INDEX_URL, 64 * 1024),
  );
}

async function fetchGeneralAccount(manifest) {
  const file = DataSecurity.generalAccountFile(manifest.file);
  const data = DataSecurity.validateGeneralAccount(
    await DataSecurity.fetchJson(`data/general-account/${file}`, 512 * 1024),
  );
  if (data.year !== manifest.year || data.yearLabel !== manifest.yearLabel) throw new Error("年度一覧とデータが一致しません");
  return data;
}

function readableAmount(value) {
  const absolute = Math.abs(value);
  const sign = value < 0 ? "−" : "";
  if (absolute >= 100000) return `${sign}${decimalFormat.format(absolute / 100000)}億円`;
  if (absolute >= 10) return `${sign}${decimalFormat.format(absolute / 10)}万円`;
  return `${sign}${integerFormat.format(absolute * 1000)}円`;
}

const sourceAmount = (value) => `${value < 0 ? "−" : ""}${integerFormat.format(Math.abs(value))}千円`;
const percent = (value, total) => `${decimalFormat.format(total > 0 ? (value / total) * 100 : 0)}%`;

function changeRate(current, previous) {
  if (previous === 0) return current === 0 ? "—" : "新規";
  return `${current >= previous ? "+" : "−"}${decimalFormat.format(Math.abs(((current - previous) / previous) * 100))}%`;
}

const SVG_NAMESPACE = "http://www.w3.org/2000/svg";

function svgElement(name, attributes = {}) {
  const element = document.createElementNS(SVG_NAMESPACE, name);
  Object.entries(attributes).forEach(([key, value]) => element.setAttribute(key, String(value)));
  return element;
}

function groupSankeyRows(rows, prefix, limit = 7) {
  const sorted = [...rows].sort((a, b) => b.current - a.current);
  const visible = sorted.slice(0, limit).map((row) => ({
    key: `${prefix}-${row.order}`,
    name: row.name,
    value: row.current,
    count: 1,
    other: false,
  }));
  const remainder = sorted.slice(limit);
  if (remainder.length > 0) {
    visible.push({
      key: `${prefix}-other`,
      name: `その他（${remainder.length}項目）`,
      value: remainder.reduce((sum, row) => sum + row.current, 0),
      count: remainder.length,
      other: true,
    });
  }
  return visible;
}

function sankeyColumnLayout(rows, x, nodeWidth, top, scale, gap) {
  let y = top;
  return rows.map((row) => {
    const height = row.value * scale;
    const node = { ...row, x0: x, x1: x + nodeWidth, y0: y, y1: y + height };
    y += height + gap;
    return node;
  });
}

function sankeyLabelPositions(nodes, minimum, maximum, minimumGap = 44) {
  if (nodes.length === 0) return [];
  if (nodes.length === 1) {
    const center = (nodes[0].y0 + nodes[0].y1) / 2;
    return [Math.min(maximum, Math.max(minimum, center))];
  }
  const gap = Math.min(minimumGap, (maximum - minimum) / (nodes.length - 1));
  const positions = nodes.map((node) => Math.min(maximum, Math.max(minimum, (node.y0 + node.y1) / 2)));
  for (let index = 1; index < positions.length; index += 1) {
    positions[index] = Math.max(positions[index], positions[index - 1] + gap);
  }
  if (positions.at(-1) > maximum) {
    positions[positions.length - 1] = maximum;
    for (let index = positions.length - 2; index >= 0; index -= 1) {
      positions[index] = Math.min(positions[index], positions[index + 1] - gap);
    }
  }
  return positions;
}

function sankeyBandPath(x0, sourceTop, sourceBottom, x1, targetTop, targetBottom) {
  const middle = (x0 + x1) / 2;
  return [
    `M${x0},${sourceTop}`,
    `C${middle},${sourceTop} ${middle},${targetTop} ${x1},${targetTop}`,
    `L${x1},${targetBottom}`,
    `C${middle},${targetBottom} ${middle},${sourceBottom} ${x0},${sourceBottom}`,
    "Z",
  ].join(" ");
}

function renderSankey(data) {
  const svg = document.querySelector("#account-sankey");
  const detail = document.querySelector("#sankey-detail");
  const detailTitle = detail.querySelector("strong");
  const detailText = detail.querySelector("span");
  const total = data.summary.current;
  const width = 1200;
  const height = 690;
  const top = 88;
  const bottom = 30;
  const gap = 10;
  const sideWidth = 18;
  const centerWidth = 28;
  const leftX = 270;
  const centerX = (width - centerWidth) / 2;
  const rightX = 912;
  const revenueRows = groupSankeyRows(data.revenue, "revenue");
  const expenseRows = groupSankeyRows(data.expenditurePurpose, "expense");
  const maximumCount = Math.max(revenueRows.length, expenseRows.length);
  const availableForNodes = height - top - bottom - gap * (maximumCount - 1);
  const scale = availableForNodes / total;
  const revenueNodes = sankeyColumnLayout(revenueRows, leftX, sideWidth, top, scale, gap);
  const expenseNodes = sankeyColumnLayout(expenseRows, rightX, sideWidth, top, scale, gap);
  const labelMinimum = top + 18;
  const labelMaximum = height - bottom - 20;
  const revenueLabelYs = sankeyLabelPositions(revenueNodes, labelMinimum, labelMaximum);
  const expenseLabelYs = sankeyLabelPositions(expenseNodes, labelMinimum, labelMaximum);
  const centerHeight = total * scale;
  const centerTop = top + ((height - top - bottom) - centerHeight) / 2;
  const centerBottom = centerTop + centerHeight;
  const entries = [];
  let pinnedKey = null;

  svg.replaceChildren();
  const title = svgElement("title", { id: "sankey-title" });
  title.textContent = `${data.yearLabel}一般会計の歳入から目的別歳出への全体構成`;
  const description = svgElement("desc", { id: "sankey-description" });
  description.textContent = "左側に歳入上位7項目とその他、中央に一般会計総額、右側に目的別歳出上位7項目とその他を配置し、金額に比例した帯で接続しています。";
  svg.append(title, description);

  const headingLayer = svgElement("g", { class: "sankey-headings", "aria-hidden": "true" });
  [
    { x: leftX + sideWidth / 2, title: "歳入", note: "どこから入るか" },
    { x: centerX + centerWidth / 2, title: "一般会計", note: readableAmount(total) },
    { x: rightX + sideWidth / 2, title: "目的別歳出", note: "何のために使うか" },
  ].forEach((heading) => {
    const primary = svgElement("text", { x: heading.x, y: 28, "text-anchor": "middle", class: "sankey-heading-primary" });
    primary.textContent = heading.title;
    const secondary = svgElement("text", { x: heading.x, y: 50, "text-anchor": "middle", class: "sankey-heading-secondary" });
    secondary.textContent = heading.note;
    headingLayer.append(primary, secondary);
  });
  svg.append(headingLayer);

  const linksLayer = svgElement("g", { class: "sankey-links" });
  let incomingY = centerTop;
  revenueNodes.forEach((node) => {
    const bandHeight = node.value * scale;
    const path = svgElement("path", {
      d: sankeyBandPath(node.x1, node.y0, node.y1, centerX, incomingY, incomingY + bandHeight),
      class: "sankey-link sankey-link--revenue sankey-item",
      "data-flow-key": node.key,
      "aria-hidden": "true",
    });
    linksLayer.append(path);
    entries.push({ element: path, item: { ...node, side: "歳入" } });
    incomingY += bandHeight;
  });
  let outgoingY = centerTop;
  expenseNodes.forEach((node) => {
    const bandHeight = node.value * scale;
    const path = svgElement("path", {
      d: sankeyBandPath(centerX + centerWidth, outgoingY, outgoingY + bandHeight, node.x0, node.y0, node.y1),
      class: "sankey-link sankey-link--expense sankey-item",
      "data-flow-key": node.key,
      "aria-hidden": "true",
    });
    linksLayer.append(path);
    entries.push({ element: path, item: { ...node, side: "目的別歳出" } });
    outgoingY += bandHeight;
  });
  svg.append(linksLayer);

  const nodesLayer = svgElement("g", { class: "sankey-nodes" });
  const defaultTitle = "図の見方";
  const defaultText = "左の歳入と右の目的別歳出は、それぞれ金額上位7項目と「その他」で表示します。";

  function resetSelection() {
    entries.forEach(({ element }) => element.classList.remove("is-active", "is-muted"));
    nodesLayer.querySelectorAll("[aria-pressed]").forEach((node) => node.setAttribute("aria-pressed", "false"));
    detailTitle.textContent = defaultTitle;
    detailText.textContent = defaultText;
  }

  function showSelection(item) {
    const isTotal = item.side === "一般会計";
    entries.forEach(({ element, item: entryItem }) => {
      element.classList.toggle("is-active", isTotal || entryItem.key === item.key);
      element.classList.toggle("is-muted", !isTotal && entryItem.key !== item.key && entryItem.side !== "一般会計");
    });
    nodesLayer.querySelectorAll("[aria-pressed]").forEach((node) => {
      node.setAttribute("aria-pressed", String(node.dataset.flowKey === item.key));
    });
    detailTitle.textContent = item.side;
    const otherNote = item.other ? `。${item.count}項目をまとめています` : "";
    detailText.textContent = `${item.name}：${readableAmount(item.value)}（一般会計の${percent(item.value, total)}）${otherNote}`;
  }

  function selectItem(item) {
    if (pinnedKey === item.key) {
      pinnedKey = null;
      resetSelection();
    } else {
      pinnedKey = item.key;
      showSelection(item);
    }
  }

  function bindPointer(element, item) {
    element.addEventListener("pointerenter", () => { if (!pinnedKey) showSelection(item); });
    element.addEventListener("pointerleave", () => { if (!pinnedKey) resetSelection(); });
    element.addEventListener("click", (event) => { event.stopPropagation(); selectItem(item); });
  }

  entries.filter(({ element }) => element.classList.contains("sankey-link")).forEach(({ element, item }) => bindPointer(element, item));

  function addNode(node, side, labelSide, labelY) {
    const item = { ...node, side };
    const group = svgElement("g", {
      class: `sankey-node sankey-node--${side === "歳入" ? "revenue" : "expense"} sankey-item${node.other ? " sankey-node--other" : ""}`,
      role: "button",
      tabindex: "0",
      "aria-pressed": "false",
      "aria-label": `${side} ${node.name} ${readableAmount(node.value)} 一般会計の${percent(node.value, total)}`,
      "data-flow-key": node.key,
    });
    const labelX = labelSide === "left" ? node.x0 - 14 : node.x1 + 14;
    const anchor = labelSide === "left" ? "end" : "start";
    const middleY = (node.y0 + node.y1) / 2;
    const hitX = labelSide === "left" ? 8 : node.x0;
    const hitWidth = labelSide === "left" ? node.x1 - 8 : width - node.x0 - 8;
    const hit = svgElement("rect", { x: hitX, y: labelY - 22, width: hitWidth, height: 44, class: "sankey-node-hit" });
    const bar = svgElement("rect", { x: node.x0, y: node.y0, width: node.x1 - node.x0, height: Math.max(node.y1 - node.y0, 1), class: "sankey-node-bar" });
    const guideStartX = labelSide === "left" ? node.x0 - 4 : node.x1 + 4;
    const guideEndX = labelSide === "left" ? node.x0 - 10 : node.x1 + 10;
    const guide = svgElement("path", {
      d: `M${guideStartX},${middleY} L${guideEndX},${labelY}`,
      class: "sankey-label-guide",
      "aria-hidden": "true",
    });
    const name = svgElement("text", { x: labelX, y: labelY - 2, "text-anchor": anchor, class: "sankey-node-name" });
    name.textContent = node.name;
    const value = svgElement("text", { x: labelX, y: labelY + 16, "text-anchor": anchor, class: "sankey-node-value" });
    value.textContent = `${readableAmount(node.value)} / ${percent(node.value, total)}`;
    const nativeTitle = svgElement("title");
    nativeTitle.textContent = `${node.name}：${readableAmount(node.value)}（${percent(node.value, total)}）`;
    group.append(nativeTitle, hit, bar, guide, name, value);
    bindPointer(group, item);
    group.addEventListener("focus", () => { if (!pinnedKey) showSelection(item); });
    group.addEventListener("blur", () => { if (!pinnedKey) resetSelection(); });
    group.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        selectItem(item);
      } else if (event.key === "Escape") {
        pinnedKey = null;
        resetSelection();
      }
    });
    nodesLayer.append(group);
    entries.push({ element: group, item });
  }

  revenueNodes.forEach((node, index) => addNode(node, "歳入", "left", revenueLabelYs[index]));
  expenseNodes.forEach((node, index) => addNode(node, "目的別歳出", "right", expenseLabelYs[index]));

  const totalItem = { key: "general-account", name: `${data.yearLabel}一般会計`, value: total, side: "一般会計", other: false, count: 1 };
  const centerGroup = svgElement("g", {
    class: "sankey-node sankey-node--total sankey-item",
    role: "button",
    tabindex: "0",
    "aria-pressed": "false",
    "aria-label": `${data.yearLabel}一般会計 ${readableAmount(total)}`,
    "data-flow-key": totalItem.key,
  });
  const centerTitle = svgElement("title");
  centerTitle.textContent = `${data.yearLabel}一般会計：${readableAmount(total)}`;
  const centerBar = svgElement("rect", { x: centerX, y: centerTop, width: centerWidth, height: centerBottom - centerTop, class: "sankey-node-bar" });
  centerGroup.append(centerTitle, centerBar);
  bindPointer(centerGroup, totalItem);
  centerGroup.addEventListener("focus", () => { if (!pinnedKey) showSelection(totalItem); });
  centerGroup.addEventListener("blur", () => { if (!pinnedKey) resetSelection(); });
  centerGroup.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      selectItem(totalItem);
    } else if (event.key === "Escape") {
      pinnedKey = null;
      resetSelection();
    }
  });
  nodesLayer.append(centerGroup);
  entries.push({ element: centerGroup, item: totalItem });
  svg.append(nodesLayer);
  svg.onclick = (event) => {
    if (event.target === svg) {
      pinnedKey = null;
      resetSelection();
    }
  };
}

function amountCell(value) {
  const cell = document.createElement("td");
  cell.className = "number-cell";
  const primary = document.createElement("span");
  primary.className = "amount-primary";
  primary.textContent = readableAmount(value);
  const source = document.createElement("span");
  source.className = "amount-source";
  source.textContent = sourceAmount(value);
  cell.append(primary, source);
  return cell;
}

function renderTable(rows, body, total) {
  const fragment = document.createDocumentFragment();
  rows.forEach((item) => {
    const row = document.createElement("tr");
    const name = document.createElement("th");
    name.scope = "row";
    name.textContent = item.name;
    const share = document.createElement("td");
    share.className = "number-cell";
    share.textContent = percent(item.current, total);
    const change = item.current - item.previous;
    const changeCell = amountCell(change);
    changeCell.classList.add(change > 0 ? "change-up" : change < 0 ? "change-down" : "change-same");
    row.append(name, amountCell(item.current), share, amountCell(item.previous), changeCell);
    fragment.append(row);
  });
  body.replaceChildren(fragment);
}

function renderBars(rows, target, total, limit) {
  const selected = [...rows].sort((a, b) => b.current - a.current).slice(0, limit);
  const maximum = selected[0]?.current || 1;
  const fragment = document.createDocumentFragment();
  selected.forEach((item) => {
    const row = document.createElement("li");
    const heading = document.createElement("div");
    const name = document.createElement("strong");
    name.textContent = item.name;
    const values = document.createElement("span");
    values.textContent = `${readableAmount(item.current)} / ${percent(item.current, total)}`;
    heading.append(name, values);
    const track = document.createElement("div");
    track.className = "account-bar-track";
    track.setAttribute("aria-hidden", "true");
    const bar = document.createElement("i");
    bar.style.width = `${Math.max((item.current / maximum) * 100, 0.4)}%`;
    track.append(bar);
    const comparison = document.createElement("small");
    const difference = item.current - item.previous;
    comparison.className = difference > 0 ? "change-up" : difference < 0 ? "change-down" : "change-same";
    comparison.textContent = `前年度比 ${changeRate(item.current, item.previous)}（${readableAmount(difference)}）`;
    row.append(heading, track, comparison);
    fragment.append(row);
  });
  target.replaceChildren(fragment);
}

function renderResourceSplit(data) {
  const total = data.summary.current;
  const ownShare = (data.summary.autonomous / total) * 100;
  const dependentShare = 100 - ownShare;
  const split = document.querySelector("#resource-split");
  const own = document.createElement("span");
  own.className = "resource-split-own";
  own.style.width = `${ownShare}%`;
  own.textContent = `${decimalFormat.format(ownShare)}%`;
  const dependent = document.createElement("span");
  dependent.className = "resource-split-dependent";
  dependent.style.width = `${dependentShare}%`;
  dependent.textContent = `${decimalFormat.format(dependentShare)}%`;
  split.replaceChildren(own, dependent);
  split.setAttribute("aria-label", `自主財源 ${decimalFormat.format(ownShare)}パーセント、依存財源 ${decimalFormat.format(dependentShare)}パーセント`);
  document.querySelector("#autonomous-amount").textContent = readableAmount(data.summary.autonomous);
  document.querySelector("#dependent-amount").textContent = readableAmount(data.summary.dependent);
}

function renderChangeRanking(rows, target) {
  const selected = [...rows]
    .sort((a, b) => Math.abs(b.current - b.previous) - Math.abs(a.current - a.previous))
    .slice(0, 3);
  const fragment = document.createDocumentFragment();
  selected.forEach((item) => {
    const difference = item.current - item.previous;
    const row = document.createElement("li");
    const name = document.createElement("span");
    name.textContent = item.name;
    const amount = document.createElement("strong");
    amount.className = difference > 0 ? "change-up" : difference < 0 ? "change-down" : "change-same";
    amount.textContent = `${difference > 0 ? "+" : ""}${readableAmount(difference)}`;
    const rate = document.createElement("small");
    rate.textContent = `前年度比 ${changeRate(item.current, item.previous)}`;
    row.append(name, amount, rate);
    fragment.append(row);
  });
  target.replaceChildren(fragment);
}

function renderChanges(data) {
  const difference = data.summary.current - data.summary.previous;
  document.querySelector("#comparison-previous").textContent = readableAmount(data.summary.previous);
  document.querySelector("#comparison-current").textContent = readableAmount(data.summary.current);
  const differenceNode = document.querySelector("#comparison-difference");
  differenceNode.textContent = `${difference > 0 ? "+" : ""}${readableAmount(difference)}`;
  differenceNode.className = difference > 0 ? "change-up" : difference < 0 ? "change-down" : "change-same";
  document.querySelector("#comparison-rate").textContent = `前年度比 ${changeRate(data.summary.current, data.summary.previous)}`;
  renderChangeRanking(data.revenue, document.querySelector("#revenue-changes"));
  renderChangeRanking(data.expenditurePurpose, document.querySelector("#purpose-changes"));
  renderChangeRanking(data.expenditureNature, document.querySelector("#nature-changes"));
}

function renderNature(data) {
  const container = document.querySelector("#nature-groups");
  const fragment = document.createDocumentFragment();
  data.expenditureNature.forEach((group, index) => {
    const article = document.createElement("article");
    article.className = `nature-card nature-card--${index + 1}`;
    const kicker = document.createElement("span");
    kicker.textContent = `一般会計の${percent(group.current, data.summary.current)}`;
    const heading = document.createElement("h3");
    heading.textContent = group.name;
    const amount = document.createElement("strong");
    amount.textContent = readableAmount(group.current);
    const comparison = document.createElement("small");
    const difference = group.current - group.previous;
    comparison.className = difference > 0 ? "change-up" : difference < 0 ? "change-down" : "change-same";
    comparison.textContent = `前年度比 ${changeRate(group.current, group.previous)}`;
    const list = document.createElement("dl");
    group.items.forEach((item) => {
      const row = document.createElement("div");
      const term = document.createElement("dt");
      term.textContent = item.name;
      const description = document.createElement("dd");
      description.textContent = `${readableAmount(item.current)}（${percent(item.current, data.summary.current)}）`;
      row.append(term, description);
      list.append(row);
    });
    article.append(kicker, heading, amount, comparison, list);
    fragment.append(article);
  });
  container.replaceChildren(fragment);
}

function renderPerCapita(data) {
  document.querySelector("#per-capita-total").textContent = `${integerFormat.format(data.summary.perCapitaYen)}円`;
  const maximum = Math.max(...data.perCapita.map((item) => item.yen));
  const fragment = document.createDocumentFragment();
  data.perCapita.forEach((item) => {
    const row = document.createElement("li");
    const name = document.createElement("span");
    name.textContent = item.name;
    const amount = document.createElement("strong");
    amount.textContent = `${integerFormat.format(item.yen)}円`;
    const track = document.createElement("i");
    track.setAttribute("aria-hidden", "true");
    track.style.setProperty("--per-capita-size", `${Math.max((item.yen / maximum) * 100, 0.4)}%`);
    row.append(name, amount, track);
    fragment.append(row);
  });
  document.querySelector("#per-capita-list").replaceChildren(fragment);
}

function renderGeneralAccount(data) {
  const total = data.summary.current;
  const difference = total - data.summary.previous;
  document.querySelector("#account-kicker").textContent = `${data.yearLabel} / ${data.budgetStageLabel}`;
  document.querySelector("#changes-description").textContent = `${data.previousYearLabel}当初予算と比べた増減です。増減額の大きい項目を機械的に抽出しており、増減の理由を示すものではありません。`;
  document.querySelector("#comparison-previous-label").textContent = data.previousYearLabel;
  document.querySelector("#comparison-current-label").textContent = data.yearLabel;
  for (const id of ["revenue-current-heading", "purpose-current-heading"]) document.querySelector(`#${id}`).textContent = data.yearLabel;
  for (const id of ["revenue-previous-heading", "purpose-previous-heading"]) document.querySelector(`#${id}`).textContent = data.previousYearLabel;
  document.querySelector("#account-total").textContent = readableAmount(total);
  document.querySelector("#account-total-source").textContent = `原資料：${sourceAmount(total)}`;
  document.querySelector("#account-change").textContent = readableAmount(difference);
  document.querySelector("#account-change").classList.remove("summary-up", "summary-down");
  document.querySelector("#account-change").classList.add(difference >= 0 ? "summary-up" : "summary-down");
  document.querySelector("#account-change-rate").textContent = `前年度比 ${changeRate(total, data.summary.previous)}`;
  document.querySelector("#account-per-capita").textContent = `${integerFormat.format(data.summary.perCapitaYen)}円`;
  document.querySelector("#account-population").textContent = `推計人口 ${integerFormat.format(data.summary.population)}人で算出`;
  document.querySelector("#account-autonomous-share").textContent = percent(data.summary.autonomous, total);

  renderSankey(data);
  renderChanges(data);
  renderResourceSplit(data);
  renderBars(data.revenue, document.querySelector("#revenue-chart"), total, 8);
  renderTable(data.revenue, document.querySelector("#revenue-body"), total);
  renderBars(data.expenditurePurpose, document.querySelector("#purpose-chart"), total, 10);
  renderTable(data.expenditurePurpose, document.querySelector("#purpose-body"), total);
  renderNature(data);
  renderPerCapita(data);

  const populationDate = data.yearLabel.replace(/年度$/, "年1月1日");
  const roundedPerCapita = data.perCapita.every((item) => !Object.hasOwn(item, "amount"));
  document.querySelector("#per-capita-description").textContent = `${populationDate}現在の推計人口${integerFormat.format(data.summary.population)}人を基に、市民1人あたりの使いみちへ換算した公式資料の分類です。${roundedPerCapita ? " 金額は公式資料の表示に合わせ、千円単位に丸めています。" : ""}`;
  document.querySelector("#subsidy-year-label").textContent = data.yearLabel;
  document.querySelector("#subsidy-total").textContent = `${readableAmount(data.subsidyContext.total)}（${integerFormat.format(data.subsidyContext.records)}件）`;
  document.querySelector("#subsidy-share").textContent = percent(data.subsidyContext.total, total);
  const subsidyLink = document.querySelector("#subsidy-year-link");
  subsidyLink.href = `./?type=budget&year=${encodeURIComponent(data.year)}`;
  subsidyLink.textContent = `${data.yearLabel}の補助・助成金を見る`;
  document.querySelector("#account-source-header").href = DataSecurity.sourcePageUrl(data.sourcePageUrl);
  document.querySelector("#account-source-page").href = DataSecurity.sourcePageUrl(data.sourcePageUrl);
  document.querySelector("#account-source-pdf").href = DataSecurity.sourcePdfUrl(data.sourceUrl);
  document.querySelector("#account-source-description").textContent = `川崎市が公開した${data.sourceDescription}を基に、本サイトで表とグラフへ整理しました。金額は千円単位の原数値から換算しています。`;
  document.querySelector("#account-source-page-label").textContent = data.sourcePageLabel;
  document.querySelector("#account-source-pdf-label").textContent = data.sourcePdfLabel;
  document.querySelector("#account-source-label").textContent = `${data.yearLabel} 一般会計 ${data.budgetStageLabel}`;
  const updated = /^(\d{4})-(\d{2})-(\d{2})$/.exec(data.updatedAt);
  document.querySelector("#account-updated").textContent = updated
    ? `${updated[1]}年${Number(updated[2])}月${Number(updated[3])}日`
    : data.updatedAt;
  document.title = `${data.yearLabel}一般会計｜かわさき Money Viewer`;
}

function updateGeneralAccountUrl(year) {
  const url = new URL(location.href);
  url.searchParams.set("year", year);
  history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
}

async function loadGeneralAccount(manifest) {
  const token = ++generalAccountLoadToken;
  const content = document.querySelector("#account-content");
  const status = document.querySelector("#account-status");
  const errorPanel = document.querySelector("#account-error");
  const yearSelect = document.querySelector("#account-year-select");
  status.hidden = false;
  status.textContent = `${manifest.yearLabel}の一般会計データを読み込んでいます…`;
  errorPanel.hidden = true;
  content.setAttribute("aria-busy", "true");
  yearSelect.disabled = true;
  try {
    const data = await fetchGeneralAccount(manifest);
    if (token !== generalAccountLoadToken) return;
    renderGeneralAccount(data);
    updateGeneralAccountUrl(data.year);
    status.hidden = true;
    content.setAttribute("aria-busy", "false");
  } catch (error) {
    if (token !== generalAccountLoadToken) return;
    console.error(error);
    status.textContent = "データを読み込めませんでした";
    errorPanel.hidden = false;
    content.setAttribute("aria-busy", "false");
  } finally {
    if (token === generalAccountLoadToken) yearSelect.disabled = false;
  }
}

async function initializeGeneralAccount() {
  const yearSelect = document.querySelector("#account-year-select");
  try {
    generalAccountIndex = await fetchGeneralAccountIndex();
    const fragment = document.createDocumentFragment();
    generalAccountIndex.datasets.forEach((manifest) => {
      const option = document.createElement("option");
      option.value = manifest.year;
      option.textContent = manifest.yearLabel;
      fragment.append(option);
    });
    yearSelect.replaceChildren(fragment);
    const requestedYear = new URLSearchParams(location.search).get("year");
    const initial = generalAccountIndex.datasets.find((item) => item.year === requestedYear)
      || generalAccountIndex.datasets[0];
    yearSelect.value = initial.year;
    yearSelect.addEventListener("change", () => {
      const manifest = generalAccountIndex.datasets.find((item) => item.year === yearSelect.value);
      if (manifest) loadGeneralAccount(manifest);
    });
    await loadGeneralAccount(initial);
  } catch (error) {
    console.error(error);
    document.querySelector("#account-status").textContent = "年度一覧を読み込めませんでした";
    document.querySelector("#account-error").hidden = false;
    document.querySelector("#account-content").setAttribute("aria-busy", "false");
    yearSelect.disabled = true;
  }
}

initializeGeneralAccount();
