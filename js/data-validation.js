/* Shared by the browser and the pre-publication checks. */
const DataSecurity = (() => {
  const MAX_AMOUNT = Math.floor(Number.MAX_SAFE_INTEGER / 1000);
  const FILE_PATTERN = /^(budget|settlement)\/[RH][1-9]\d{0,2}\.json$/;
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

  function datasetFile(value) {
    check(typeof value === "string" && FILE_PATTERN.test(value), "年度ファイル名");
    return value;
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

  return Object.freeze({ sourcePdfUrl, datasetFile, validateIndex, validateDataset, validateTrends });
})();

if (typeof module !== "undefined" && module.exports) module.exports = DataSecurity;
