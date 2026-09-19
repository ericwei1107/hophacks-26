// The only channel from Unity back to the page. Two signals, nothing else:
// the player is ready for frames, or it failed and the page should fall back
// to the three.js launch view.
//
// `window.__rocketHost` is registered by UnityHost.ts before the loader runs,
// so it is always present by the time Unity can call it.
mergeInto(LibraryManager.library, {
  RocketBridge_Ready: function () {
    if (typeof window !== "undefined" && window.__rocketHost) {
      window.__rocketHost.onReady();
    }
  },

  RocketBridge_Error: function (messagePtr) {
    var message = UTF8ToString(messagePtr);
    if (typeof window !== "undefined" && window.__rocketHost) {
      window.__rocketHost.onError(message);
    } else if (typeof console !== "undefined") {
      console.error("RocketBridge error before the host was registered: " + message);
    }
  },
});
