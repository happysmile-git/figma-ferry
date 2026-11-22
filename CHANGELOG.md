# Changelog

## v2.1.0
- New compact plugin UI: status + session card, dropdowns for **How to connect**, **Supabase relay**
  (custom relay in-popup, secret-key rejection), **capabilities**, and an **activity log**.
- **Minimize mode**: the `–` button shrinks the popup to a slim connected/working bar; `+` expands.
- Repo restructure: `plugin/`, `agent/`, `supabase/`, `docs/`; GitHub release ZIP for one-click download.
- Complete Supabase documentation + cleanup SQL + Figma Community publishing guide.

## v2.0.0
- Full Plugin API executor: deep reads (`read_node`/`read_selection`), `list_styles` tokens,
  `createSvg`/`createSvgComponent` (native vectors + icon component libraries), components/instances/
  variants/booleans/groups, variables & styles creation, Auto Layout everywhere, PNG/JPG/SVG/PDF exports.
- Agent tools: `Bridge_client.py` (env-based session/relay), `figma_to_code.py` (design → React + tokens.css).

## v1.x
- Initial Bridge: session-code popup, Supabase command queue, batch create/set/append/remove,
  `createImage`, reactions, PNG exports.
