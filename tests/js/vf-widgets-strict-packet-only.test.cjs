const assert = require("node:assert/strict");
const path = require("node:path");

function loadWidgets(strict) {
  const modulePath = path.join(__dirname, "../../web/vf-ui/vf-widgets.js");
  delete require.cache[require.resolve(modulePath)];

  let intervalCalls = 0;
  let fetchCalls = 0;
  const body = {
    getAttribute(name) {
      if (name === "data-vf-runtime-strict-packet-only" && strict) return "true";
      return "";
    }
  };
  const windowObj = {
    document: { body },
    setInterval() {
      intervalCalls += 1;
      return 1;
    },
    clearInterval() {}
  };

  global.window = windowObj;
  global.document = windowObj.document;
  global.fetch = function() {
    fetchCalls += 1;
    return Promise.resolve({ ok: true, text: () => Promise.resolve("{}") });
  };
  windowObj.fetch = global.fetch;

  require(modulePath);
  return {
    widgets: windowObj.VfWidgets,
    counts() {
      return { intervalCalls, fetchCalls };
    }
  };
}

const strictRuntime = loadWidgets(true);
strictRuntime.widgets.startStatePoll();
assert.deepEqual(strictRuntime.counts(), { intervalCalls: 0, fetchCalls: 0 });

const normalRuntime = loadWidgets(false);
normalRuntime.widgets.startStatePoll();
assert.deepEqual(normalRuntime.counts(), { intervalCalls: 1, fetchCalls: 1 });

console.log("vf-widgets strict packet-only tests passed");
