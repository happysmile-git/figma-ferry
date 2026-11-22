# Supabase setup — the complete relay guide

The Bridge needs exactly one thing from the outside world: a tiny message relay so an Arena
agent (in the cloud) and the plugin (in your Figma) can pass commands/results. This repo uses
**Supabase only**. Figma itself is never called through its REST API — everything executes
locally through the Figma Plugin API, so there are **no Figma rate limits** ever.

```
Arena agent ──POST command──► Supabase tables ◄──polls── Figma plugin ──► your canvas
            ◄──result/PNG────  (3 tables)      ──uploads──►
```

You have two choices:

- **A. Default relay (zero setup):** the plugin ships with a working default relay baked in.
  Install, copy your code, done. Best for trying it out.
- **B. Your own relay (recommended for ongoing use):** your project, your data, ~5 minutes.

---

## B. Your own Supabase relay, step by step

### 1. Create the project
1. [supabase.com](https://supabase.com) → sign in → **New project**.
2. Name it anything (e.g. `arena-figma-Bridge`), pick the region nearest to you, set a database password, **Create**.
3. Wait ~1 minute for provisioning. Free plan is enough (2 projects, 500 MB DB, unlimited API requests;
   note free projects pause after ~1 week of inactivity — resume from the dashboard anytime).

### 2. Create the tables
**SQL Editor → New query** → paste [`relay-setup.sql`](./relay-setup.sql) → **Run**.
It creates:

| Table | Contents |
|---|---|
| `arena_figma_commands` | command queue: `pending → running → done/error`, payload + result JSON |
| `arena_figma_events` | small activity log from the plugin |
| `arena_figma_exports` | exported PNG/JPG/SVG/PDF of frames (base64) for agent QA |

Row Level Security is enabled with policies for the `anon` role. That is safe **because** the
plugin only ever uses the publishable key (see §4) and every query is scoped by an unguessable
session UUID.

### 3. Get your URL + publishable key
**Project Settings → API** (or the **API Keys** page):
- **Project URL** — `https://<your-ref>.supabase.co`
- **Publishable key** — starts with `sb_publishable_…` (legacy `anon` JWT also works)

### 4. Point the plugin at it (two ways)
**Easy way (no code):** open the plugin in Figma → expand **“Supabase relay”** → paste URL +
publishable key → **Save relay** → close & reopen the plugin. (Stored locally in the plugin.)

**Permanent way (for sharing your own build):**
1. In `plugin/ui.html`, edit `DEFAULT_CONFIG.url` / `DEFAULT_CONFIG.key`.
2. In `plugin/manifest.json`, make sure `networkAccess.allowedDomains` includes
   `https://<your-ref>.supabase.co` (or keep `https://*.supabase.co`).
3. Re-import the manifest in Figma once (Plugins → Development → Import plugin from manifest…).

> ⚠️ **Never** put a `service_role` / `sb_secret_…` key anywhere in this plugin. Those keys
> bypass Row Level Security. The plugin UI actively rejects them. Publishable keys are
> designed to ship in client apps; RLS + the session code are the security boundary.

### 5. Verify (optional, 10 seconds)
```bash
curl -s "https://<your-ref>.supabase.co/rest/v1/arena_figma_commands?select=id&limit=1" \
  -H "apikey: sb_publishable_…" -H "Authorization: Bearer sb_publishable_…"
# → []  means: relay reachable, table exists, key valid.
```
Then open the plugin, press **Ping** in the popup, and ask your agent to `ping` back.

### 6. Tell your agent
> My Arena Bridge code is `…`. (If asked: relay is the default / in the plugin folder.)

Agents read `agent/AGENT.md` + `agent/Bridge_client.py` from this repo — they pick up the
relay URL/key from `plugin/ui.html` automatically. **Never paste keys into public issues/PRs.**

---

## Housekeeping

**Manual cleanup** (SQL Editor, anytime): [`relay-cleanup.sql`](./relay-cleanup.sql) purges
finished commands, events and exports older than a day, and un-sticks `running` rows left by a
crashed build.

**Automatic cleanup (optional):** enable `pg_cron` in **Database → Extensions**, then schedule:
```sql
select cron.schedule('arena-Bridge-cleanup', '17 3 * * *', $$
  delete from public.arena_figma_commands where status in ('done','error') and created_at < now() - interval '1 day';
  delete from public.arena_figma_events  where created_at < now() - interval '1 day';
  delete from public.arena_figma_exports where created_at < now() - interval '1 day';
$$);
```

## Limits, data, privacy
- **Stored data:** command JSON (usually a few KB–150 KB), results, activity events, and
  base64 exports (~50–500 KB each) only when the agent requests a visual export. Housekeeping keeps it near zero.
- **Load:** idle ≈ one tiny request every ~4 s; working = short bursts. Trivial against free-tier API limits;
  the resource to watch is egress if you export thousands of frames.
- **Who can command your file:** anyone holding your session code, only while your popup is open.
  Treat the code like a password; **New code** in the popup rotates it; closing the popup revokes access.
- **Paused project:** if the relay was idle a week+, open the Supabase dashboard once and resume it.

## Troubleshooting
| Symptom | Fix |
|---|---|
| Popup shows **relay error** | Wrong URL/key, or your domain missing from `manifest.json` → edit + re-import manifest |
| Agent: commands stay **pending** | Popup closed, or wrong code — re-copy from popup |
| HTTP **401** | You're using a secret key — switch to publishable |
| HTTP **404** | Tables missing — run `relay-setup.sql` |
| Commands stuck **running** | Run the “un-stick” statement in `relay-cleanup.sql`, retry |
| Project paused | Supabase dashboard → **Resume project** |

## Remove everything
```sql
drop table if exists public.arena_figma_exports;
drop table if exists public.arena_figma_events;
drop table if exists public.arena_figma_commands;
```
Then remove the plugin in Figma (Plugins → Development → manager) and delete the folder.
