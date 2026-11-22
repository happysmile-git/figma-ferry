# AGENT.md — how any Arena agent drives Figma through this Bridge (v2)

You are an Arena AI agent. The user has the **Arena — Figma Agent Bridge** plugin open in Figma.
They will give you a **session code** (UUID shown in the plugin popup). With it you can do
essentially everything in their Figma file — create production-ready frames, real vector icons,
components/variants, Auto Layout, variables/styles, prototyping (reactions + flows), exports —
and read the canvas back to generate production code. No Figma REST API, so no Figma rate limits;
execution happens locally via the Figma Plugin API.

## Connect (any chat, zero setup)
1. Get the session code from the user. If they haven't opened the plugin, tell them:
   Figma → Plugins → Development → *Arena — Figma Agent Bridge*, then read the code in the popup.
2. Use `Bridge_client.py` in this folder (Python 3, stdlib only):
   ```bash
   python3 Bridge_client.py --session <CODE> --type ping
   ```
   It reads the relay URL + publishable key from `ui.html` automatically (or env
   `ARENA_FIGMA_RELAY_URL` / `ARENA_FIGMA_RELAY_KEY`; session via `ARENA_FIGMA_SESSION`).
3. Keep batches verified: create → `export_node` → look → correct. Never one giant blind build.
4. If commands stay `pending`, the popup is closed or on another file — ask the user to check it
   shows "connected".

## Command types
| type | payload | result |
|---|---|---|
| `ping` | `{}` | `{ ok, version, file, state }` |
| `file_state` | `{}` | pages + top-level children + selection |
| `batch` | `{ ops: [...] }` | per-op results + `refs` (ref → node info with real IDs) |
| `export_node` | `{ id\|name\|node, scale, format: PNG\|JPG\|SVG\|PDF }` | file stored in relay; client `--save file` downloads it |
| `read_node` | `{ id\|name\|node, depth, maxNodes }` | deep serialized tree (geometry, fills, strokes, text+segments, layout, vectors, reactions) |
| `read_selection` | `{ depth, maxNodes }` | same, for current selection |
| `list_styles` | `{}` | variable collections+values, paint/text/effect styles (design tokens) |
| `cleanup_bad_frames` | `{ names: [...] }` | deletes those top-level frames |

## Batch ops
Create/structure:
- `loadFonts {fonts:[{family, style|weight}]}` — always before creating text.
- `create {nodeType: FRAME|RECTANGLE|ELLIPSE|LINE|STAR|POLYGON|SECTION|TEXT|COMPONENT|INSTANCE|VECTOR, ref, name, parent, index, props}` (`INSTANCE` needs `component: <ref|id>`)
- `createSvg {svg, name, ref, parent, props:{x,y,width,height}}` — imports real SVG markup as **native vectors** (frames of VECTOR paths). This is how icons/logos must be added — never screenshot/PNG icons.
- `createSvgComponent {svg, ...}` — same, converted to a COMPONENT (build icon libraries with this, then `create INSTANCE`s).
- `createImage {imageBase64, ref, name, parent, props}` — photos/bitmaps only (QR codes, hero renders).
- `createPage {name, ref}`, `setCurrentPage {page}`, `set {node, props}`, `append/insert {child, parent, index}`,
  `clone {node, newRef, props}`, `remove {node}`, `group {nodes, parent, name}`, `ungroup {node}`,
  `componentFromNode {node}`, `combineAsVariants {nodes, parent}`, `boolean {mode: union|subtract|intersect|exclude, nodes, parent}`,
  `detach {node}`, `swapComponent {node, component}`, `setRange {node, start, end, props:{font,fontSize,fill}}`,
  `select {nodes}`, `zoom {node}`, `info {node, depth}` (shallow tree), `read {node, depth, maxNodes}` (deep spec),
  `find {node?, nodeType?, name?, limit?}`, `notify {message}`.

Prototype:
- `setReactions {node, reactions:[...]}` — Figma Reaction objects (ON_CLICK → NAVIGATE/OVERLAY/etc., with smart-animate transitions).
- `setFlow {page?, node, name?}` — set the prototype flow starting point.

Styles & variables:
- `createPaintStyle {name, fill}`, `createTextStyle {name, font, fontSize, lineHeight}`, `createEffectStyle {name, effects}`,
  `createVariableCollection {name, modes}`, `createVariable {collection, name, valueType: COLOR|FLOAT|STRING|BOOLEAN, value}`.
  Apply styles via `set` props `fillStyleId` / `textStyleId` / `effectStyleId`.

## Props cheatsheet (create/set)
`x, y, width, height` (child x/y are **local to parent**), `fill`/`fills` / `stroke`/`strokes`
(hex or `rgb()/rgba()`, or raw Figma paint objects for gradients/images), `strokeWeight`,
`cornerRadius` (or per-corner `topLeftRadius`...), `opacity`, `blendMode`, `visible`, `locked`,
`effects: [{type:"DROP_SHADOW", radius, y, alpha, color}]`, `constraints:{horizontal, vertical}`,
Auto Layout: `layoutMode: NONE|HORIZONTAL|VERTICAL`, `itemSpacing`, `counterAxisSpacing`,
`paddingTop/Right/Bottom/Left`, `primaryAxisAlignItems`, `counterAxisAlignItems`,
`primaryAxisSizingMode`, `counterAxisSizingMode`, `layoutWrap`; on children:
`layoutSizingHorizontal/Vertical: FIXED|HUG|FILL`, `layoutPositioning: AUTO|ABSOLUTE`.
TEXT: `font:{family, style|weight}`, `fontSize`, `characters`, `lineHeight` (px number),
`letterSpacing` (px), `textAlignHorizontal/Vertical`, `textAutoResize` (`HEIGHT` wraps;
`WIDTH_AND_HEIGHT` single-line hug; `NONE`+`textTruncation:"ENDING"`+`maxLines:1` truncates),
`fillStyleId`, `textStyleId`.

## Production rules (do not break these)
1. **Icons are vectors.** Icons/logos come from real SVG (e.g. the Lucide set production uses, or
   brand SVG files) via `createSvg`/`createSvgComponent`. Raster icon screenshots are forbidden.
   Bitmaps are only for true bitmaps (photos, QR codes).
2. **Layout is Auto Layout.** Anything that is a row/column/list/card/toolbar in the product gets
   a real Auto Layout frame mirroring the product's flex direction, gap and padding. Absolute
   positioning only for freeform canvases (mock papers, scattered art, overlays) — and overlays
   sit in their own frames.
3. **Components for repeats.** Repeated UI (buttons, rows, icon glyphs) = components + instances,
   variants via `combineAsVariants` where the product has states.
4. **Verify visually.** After each pass: `export_node` PNG, compare against source of truth,
   correct with `set`. Check wrapping/alignment at 1× crops, not thumbnails.
5. **Preload fonts** (`loadFonts`) before any text op, including every style you use
   ("Semi Bold" not "SemiBold").
6. Small verified batches; keep `ref`s stable in a batch; across batches use real node IDs.
7. Prototyping: wire real reactions + `setFlow`, name frames meaningfully (screens/states).

## Design → code
```bash
python3 Bridge_client.py --session <CODE> --type read_node --payload '{"id":"<frame id>"}' --out spec.json
python3 figma_to_code.py spec.json --out Screen.jsx --name Screen
python3 Bridge_client.py --session <CODE> --type list_styles --out styles.json
python3 figma_to_code.py styles.json --styles --out tokens.css
```
The generator emits a React component mirroring the tree (Auto Layout → flex, absolute →
positioned, vectors → inline SVG, instances → component placeholders to swap for real ones).
Treat it as a faithful skeleton: replace placeholders, hook data/handlers, then it's shippable.

## Code → design
Read the product's DOM/CSS (computed geometry, flex, colors, fonts), then rebuild with the same
structure: Auto Layout frames from flex containers, text with measured size/weight/line-height,
SVG components for icons, instances for repeats. Export and pixel-compare, iterate.

## Security notes
- The relay key is a Supabase *publishable* key (safe for clients). Teams can run their own relay
  (`relay-setup.sql` + custom relay fields in the popup).
- Access is scoped by the unguessable session UUID; closing the popup revokes access instantly.
