const fs = require("fs");
const path = require("path");
const vm = require("vm");

function loadPublicScriptGlobal(rootDir, relativeFile, globalName) {
  const filePath = path.join(rootDir, relativeFile);
  const source = fs.readFileSync(filePath, "utf8");
  const sandbox = {
    console,
    window: {},
    module: { exports: {} },
    exports: {}
  };
  sandbox.globalThis = sandbox;

  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: filePath });

  const moduleExports = sandbox.module?.exports;
  if (moduleExports && (typeof moduleExports !== "object" || Object.keys(moduleExports).length > 0)) {
    return moduleExports;
  }

  return sandbox.window?.[globalName] || sandbox[globalName] || {};
}

module.exports = { loadPublicScriptGlobal };
