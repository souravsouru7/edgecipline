#!/usr/bin/env node

require("dotenv").config();

const mongoose = require("mongoose");

const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI;
const fixKnown = process.argv.includes("--fix-known");
const limitArg = process.argv.find((arg) => arg.startsWith("--limit="));
const limit = limitArg ? Number(limitArg.split("=")[1]) : 0;

const s = (...codes) => String.fromCharCode(...codes);

const blockedPatterns = [
  new RegExp(s(0x00e2), "g"),
  new RegExp(s(0x00c3), "g"),
  new RegExp(s(0x00ef, 0x00bf, 0x00bd), "g"),
  /\uFFFD/g,
  new RegExp(s(0x00f0, 0x0178), "g"),
  new RegExp(s(0x00e2, 0x2020), "g"),
  new RegExp(s(0x00e2, 0x0153), "g"),
  new RegExp(s(0x00e2, 0x201d), "g")
];

const knownFixes = [
  [s(0x00e2, 0x20ac, 0x201d), "-"],
  [s(0x00e2, 0x20ac, 0x201c), "-"],
  [s(0x00e2, 0x2020, 0x2019), "->"],
  [s(0x00e2, 0x0153, 0x201c), "OK"],
  [s(0x00e2, 0x20ac, 0x00a6), "..."],
  [s(0x00c2, 0x00b7), "*"],
  [s(0x00e2, 0x20ac, 0x0153), "\""],
  [s(0x00e2, 0x20ac, 0x009d), "\""],
  [s(0x00e2, 0x20ac, 0x02dc), "'"],
  [s(0x00e2, 0x20ac, 0x2122), "'"],
  [s(0x00e2, 0x201d, 0x20ac), "-"]
];

function hasMojibake(value) {
  return blockedPatterns.some((pattern) => {
    pattern.lastIndex = 0;
    return pattern.test(value);
  });
}

function repair(value) {
  let next = value;
  for (const [from, to] of knownFixes) {
    next = next.split(from).join(to);
  }
  return next;
}

function walk(value, prefix = "", findings = [], updates = {}) {
  if (typeof value === "string") {
    if (hasMojibake(value)) {
      findings.push(prefix || "<root>");
      const repaired = repair(value);
      if (fixKnown && repaired !== value && prefix) {
        updates[prefix] = repaired;
      }
    }
    return { findings, updates };
  }

  if (!value || typeof value !== "object") {
    return { findings, updates };
  }

  if (value instanceof Date || value instanceof mongoose.Types.ObjectId) {
    return { findings, updates };
  }

  if (Array.isArray(value)) {
    value.forEach((item, index) => walk(item, `${prefix}.${index}`.replace(/^\./, ""), findings, updates));
    return { findings, updates };
  }

  for (const [key, child] of Object.entries(value)) {
    if (key === "_id" || key === "__v") continue;
    walk(child, `${prefix}.${key}`.replace(/^\./, ""), findings, updates);
  }

  return { findings, updates };
}

async function main() {
  if (!mongoUri) {
    console.error("Missing MONGO_URI or MONGODB_URI.");
    process.exit(1);
  }

  await mongoose.connect(mongoUri);
  const collections = await mongoose.connection.db.listCollections().toArray();
  const affected = [];

  for (const collectionInfo of collections) {
    const collection = mongoose.connection.db.collection(collectionInfo.name);
    const cursor = collection.find({}, { projection: {} });
    if (limit > 0) cursor.limit(limit);

    while (await cursor.hasNext()) {
      const doc = await cursor.next();
      const { findings, updates } = walk(doc);
      if (!findings.length) continue;

      affected.push({
        collection: collectionInfo.name,
        id: String(doc._id),
        fields: findings
      });

      if (fixKnown && Object.keys(updates).length) {
        await collection.updateOne({ _id: doc._id }, { $set: updates });
      }
    }
  }

  if (!affected.length) {
    console.log("No database mojibake records found.");
    await mongoose.disconnect();
    return;
  }

  console.log(JSON.stringify({ fixed: fixKnown, affected }, null, 2));
  await mongoose.disconnect();
  process.exit(fixKnown ? 0 : 2);
}

main().catch(async (error) => {
  console.error(error.message);
  await mongoose.disconnect();
  process.exit(1);
});
