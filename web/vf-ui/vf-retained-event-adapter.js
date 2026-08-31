(function (root, factory) {
  "use strict";
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) {
    root.VfRetainedEventAdapter = api.createInternalRetainedEventAdapter({
      contract: root.VfRuntimePacketContract,
      fetchProgram: function () {
        return root.fetch(new root.URL("vf-event-program.json", root.document.baseURI).href, {
          cache: "no-store"
        }).then(function (response) {
          if (!response.ok) throw new Error("compiled retained event program could not be loaded");
          return response.json();
        });
      },
      applyRuntimePacket: function (packet) {
        if (!root.VfRuntimeShell || typeof root.VfRuntimeShell.applyRuntimePacket !== "function") {
          throw new Error("retained event runtime shell is unavailable");
        }
        root.VfRuntimeShell.applyRuntimePacket(packet);
      }
    });
  }
})(typeof window !== "undefined" ? window : null, function () {
  "use strict";

  function createInternalRetainedEventAdapter(options) {
    if (!options || !options.contract ||
        typeof options.contract.createInternalRetainedEventProgramExecution !== "function" ||
        typeof options.fetchProgram !== "function" ||
        typeof options.applyRuntimePacket !== "function") {
      throw new TypeError("internal retained event adapter dependencies are malformed");
    }
    var executionPromise = null;
    function execution() {
      if (!executionPromise) {
        executionPromise = Promise.resolve().then(options.fetchProgram).then(function (program) {
          return options.contract.createInternalRetainedEventProgramExecution(program);
        });
      }
      return executionPromise;
    }
    return Object.freeze({
      dispatch: function (event) {
        return execution().then(function (runner) {
          var packet = runner.dispatch(event);
          if (packet === null) return false;
          options.applyRuntimePacket(packet);
          return true;
        });
      }
    });
  }

  return { createInternalRetainedEventAdapter: createInternalRetainedEventAdapter };
});
