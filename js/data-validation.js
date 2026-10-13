/* Shared by the browser and the pre-publication checks. */
const DataSecurity = (() => {
  const MAX_AMOUNT = Math.floor(Number.MAX_SAFE_INTEGER / 1000);
  const FILE_PATTERN = /^(budget|settlement)\/[RH][1-9]\d{0,2}\.json$/;
  const GENERAL_ACCOUNT_FILE_PATTERN = /^[RH][1-9]\d{0,2}\.json$/;
  const normalizeName = (value) => value.normalize("NFKC").toLowerCase()
    .replace(/[\s\u3000・･]/g, "").replace(/[‐‑‒–—―－]/g, "-");
  const check = (condition, message) => { if (!condition) throw new Error(`データの検証に失敗しました：${message}`); };
  const record = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
  const text = (value, required = false, maximum = 8192) => typeof value === "string"
    && value.length <= maximum && (!required || value.length > 0);
  const integer = (value, maximum = MAX_AMOUNT) => Number.isSafeInteger(value) && value >= 0 && value <= maximum;
  const amount = (value) => value === null || integer(value);
  const validDate = (value) => text(value, true, 10) && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;

  function yearInfo(key) {
    check(typeof key === "string" && /^[RH][1-9]\d{0,2}$/.test(key), "年度識別子");
    const year = Number(key.slice(1));
    const sortYear = (key[0] === "R" ? 2018 : 1988) + year;
    check(sortYear >= 1989 && sortYear <= 2200, "年度の範囲");
    return { sortYear, label: key[0] === "R" ? `令和${year === 1 ? "元" : year}年度` : `平成${year}年度` };
  }

  function validYearLabel(label, sortYear) {
    if (!text(label, true, 32)) return false;
    const match = /^(平成|令和)(元|[1-9]\d{0,2})年度$/.exec(label);
    if (!match || (match[1] === "平成" && match[2] === "元")) return false;
    return (match[1] === "令和" ? 2018 : 1988) + (match[2] === "元" ? 1 : Number(match[2])) === sortYear;
  }

  function sourcePdfUrl(value) {
    check(text(value, true, 2048), "出典URLの型");
    const url = new URL(value);
    check(url.protocol === "https:" && url.hostname === "www.city.kawasaki.jp"
      && !url.port && !url.username && !url.password && !url.search && !url.hash
      && /^\/230\/cmsfiles\/contents\/[A-Za-z0-9_/-]+\.pdf$/i.test(url.pathname), "公式PDF以外の出典URL");
    return url.href;
  }

  function sourcePageUrl(value) {
    check(text(value, true, 2048), "出典ページURLの型");
    const url = new URL(value);
    check(url.protocol === "https:" && url.hostname === "www.city.kawasaki.jp"
      && !url.port && !url.username && !url.password && !url.search && !url.hash
      && /^\/230\/page\/\d+\.html$/.test(url.pathname), "公式ページ以外の出典URL");
    return url.href;
  }

  function datasetFile(value) {
    check(typeof value === "string" && FILE_PATTERN.test(value), "年度ファイル名");
    return value;
  }

  function generalAccountFile(value) {
    check(typeof value === "string" && GENERAL_ACCOUNT_FILE_PATTERN.test(value), "一般会計年度ファイル名");
    return value;
  }

  async function fetchJson(relativePath, maximumBytes) {
    check(text(relativePath, true, 2048) && Number.isSafeInteger(maximumBytes) && maximumBytes > 0, "データ取得条件");
    const url = new URL(relativePath, document.baseURI);
    check(url.origin === location.origin && ["http:", "https:"].includes(url.protocol), "同一サイト以外のデータ取得");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);
    try {
      const response = await fetch(url, { signal: controller.signal, redirect: "error", mode: "same-origin", credentials: "omit" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      check(response.headers.get("content-type")?.split(";")[0].trim() === "application/json", "JSON以外の応答");
      check(Number(response.headers.get("content-length")) <= maximumBytes, "データ容量");
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
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
      }
      return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    } finally {
      clearTimeout(timeout);
      controller.abort();
    }
  }

  function validateMetadata(value) {
    check(record(value), "資料の構造");
    check(value.type === "budget" || value.type === "settlement", "資料種別");
    check(value.typeLabel === (value.type === "budget" ? "予算" : "決算"), "資料種別の名称");
    const year = yearInfo(value.year);
    check(value.yearLabel === year.label, "年度の名称");
    sourcePdfUrl(value.sourceUrl);
    check(integer(value.recordCount, 10000) && value.recordCount > 0, "掲載件数");
    check(integer(value.activeCount, value.recordCount), "金額あり件数");
    check(integer(value.currentTotal) && amount(value.previousTotal), "合計額");
    return year;
  }

  function validateIndex(value) {
    check(record(value) && validDate(value.updatedAt), "一覧の更新日");
    check(record(value.sourcePages)
      && value.sourcePages.latest === "https://www.city.kawasaki.jp/230/page/0000075957.html"
      && value.sourcePages.archive === "https://www.city.kawasaki.jp/230/page/0000148865.html", "元ページ");
    check(Array.isArray(value.datasets) && value.datasets.length > 0 && value.datasets.length <= 200, "年度一覧の件数");
    const keys = new Set();
    const years = new Set();
    for (const dataset of value.datasets) {
      const year = validateMetadata(dataset);
      check(dataset.sortYear === year.sortYear, "年度の並び順");
      check(datasetFile(dataset.file) === `${dataset.type}/${dataset.year}.json`, "資料とファイル名の不一致");
      const key = `${dataset.type}/${dataset.year}`;
      const sortKey = `${dataset.type}/${dataset.sortYear}`;
      check(!keys.has(key) && !years.has(sortKey), "年度資料の重複");
      keys.add(key); years.add(sortKey);
    }
    check(value.datasets.some((dataset) => dataset.type === "budget")
      && value.datasets.some((dataset) => dataset.type === "settlement"), "予算・決算資料の不足");
    return value;
  }

  function validateDataset(value, manifest) {
    const year = validateMetadata(value);
    check(validDate(value.updatedAt) && value.unit === "千円", "更新日または金額単位");
    check(value.previousTotal === null ? value.previousYearLabel === null
      : validYearLabel(value.previousYearLabel, year.sortYear - 1), "前年度の名称");
    if (manifest) {
      for (const key of ["type", "typeLabel", "year", "yearLabel", "sourceUrl", "recordCount", "activeCount", "currentTotal", "previousTotal"]) {
        check(value[key] === manifest[key], "一覧と年度資料の不一致");
      }
    }
    check(Array.isArray(value.items) && value.items.length === value.recordCount, "明細の件数");
    let total = 0, previousTotal = 0, activeCount = 0;
    value.items.forEach((item, index) => {
      check(record(item) && item.order === index + 1, "明細の並び順");
      check(text(item.name, true) && text(item.number, true, 128), "明細の名称・番号");
      for (const key of ["recipient", "bureau", "category1", "category2", "category3"]) check(text(item[key]), "明細の文字情報");
      check(integer(item.current) && (value.previousTotal === null ? item.previous === null : integer(item.previous)), "明細の金額");
      check(item.years === null || integer(item.years, 1000), "継続年数");
      total += item.current;
      previousTotal += item.previous || 0;
      activeCount += item.current > 0 ? 1 : 0;
    });
    check(integer(total) && total === value.currentTotal && activeCount === value.activeCount, "当年度の集計");
    check(value.previousTotal === null || (integer(previousTotal) && previousTotal === value.previousTotal), "前年度の集計");
    return value;
  }

  function validateGeneralAccountIndex(value) {
    check(record(value) && value.type === "generalAccountIndex" && validDate(value.updatedAt), "一般会計年度一覧");
    check(Array.isArray(value.datasets) && value.datasets.length > 0 && value.datasets.length <= 50, "一般会計年度一覧の件数");
    const keys = new Set();
    let previousSortYear = 2201;
    for (const dataset of value.datasets) {
      check(record(dataset), "一般会計年度一覧の項目");
      const year = yearInfo(dataset.year);
      check(dataset.yearLabel === year.label && dataset.sortYear === year.sortYear, "一般会計年度一覧の年度");
      check(generalAccountFile(dataset.file) === `${dataset.year}.json`, "一般会計年度一覧のファイル");
      check(!keys.has(dataset.year) && year.sortYear < previousSortYear, "一般会計年度一覧の重複または順序");
      keys.add(dataset.year);
      previousSortYear = year.sortYear;
    }
    return value;
  }

  function validateTrends(value) {
    check(record(value) && validDate(value.updatedAt) && record(value.series), "年度推移の構造");
    const entries = Object.entries(value.series);
    check(entries.length > 0 && entries.length <= 20000, "年度推移の系列数");
    for (const [key, series] of entries) {
      check(!["__proto__", "constructor", "prototype"].includes(key), "予約された系列名");
      check(record(series) && text(series.name, true) && key === normalizeName(series.name), "系列の名称");
      check(Array.isArray(series.points) && series.points.length > 0 && series.points.length <= 200, "グラフの年度数");
      let previousYear = 1988;
      for (const point of series.points) {
        check(record(point) && integer(point.sortYear, 2200) && point.sortYear > previousYear, "グラフの年度順");
        for (const type of ["budget", "settlement"]) {
          check(amount(point[type]) && (point[type] === null ? point[`${type}YearLabel`] === null
            : validYearLabel(point[`${type}YearLabel`], point.sortYear)), "グラフの金額・年度");
        }
        check(point.budget !== null || point.settlement !== null, "空のグラフ年度");
        previousYear = point.sortYear;
      }
    }
    return value;
  }

  function validateGeneralAccount(value) {
    check(record(value) && value.type === "generalAccount", "一般会計データの構造");
    const year = yearInfo(value.year);
    check(value.yearLabel === year.label && validYearLabel(value.previousYearLabel, year.sortYear - 1), "一般会計の年度");
    check(value.budgetStage === "initial" && value.budgetStageLabel === "当初予算", "予算段階");
    check(value.unit === "千円" && validDate(value.updatedAt), "一般会計の単位・更新日");
    sourcePageUrl(value.sourcePageUrl);
    sourcePdfUrl(value.sourceUrl);
    check(text(value.sourcePageLabel, true, 256) && text(value.sourcePdfLabel, true, 128)
      && text(value.sourceDescription, true, 512), "一般会計の出典表示");
    check(!Object.hasOwn(value, "populationDateLabel") || text(value.populationDateLabel, true, 32), "人口基準日");
    if (Object.hasOwn(value, "subsidyYear")) yearInfo(value.subsidyYear);
    check(record(value.summary), "一般会計の概要");
    const summary = value.summary;
    for (const key of ["current", "previous", "population", "perCapitaYen", "autonomous", "dependent"]) {
      check(integer(summary[key]), `一般会計の概要 ${key}`);
    }
    check(summary.current > 0 && summary.previous > 0 && summary.population > 0
      && summary.autonomous + summary.dependent === summary.current, "一般会計の概要集計");

    const validateRows = (rows, minimumLength, maximumLength = minimumLength, resources = false) => {
      check(Array.isArray(rows) && rows.length >= minimumLength && rows.length <= maximumLength, "一般会計の明細件数");
      let current = 0;
      let previous = 0;
      rows.forEach((row, index) => {
        check(record(row) && row.order === index + 1 && text(row.name, true, 256), "一般会計の明細");
        check(integer(row.current) && integer(row.previous), "一般会計の明細金額");
        if (resources) {
          const hasSpecific = Object.hasOwn(row, "specificResources");
          const hasGeneral = Object.hasOwn(row, "generalResources");
          check((!hasSpecific && !hasGeneral) || (integer(row.specificResources) && integer(row.generalResources)
            && row.specificResources + row.generalResources === row.current), "歳出の財源内訳");
        }
        current += row.current;
        previous += row.previous;
      });
      check(integer(current) && integer(previous), "一般会計の明細集計");
      return { current, previous };
    };

    const revenue = validateRows(value.revenue, 20, 30);
    const purpose = validateRows(value.expenditurePurpose, 16, 16, true);
    check(revenue.current === summary.current && revenue.previous === summary.previous
      && purpose.current === summary.current && purpose.previous === summary.previous, "歳入・歳出の合計");

    check(Array.isArray(value.expenditureNature) && value.expenditureNature.length === 3, "性質別歳出の区分");
    let natureCurrent = 0;
    let naturePrevious = 0;
    value.expenditureNature.forEach((group, index) => {
      check(record(group) && group.order === index + 1 && text(group.name, true, 128)
        && integer(group.current) && integer(group.previous), "性質別歳出の区分内容");
      check(Array.isArray(group.items) && group.items.length > 0 && group.items.length <= 20, "性質別歳出の内訳");
      let childCurrent = 0;
      let childPrevious = 0;
      for (const item of group.items) {
        check(record(item) && text(item.name, true, 128) && integer(item.current) && integer(item.previous), "性質別歳出の内訳内容");
        childCurrent += item.current;
        childPrevious += item.previous;
      }
      check(childCurrent === group.current && childPrevious === group.previous, "性質別歳出の内訳合計");
      natureCurrent += group.current;
      naturePrevious += group.previous;
    });
    check(natureCurrent === summary.current && naturePrevious === summary.previous, "性質別歳出の合計");

    check(Array.isArray(value.perCapita) && value.perCapita.length === 13, "市民1人あたりの区分");
    let perCapitaAmount = 0;
    let perCapitaYen = 0;
    let perCapitaAmountRows = 0;
    value.perCapita.forEach((row, index) => {
      check(record(row) && row.order === index + 1 && text(row.name, true, 256)
        && integer(row.yen) && (!Object.hasOwn(row, "amount") || integer(row.amount)), "市民1人あたりの明細");
      if (Object.hasOwn(row, "amount")) {
        perCapitaAmount += row.amount;
        perCapitaAmountRows++;
      }
      perCapitaYen += row.yen;
    });
    const roundedDifference = Math.abs(perCapitaYen - summary.perCapitaYen);
    check((perCapitaAmountRows === 0 || (perCapitaAmountRows === value.perCapita.length && perCapitaAmount === summary.current))
      && (perCapitaAmountRows === 0 ? roundedDifference <= 15000 : perCapitaYen === summary.perCapitaYen), "市民1人あたりの合計");

    check(record(value.subsidyContext) && integer(value.subsidyContext.records, 10000)
      && integer(value.subsidyContext.activeRecords, value.subsidyContext.records)
      && integer(value.subsidyContext.total) && value.subsidyContext.total <= summary.current, "補助・助成金の参考値");
    return value;
  }

  return Object.freeze({
    sourcePdfUrl, sourcePageUrl, datasetFile, generalAccountFile, fetchJson,
    validateIndex, validateDataset, validateTrends, validateGeneralAccountIndex, validateGeneralAccount,
  });
})();

if (typeof module !== "undefined" && module.exports) module.exports = DataSecurity;
