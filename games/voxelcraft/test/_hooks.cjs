// Node-side test shim: the game's ES modules import Three.js by its bare
// import-map name ("three"), which only the browser can resolve. Logic tests
// only touch pure modules whose THREE use is inside functions they never
// call, so an empty namespace is enough. Import this file FIRST, then load
// game modules with a dynamic import() (static imports resolve before any
// hook registers).
const { registerHooks } = require("node:module");
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "three") {
      return { url: "data:text/javascript,export const REVISION='stub';", shortCircuit: true };
    }
    return next(specifier, context);
  },
});
