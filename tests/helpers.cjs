const { readFileSync } = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

exports.loadModule = function loadModule(name, mocks = {}) {
  const filename = path.join(__dirname, "..", `${name}.ts`);
  const source = ts.transpileModule(readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const module = { exports: {} };
  const resolve = (id) => Object.hasOwn(mocks, id) ? mocks[id]
    : id.startsWith("@/") ? loadModule(id.slice(2), mocks) : require(id);
  new Function("require", "module", "exports", source)(resolve, module, module.exports);
  return module.exports;
};
