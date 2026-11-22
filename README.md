# Arena ↔ Figma Agent Bridge

> Let any **Arena AI agent** work inside your Figma file — building **production-ready frames**,
> real **vector icons & components**, **Auto Layout**, **prototypes**, and turning designs back
> into **production code**. No Figma REST API, so **no Figma rate limits**.

[![Release](https://img.shields.io/badge/release-v2.1.0-blue)](#-download)
[![Relay](https://img.shields.io/badge/relay-Supabase-3ECF8E)](supabase/SUPABASE_SETUP.md)
[![License](https://img.shields.io/badge/license-MIT-green)](LICENSE)

## How it works

```
┌─────────────┐   commands (JSON)   ┌───────────────┐   polls    ┌──────────────┐
│ Arena agent │ ──────────────────► │   Supabase    │ ◄───────── │ Figma plugin │
│  (any chat) │ ◄────────────────── │  relay tables │ ─────────► │ (this repo)  │
└─────────────┘   results + exports └───────────────┘  executes  └──────┬───────┘
                                                               Plugin API ▼
                                                                 your canvas
```

A Figma plugin cannot receive inbound connections, so both sides meet at a tiny Supabase relay
(3 tables). The plugin executes everything **locally** with the Figma Plugin API — creating,
editing, exporting and prototyping never touch Figma's rate-limited REST API.

## ⬇️ Download

Go to **[Releases](../../releases)** and download **`arena-figma-Bridge.zip`** — it contains the
ready-to-import plugin plus the agent tools and guides. Or clone this repo and use `plugin/`.

## 🚀 Quick start (2 minutes)

1. Unzip the release; in Figma desktop: **Plugins → Development → Import plugin from manifest…** → `manifest.json`.
2. Run **Arena — Figma Agent Bridge** in any file. The popup shows your **session code**.
3. Paste the code to your Arena agent: *“Connect with code `…` and build a login screen.”*
   (Ready-made message: [`agent/CHAT_PROMPT.md`](agent/CHAT_PROMPT.md))
4. Keep the popup open while the agent works — use the popup's **–** button to shrink it to a
   slim status bar. Closing it disconnects instantly.

Your code persists across files and launches. Anyone can use this: each install gets its own code.

## ✨ What the agent can do through it

- **Design:** pages, frames, shapes, sections, text (fonts, ranges, truncation), images, booleans, groups, deep canvas reads
- **Icons/SVG:** import real SVG markup as **native Figma vectors** and component libraries (e.g. Lucide) — never raster icon hacks
- **Systems:** components, instances, detach/swap, variants, paint/text/effect styles, variable collections with modes
- **Layout:** full **Auto Layout** (direction, gap, padding, alignment, sizing, wrap) mirroring production flexbox
- **Prototyping:** reactions (navigate / overlay / smart-animate…) and flow starting points
- **Design → code:** deep node specs (`read_node`) + tokens (`list_styles`) → React component and `tokens.css` via `agent/figma_to_code.py`
- **Exports:** PNG / JPG / SVG / PDF of any node for visual QA

## 🗄️ Supabase (your relay)

- **Default relay works out of the box** — zero setup to try it.
- **Bring your own in ~5 minutes:** full step-by-step (project, SQL, keys, plugin config,
  verification, cleanup, troubleshooting) → [`supabase/SUPABASE_SETUP.md`](supabase/SUPABASE_SETUP.md)
- One-shot SQL: [`supabase/relay-setup.sql`](supabase/relay-setup.sql) · housekeeping: [`supabase/relay-cleanup.sql`](supabase/relay-cleanup.sql)
- Only **publishable** keys are used, ever. Secret keys are rejected by the plugin UI.

## 📁 Repo map

| Path | What |
|---|---|
| `plugin/` | Figma plugin (`manifest.json`, `code.js`, `ui.html`) — import `plugin/manifest.json` |
| `agent/` | `Bridge_client.py` (universal sender), `figma_to_code.py` (design→React+tokens), `AGENT.md` (protocol any agent follows), `CHAT_PROMPT.md` (copy-paste connect message) |
| `supabase/` | `SUPABASE_SETUP.md`, `relay-setup.sql`, `relay-cleanup.sql` |
| `docs/` | [`FIGMA_PUBLISHING.md`](docs/FIGMA_PUBLISHING.md) — private use + Figma Community publishing steps |

## 🔒 Security

- Access = your unguessable session code, only while your popup is open. Treat it like a password.
- **New code** button rotates it; closing the popup revokes access instantly.
- The relay stores transient commands/results/exports; run cleanup SQL (or schedule it) to purge daily.
- Never commit a Supabase secret key or a GitHub token to this repo — only publishable keys belong in client code.

## 📣 Make it live on Figma

Private/dev use and full **Figma Community publishing** steps: [`docs/FIGMA_PUBLISHING.md`](docs/FIGMA_PUBLISHING.md).

## License

MIT — see [LICENSE](LICENSE).
