import { initBotId } from "botid/client/core";

// Routes that must carry a BotID challenge. Requests to these without a valid client
// challenge (curl, headless scripts, replayed requests) are rejected server-side in production.
initBotId({
  protect: [
    { path: "/api/waitlist", method: "POST" },
    { path: "/api/demo", method: "POST" },
  ],
});
