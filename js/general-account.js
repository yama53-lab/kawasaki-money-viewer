const GENERAL_ACCOUNT_URL = "data/general-account/R8.json";

const integerFormat = new Intl.NumberFormat("ja-JP");
const decimalFormat = new Intl.NumberFormat("ja-JP", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

async function fetchGeneralAccount() {
  return DataSecurity.validateGeneralAccount(await DataSecurity.fetchJson(GENERAL_ACCOUNT_URL, 512 * 1024));
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
  document.querySelector("#account-total").textContent = readableAmount(total);
  document.querySelector("#account-total-source").textContent = `原資料：${sourceAmount(total)}`;
  document.querySelector("#account-change").textContent = readableAmount(difference);
  document.querySelector("#account-change").classList.add(difference >= 0 ? "summary-up" : "summary-down");
  document.querySelector("#account-change-rate").textContent = `前年度比 ${changeRate(total, data.summary.previous)}`;
  document.querySelector("#account-per-capita").textContent = `${integerFormat.format(data.summary.perCapitaYen)}円`;
  document.querySelector("#account-population").textContent = `推計人口 ${integerFormat.format(data.summary.population)}人で算出`;
  document.querySelector("#account-autonomous-share").textContent = percent(data.summary.autonomous, total);

  renderChanges(data);
  renderResourceSplit(data);
  renderBars(data.revenue, document.querySelector("#revenue-chart"), total, 8);
  renderTable(data.revenue, document.querySelector("#revenue-body"), total);
  renderBars(data.expenditurePurpose, document.querySelector("#purpose-chart"), total, 10);
  renderTable(data.expenditurePurpose, document.querySelector("#purpose-body"), total);
  renderNature(data);
  renderPerCapita(data);

  document.querySelector("#subsidy-total").textContent = `${readableAmount(data.subsidyContext.total)}（${integerFormat.format(data.subsidyContext.records)}件）`;
  document.querySelector("#subsidy-share").textContent = percent(data.subsidyContext.total, total);
  document.querySelector("#account-source-page").href = DataSecurity.sourcePageUrl(data.sourcePageUrl);
  document.querySelector("#account-source-pdf").href = DataSecurity.sourcePdfUrl(data.sourceUrl);
  document.querySelector("#account-source-label").textContent = `${data.yearLabel} 一般会計 ${data.budgetStageLabel}`;
  document.querySelector("#account-updated").textContent = data.updatedAt.replace(/^(\d{4})-(\d{2})-(\d{2})$/, "$1年$2月$3日");
}

async function initializeGeneralAccount() {
  const content = document.querySelector("#account-content");
  try {
    const data = await fetchGeneralAccount();
    renderGeneralAccount(data);
    document.querySelector("#account-status").hidden = true;
    content.setAttribute("aria-busy", "false");
  } catch (error) {
    console.error(error);
    document.querySelector("#account-status").textContent = "データを読み込めませんでした";
    document.querySelector("#account-error").hidden = false;
    content.setAttribute("aria-busy", "false");
  }
}

initializeGeneralAccount();
