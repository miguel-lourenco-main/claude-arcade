// Tiny assertion kit shared by the node logic suites (no dependencies).
// .cjs so run-tests.mjs never mistakes it for a suite.
let pass = 0, fail = 0;

exports.section = (name) => { console.log(`\n== ${name}`); };

exports.check = (cond, name) => {
  if (cond) pass++;
  else { fail++; console.error("  FAIL:", name); }
};

exports.near = (a, b, tol, name) => {
  exports.check(Math.abs(a - b) <= tol, `${name} (got ${a}, want ${b} ±${tol})`);
};

exports.done = () => {
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
};
