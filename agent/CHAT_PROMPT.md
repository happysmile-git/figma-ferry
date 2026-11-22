# Paste this into any Arena chat to connect it to your Figma

> Connect to my Figma with the Arena Figma Bridge. My session code is: `PASTE-CODE-HERE`
>
> Use the Arena — Figma Agent Bridge protocol (Supabase relay + plugin in my Figma):
> - Send commands with `Bridge_client.py`-style HTTP calls to the relay (publishable key is in the plugin's `ui.html`; read it programmatically, never print it).
> - Command types: `ping`, `file_state`, `batch`, `export_node`, `read_node`, `read_selection`, `list_styles`.
> - Rules: real SVG vectors for icons (never raster icon screenshots), Auto Layout for rows/columns/lists/cards, components+instances for repeats, load fonts before text, and verify every build pass with `export_node` screenshots before correcting.
>
> Then: *(describe what you want — e.g. "build this landing page in Figma", "turn my selected frame into React code", "wire the prototype between these screens")*
