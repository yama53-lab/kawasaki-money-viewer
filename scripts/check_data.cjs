const fs = require("node:fs");
const path = require("node:path");
const security = require("../js/data-validation.js");
const root = path.resolve(__dirname, "..");
const read = (file, limit) => {
  const full = path.join(root, file);
  if (fs.realpathSync(full) !== full || !fs.statSync(full).isFile() || fs.statSync(full).size > limit) throw new Error("Invalid or oversized data file");
  return JSON.parse(fs.readFileSync(full, "utf8"));
};
const index = security.validateIndex(read("data/index.json", 1024 * 1024));
let records = 0;
for (const manifest of index.datasets) {
  const dataset = security.validateDataset(read(`data/${security.datasetFile(manifest.file)}`, 8 * 1024 * 1024), manifest);
  records += dataset.recordCount;
}
const trends = security.validateTrends(read("data/trends.json", 16 * 1024 * 1024));
console.log(`Validated ${index.datasets.length} datasets, ${records} records and ${Object.keys(trends.series).length} trend series.`);
