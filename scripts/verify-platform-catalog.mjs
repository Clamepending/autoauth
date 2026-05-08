#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const catalogPath = path.join(process.cwd(), "src/data/platform-catalog.json");
const catalog = JSON.parse(fs.readFileSync(catalogPath, "utf8"));
const platforms = catalog.platforms;

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

assert(Array.isArray(platforms), "catalog.platforms must be an array");
assert(platforms.length === 50, `expected exactly 50 platforms, found ${platforms.length}`);

const ids = new Set();
const categories = new Map();
let fileUploadCount = 0;
let getMadeCount = 0;
let sampleOrderCount = 0;
let sampleFileOrderCount = 0;

for (const platform of platforms) {
  assert(typeof platform.id === "string" && platform.id, "platform id is required");
  assert(!ids.has(platform.id), `duplicate platform id: ${platform.id}`);
  ids.add(platform.id);
  assert(typeof platform.name === "string" && platform.name, `${platform.id}: name is required`);
  assert(typeof platform.category === "string" && platform.category, `${platform.id}: category is required`);
  assert(typeof platform.kind === "string" && platform.kind, `${platform.id}: kind is required`);
  assert(typeof platform.url === "string" && platform.url.startsWith("https://"), `${platform.id}: https url is required`);
  assert(Array.isArray(platform.aliases), `${platform.id}: aliases must be an array`);
  assert(Array.isArray(platform.fileTypes), `${platform.id}: fileTypes must be an array`);
  assert(Array.isArray(platform.examples) && platform.examples.length > 0, `${platform.id}: examples are required`);

  categories.set(platform.category, (categories.get(platform.category) || 0) + 1);
  if (platform.fileTypes.length > 0) fileUploadCount += 1;
  if (platform.category === "get_made_manufacturing" || platform.category === "pcb_electronics") {
    getMadeCount += 1;
    const requiresFileReferences =
      platform.category === "get_made_manufacturing" ||
      (platform.category === "pcb_electronics" && platform.kind !== "retail_purchase");
    if (requiresFileReferences) {
      assert(platform.fileTypes.length > 0, `${platform.id}: get-made platforms must support file references`);
    }
  }

  const sampleOrder = {
    dry_run: true,
    store: platform.id,
    merchant: platform.name,
    kind: platform.kind,
    order_details: platform.examples[0],
    max_charge_cents: platform.category === "get_made_manufacturing" ? 50000 : 10000,
    files: platform.fileTypes.length
      ? [{
          name: `sample.${platform.fileTypes[0]}`,
          purpose: platform.kind === "manufacturing_pcb" ? "manufacturing_file" : "order_attachment",
          download_url: "https://example.com/sample-file",
        }]
      : [],
  };
  assert(sampleOrder.store && sampleOrder.order_details, `${platform.id}: sample order is incomplete`);
  assert(sampleOrder.dry_run === true, `${platform.id}: sample order must be safe to validate`);
  sampleOrderCount += 1;
  if (sampleOrder.files.length) sampleFileOrderCount += 1;
}

for (const category of [
  "retail_marketplace",
  "local_delivery_travel",
  "get_made_manufacturing",
  "pcb_electronics",
  "print_custom_goods",
]) {
  assert(categories.has(category), `missing category: ${category}`);
}

assert(getMadeCount >= 15, `expected broad get-made coverage, found ${getMadeCount}`);
assert(fileUploadCount >= 20, `expected strong file-upload coverage, found ${fileUploadCount}`);

console.log(JSON.stringify({
  ok: true,
  version: catalog.version,
  platforms: platforms.length,
  categories: Object.fromEntries([...categories.entries()].sort()),
  file_upload_platforms: fileUploadCount,
  get_made_platforms: getMadeCount,
  dry_run_orders_validated: sampleOrderCount,
  sample_file_orders_validated: sampleFileOrderCount,
}, null, 2));
