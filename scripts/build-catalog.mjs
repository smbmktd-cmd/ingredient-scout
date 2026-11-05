import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildCatalog, loadRaw, serializeCatalog } from "./lib/catalog.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const catalog = buildCatalog(loadRaw(root));
const files = serializeCatalog(catalog);
const docs = path.join(root, "docs");
fs.writeFileSync(path.join(docs, "catalog.json"), files.json);
fs.writeFileSync(path.join(docs, "catalog.js"), files.js);
console.log(
  "catalog updated:",
  catalog.ingredients.length,
  "ingredients,",
  catalog.days.length,
  "days"
);
