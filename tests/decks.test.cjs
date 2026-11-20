const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const ts = require("typescript");

// Load the TypeScript helpers without adding a test-runner dependency.
function loadModule(name) {
  const filename = path.join(__dirname, "..", `${name}.ts`);
  const source = ts.transpileModule(readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const module = { exports: {} };
  const resolve = (id) => id.startsWith("@/") ? loadModule(id.slice(2)) : require(id);
  new Function("require", "module", "exports", source)(resolve, module, module.exports);
  return module.exports;
}

const { DECKS } = loadModule("lib/types");
const { alignmentForVotes, averageForVotes, mostCommonSizes } = loadModule("lib/voting");
const { createTableRecord } = loadModule("lib/store");

test("both decks contain the expected cards", () => {
  assert.deepEqual(DECKS.fibonacci.values, [1, 2, 3, 5, 8, 13, 21]);
  assert.equal(DECKS["t-shirt-sizes"].name, "T-shirt Sizes");
  assert.deepEqual(DECKS["t-shirt-sizes"].values, ["XS", "S", "M", "L", "XL", "XXL"]);
});

test("table creation defaults to Fibonacci and preserves the selected deck", () => {
  const options = { tableName: "Test", creatorName: "Dealer", mode: "participant" };
  assert.equal(createTableRecord(options).deck, "fibonacci");
  assert.equal(createTableRecord({ ...options, deck: "t-shirt-sizes" }).deck, "t-shirt-sizes");
});

test("Fibonacci averages and alignment remain numeric", () => {
  assert.equal(averageForVotes({ a: 3, b: 5, c: 13 }), 7);
  assert.equal(alignmentForVotes({ a: 3, b: 3, c: 5 }), 67);
});

test("T-shirt alignment uses matching sizes, not numeric arithmetic", () => {
  assert.equal(alignmentForVotes({ a: "M", b: "M", c: "XL" }), 67);
  assert.equal(mostCommonSizes({ a: "M", b: "M", c: "XL" }), "M");
  assert.equal(averageForVotes({ a: "M", b: "XL" }), 0);
});

test("tied sizes are returned in deck order", () => {
  assert.equal(mostCommonSizes({ a: "XXL", b: "S", c: "M" }), "S / M / XXL");
});

test("empty votes have no alignment, average, or most common size", () => {
  assert.equal(alignmentForVotes({}), 0);
  assert.equal(averageForVotes({}), 0);
  assert.equal(mostCommonSizes({}), "—");
});
