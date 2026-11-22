# Making the plugin live on Figma

There are two levels of “live”. Start with #1; do #2 when you want anyone in the world to install it.

## 1. Use it yourself / share privately (2 minutes, no review)

1. Download the latest release ZIP from this repo (**Releases → figma-ferry.zip**) and unzip it — or clone the repo and use the `plugin/` folder.
2. Figma **desktop app** → **Plugins → Development → Import plugin from manifest…** → select `manifest.json`.
3. Open any file → **Plugins → Development → Figma Ferry — Arena Agent Bridge**.
4. Copy the session code in the popup → paste it to your Arena agent (see `agent/CHAT_PROMPT.md`).
5. Keep the popup open while working; hit **–** to minimize it to a slim bar. Closing it disconnects.

To share with friends: send them the release ZIP (or repo access) — they repeat steps 2–5 and get
their **own** session code automatically. The default Supabase relay works out of the box; for a
private relay see [`../supabase/SUPABASE_SETUP.md`](../supabase/SUPABASE_SETUP.md).

Updating: replace the files, re-import the manifest once, reopen the plugin. Your session code persists.

## 2. Publish to the Figma Community (public listing)

1. **Prepare assets**
   - Plugin icon: 128×128 PNG.
   - Cover image: 1920×1080 PNG/JPG.
   - A short name, tagline, and description (what it does, that an Arena agent + session code is required, privacy note about the relay).
   - Support contact (email or link).
2. **Polish the code**
   - Set your production relay in `plugin/ui.html` (`DEFAULT_CONFIG`) — or keep the default. Only publishable keys, ever.
   - `manifest.json`: final `name`, `networkAccess.allowedDomains` limited to your relay domain(s).
3. **Publish**
   - Figma desktop → **Plugins → Development** → right-click the plugin → **Publish** (or via your Figma profile → Publish).
   - Fill in icon, cover, description, category (Development / Productivity), tags.
   - Submit for review. Figma reviews community plugins (API usage, network domains, UX); respond to any reviewer notes and resubmit.
4. **After approval**
   - Anyone can install from the Community page; updates are published the same way (bump, re-submit).
   - Keep `agent/AGENT.md` + the release ZIP in this repo in sync with what you published.

## Notes
- The plugin has no menus, no file writes outside the open file, and only runs while open — keep that story in your listing description.
- If you publish publicly, run the relay hardened: session TTL/cleanup scheduled (`relay-cleanup.sql`), payload sanity, and per-session rate sanity on the agent side.
