(function () {
  const SUPABASE_ANALYTICS_URL = "https://kndpvdixtlirwgsqvgjh.supabase.co/functions/v1/track-app-usage";
  const APP_KEY = "vicaf";
  const USER_KEY = "vicaf_usage_user_id";
  const SESSION_KEY = "vicaf_usage_session_id";
  const SESSION_STARTED_KEY = "vicaf_usage_session_started";

  function randomId(prefix) {
    if (crypto.randomUUID) return `${prefix}_${crypto.randomUUID()}`;
    return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  }

  function storedId(storage, key, prefix) {
    const existing = storage.getItem(key);
    if (existing) return existing;
    const next = randomId(prefix);
    storage.setItem(key, next);
    return next;
  }

  const anonymousUserId = storedId(window.localStorage, USER_KEY, "visitor");
  const sessionId = storedId(window.sessionStorage, SESSION_KEY, "session");

  function send(payload) {
    const body = JSON.stringify({
      app_key: APP_KEY,
      anonymous_user_id: anonymousUserId,
      session_id: sessionId,
      path: window.location.pathname,
      occurred_at: new Date().toISOString(),
      ...payload,
    });

    if (navigator.sendBeacon) {
      navigator.sendBeacon(SUPABASE_ANALYTICS_URL, new Blob([body], { type: "application/json" }));
      return;
    }

    fetch(SUPABASE_ANALYTICS_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: true,
    }).catch(() => {});
  }

  window.vicafUsage = {
    sessionStart(module) {
      if (window.sessionStorage.getItem(SESSION_STARTED_KEY)) return;
      window.sessionStorage.setItem(SESSION_STARTED_KEY, "true");
      send({ event_name: "session_start", module: module || "app" });
    },
    moduleView(module) {
      send({ event_name: "module_view", module });
    },
    action(module, action, metadata) {
      send({
        event_name: "action",
        module,
        metadata: { ...(metadata || {}), action },
      });
    },
    recordCreate(module, entity) {
      send({ event_name: "record_create", module, metadata: { entity } });
    },
    recordUpdate(module, entity) {
      send({ event_name: "record_update", module, metadata: { entity } });
    },
    fileExport(module, label) {
      send({ event_name: "file_export", module, metadata: { label } });
    },
    search(module, source) {
      send({ event_name: "search", module, metadata: { source } });
    },
  };
})();
