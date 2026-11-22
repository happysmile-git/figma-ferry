// ============================================================
// Figma Ferry — Arena Agent Bridge (main thread)
// Universal agent Bridge: receives commands from ui.html (which
// polls a Supabase relay), executes them with the Figma Plugin
// API locally in this file, and returns results/exports.
// No Figma REST API is used, so there are no Figma rate limits.
// The plugin intentionally stays open while you work.
// ============================================================

figma.showUI(__html__, { width: 340, height: 308, themeColors: true });

function uuidv4() {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
let SESSION_ID = null;
async function getSessionId() {
  if (SESSION_ID) return SESSION_ID;
  try {
    SESSION_ID = await figma.clientStorage.getAsync("arena-Bridge-session");
    if (!SESSION_ID) {
      SESSION_ID = uuidv4();
      await figma.clientStorage.setAsync("arena-Bridge-session", SESSION_ID);
    }
  } catch (e) {
    SESSION_ID = uuidv4();
  }
  return SESSION_ID;
}

const FONT_CACHE = new Map();
const INTER_FALLBACK = { family: "Inter", style: "Regular" };

function parseColor(value) {
  if (!value) return null;
  if (typeof value === "object" && "r" in value && "g" in value && "b" in value) {
    return { r: value.r, g: value.g, b: value.b, a: value.a == null ? 1 : value.a };
  }
  const s = String(value).trim();
  if (s[0] === "#") {
    const h = s.slice(1);
    if (h.length === 3) return { r: parseInt(h[0] + h[0], 16) / 255, g: parseInt(h[1] + h[1], 16) / 255, b: parseInt(h[2] + h[2], 16) / 255, a: 1 };
    if (h.length === 6) return { r: parseInt(h.slice(0, 2), 16) / 255, g: parseInt(h.slice(2, 4), 16) / 255, b: parseInt(h.slice(4, 6), 16) / 255, a: 1 };
    if (h.length === 8) return { r: parseInt(h.slice(0, 2), 16) / 255, g: parseInt(h.slice(2, 4), 16) / 255, b: parseInt(h.slice(4, 6), 16) / 255, a: parseInt(h.slice(6, 8), 16) / 255 };
  }
  const p = s.match(/[\d.]+/g);
  if (p && p.length >= 3) return { r: Number(p[0]) / 255, g: Number(p[1]) / 255, b: Number(p[2]) / 255, a: p.length > 3 ? Number(p[3]) : 1 };
  return null;
}
function solidPaint(value, opacity) {
  const c = parseColor(value) || { r: 0, g: 0, b: 0, a: 1 };
  return [{ type: "SOLID", color: { r: c.r, g: c.g, b: c.b }, opacity: opacity == null ? c.a : opacity, visible: true, blendMode: "NORMAL" }];
}
function paintsFrom(spec) {
  if (spec == null) return [];
  if (typeof spec === "string" || (typeof spec === "object" && ("r" in spec || "color" in spec))) {
    return solidPaint(spec.color || spec, spec.opacity);
  }
  if (Array.isArray(spec)) {
    const out = [];
    for (const item of spec) {
      if (!item) continue;
      if (typeof item === "string") out.push(...solidPaint(item));
      else if (item.type === "SOLID" || item.color) out.push(...solidPaint(item.color, item.opacity));
      else if (item.type) out.push(item); // raw Figma paint (gradients/images) passed through
    }
    return out;
  }
  return [];
}
async function loadFont(fontName) {
  const key = fontName.family + "|" + fontName.style;
  if (FONT_CACHE.has(key)) return FONT_CACHE.get(key);
  await figma.loadFontAsync(fontName);
  FONT_CACHE.set(key, fontName);
  return fontName;
}
function styleCandidates(family, wanted) {
  const w = String(wanted || "Regular");
  const numeric = parseInt(w, 10);
  let names;
  if (!isNaN(numeric)) {
    names = numeric >= 800 ? ["ExtraBold", "Bold", "Semi Bold", "Regular"]
      : numeric >= 700 ? ["Bold", "Semi Bold", "Regular"]
      : numeric >= 600 ? ["Semi Bold", "SemiBold", "Bold", "Medium", "Regular"]
      : numeric >= 500 ? ["Medium", "Regular", "Semi Bold"]
      : ["Regular", "Medium"];
  } else {
    names = [w];
    if (/semibold/i.test(w)) names.push("Semi Bold", "Bold", "Medium", "Regular");
    if (/bold/i.test(w) && !/semi/i.test(w)) names.push("Semi Bold", "Regular");
    if (/medium/i.test(w)) names.push("Regular");
    names.push("Regular");
  }
  const seen = new Set();
  return names.filter((n) => (seen.has(n) ? false : (seen.add(n), true))).map((style) => ({ family, style }));
}
async function resolveFont(spec) {
  if (!spec) return loadFont(INTER_FALLBACK);
  if (spec.fontName) { try { return await loadFont(spec.fontName); } catch (e) { return loadFont(INTER_FALLBACK); } }
  const family = spec.family || spec.fontFamily || "Inter";
  const wanted = spec.style || spec.fontStyle || spec.weight || spec.fontWeight || "Regular";
  for (const cand of styleCandidates(family, wanted)) {
    try { return await loadFont(cand); } catch (e) { /* try next spelling */ }
  }
  return loadFont(INTER_FALLBACK);
}

// ---------- Serialization (Arena reading the canvas) ----------
function hexOf(c, a) {
  const h = (v) => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, "0");
  let s = "#" + h(c.r) + h(c.g) + h(c.b);
  if (a != null && a < 1) s += h(a);
  return s;
}
function paintInfo(p) {
  if (!p) return null;
  const out = { type: p.type, visible: p.visible !== false, opacity: p.opacity == null ? 1 : p.opacity, blendMode: p.blendMode || "NORMAL" };
  if (p.type === "SOLID" && p.color) out.color = hexOf(p.color, out.opacity);
  if ((p.type || "").indexOf("GRADIENT") === 0) {
    out.gradientStops = (p.gradientStops || []).map((s) => ({ position: s.position, color: hexOf(s.color, s.color && s.color.a) }));
    out.gradientTransform = p.gradientTransform || null;
  }
  if (p.type === "IMAGE") { out.imageHash = p.imageHash || null; out.scaleMode = p.scaleMode || "FILL"; }
  return out;
}
function nodeInfo(node) {
  if (!node) return null;
  const box = node.absoluteBoundingBox || null;
  return {
    id: node.id, name: node.name, type: node.type,
    x: box ? box.x : (typeof node.x === "number" ? node.x : null),
    y: box ? box.y : (typeof node.y === "number" ? node.y : null),
    width: typeof node.width === "number" ? node.width : (box ? box.width : null),
    height: typeof node.height === "number" ? node.height : (box ? box.height : null),
    parentId: node.parent ? node.parent.id : null,
    parentName: node.parent ? node.parent.name : null,
  };
}
function serializeNode(node, depth, budget) {
  if (!node || budget.count <= 0) return null;
  budget.count--;
  const info = nodeInfo(node);
  const out = Object.assign({}, info);
  out.localX = typeof node.x === "number" ? node.x : null;
  out.localY = typeof node.y === "number" ? node.y : null;
  out.rotation = typeof node.rotation === "number" ? node.rotation : 0;
  out.opacity = typeof node.opacity === "number" ? node.opacity : 1;
  out.visible = node.visible !== false;
  out.locked = !!node.locked;
  if ("blendMode" in node) out.blendMode = node.blendMode;
  if ("fills" in node && Array.isArray(node.fills)) out.fills = node.fills.map(paintInfo);
  if ("strokes" in node && Array.isArray(node.strokes)) { out.strokes = node.strokes.map(paintInfo); out.strokeWeight = node.strokeWeight; }
  if ("cornerRadius" in node) out.cornerRadius = node.cornerRadius;
  if ("topLeftRadius" in node) out.radii = [node.topLeftRadius, node.topRightRadius, node.bottomRightRadius, node.bottomLeftRadius];
  if ("effects" in node) out.effects = (node.effects || []).map((e) => ({ type: e.type, visible: e.visible !== false, radius: e.radius, spread: e.spread || 0, offset: e.offset || null, color: e.color ? hexOf(e.color, e.color.a) : null, blendMode: e.blendMode || "NORMAL" }));
  if ("constraints" in node) out.constraints = node.constraints;
  if ("layoutMode" in node) {
    out.layout = { mode: node.layoutMode, itemSpacing: node.itemSpacing, counterAxisSpacing: node.counterAxisSpacing,
      padding: [node.paddingTop, node.paddingRight, node.paddingBottom, node.paddingLeft],
      primaryAlign: node.primaryAxisAlignItems, counterAlign: node.counterAxisAlignItems,
      primarySizing: node.primaryAxisSizingMode, counterSizing: node.counterAxisSizingMode, wrap: node.layoutWrap };
  }
  if ("layoutSizingHorizontal" in node) out.sizing = [node.layoutSizingHorizontal, node.layoutSizingVertical];
  if ("layoutPositioning" in node) out.layoutPositioning = node.layoutPositioning;
  if (node.type === "TEXT") {
    out.text = node.characters;
    out.fontName = node.fontName && node.fontName.family ? node.fontName : null;
    out.fontSize = node.fontSize; out.textAlign = [node.textAlignHorizontal, node.textAlignVertical];
    out.textAutoResize = node.textAutoResize;
    out.lineHeight = node.lineHeight; out.letterSpacing = node.letterSpacing;
    try {
      out.segments = node.getStyledTextSegments(["fontName", "fontSize", "fills", "lineHeight", "letterSpacing", "textCase", "textDecoration"]).map((s) => ({
        start: s.start, end: s.end, text: s.characters, fontName: s.fontName, fontSize: s.fontSize,
        fills: (s.fills || []).map(paintInfo), lineHeight: s.lineHeight, letterSpacing: s.letterSpacing, textCase: s.textCase, textDecoration: s.textDecoration }));
    } catch (e) { /* segments optional */ }
  }
  if (node.type === "VECTOR" && node.vectorPaths) {
    try { out.vectorPaths = node.vectorPaths.map((v) => ({ windingRule: v.windingRule, data: v.data })); out.fillRule = node.fillRule; } catch (e) {}
  }
  if (node.type === "INSTANCE") {
    try { const mc = node.mainComponent; if (mc) out.mainComponent = { id: mc.id, name: mc.name, key: mc.key || null }; } catch (e) {}
  }
  if (node.type === "COMPONENT" || node.type === "COMPONENT_SET") { try { out.componentKey = node.key || null; } catch (e) {} out.variantProperties = null; try { out.variantProperties = node.variantProperties || null; } catch (e) {} }
  try { out.reactions = node.reactions || []; } catch (e) {}
  if (depth > 0 && "children" in node) {
    out.children = [];
    for (const c of node.children) { const s = serializeNode(c, depth - 1, budget); if (s) out.children.push(s); }
  } else if ("children" in node) {
    out.childCount = node.children.length;
  }
  return out;
}
async function getNodeById(id) {
  try {
    if (figma.getNodeByIdAsync) return await figma.getNodeByIdAsync(id);
    return figma.getNodeById(id);
  } catch (e) { return null; }
}
function findNodeByName(name, root) {
  const scope = root || figma.root;
  if (scope.name === name) return scope;
  if (typeof scope.findAll === "function") {
    const hits = scope.findAll((n) => n.name === name);
    return hits && hits.length ? hits[0] : null;
  }
  return null;
}
async function resolveNode(spec, refs) {
  if (!spec) return figma.currentPage;
  if (refs && typeof spec === "string" && refs.has(spec)) return refs.get(spec);
  if (typeof spec === "string") {
    const byId = await getNodeById(spec);
    if (byId) return byId;
    return findNodeByName(spec);
  }
  if (typeof spec === "object") {
    if (spec.ref && refs && refs.has(spec.ref)) return refs.get(spec.ref);
    if (spec.id) { const n = await getNodeById(spec.id); if (n) return n; }
    if (spec.name) return findNodeByName(spec.name);
  }
  return null;
}
function effectsFrom(spec) {
  if (!Array.isArray(spec)) return spec;
  return spec.map((e) => {
    if (!e || e.type !== "DROP_SHADOW") return e;
    const c = parseColor(e.color) || { r: 0, g: 0, b: 0, a: 0.25 };
    return {
      type: "DROP_SHADOW", visible: e.visible !== false,
      radius: e.radius != null ? e.radius : (e.blur != null ? e.blur : 16),
      offset: e.offset || { x: e.x || 0, y: e.y != null ? e.y : 8 },
      color: { r: c.r, g: c.g, b: c.b, a: e.alpha != null ? e.alpha : c.a },
      blendMode: e.blendMode || "NORMAL", showShadowBehindNode: true,
      spread: e.spread || 0,
    };
  });
}
async function setProps(node, props) {
  const warnings = [];
  if (!props) return warnings;
  let resizeTo = null;
  for (const [key, value] of Object.entries(props)) {
    try {
      if (key === "fill") node.fills = paintsFrom(value);
      else if (key === "fills") node.fills = paintsFrom(value);
      else if (key === "stroke") { node.strokes = paintsFrom(value); }
      else if (key === "strokes") node.strokes = paintsFrom(value);
      else if (key === "width" || key === "height") {
        resizeTo = resizeTo || { width: node.width, height: node.height };
        resizeTo[key] = value;
      } else if (key === "font") {
        const fn = await resolveFont(value);
        if ("fontName" in node) node.fontName = fn;
      } else if (key === "fontName") {
        const fn = await resolveFont({ fontName: value });
        if ("fontName" in node) node.fontName = fn;
      } else if (key === "text" || key === "characters") {
        if ("fontName" in node && node.fontName && node.fontName.family) {
          try { await loadFont(node.fontName); } catch (e) { await resolveFont(null); }
        }
        node.characters = value == null ? "" : String(value);
      } else if (key === "lineHeight") {
        node.lineHeight = typeof value === "number" ? { unit: "PIXELS", value } : value;
      } else if (key === "letterSpacing") {
        node.letterSpacing = typeof value === "number" ? { unit: "PIXELS", value } : value;
      } else if (key === "effects") node.effects = effectsFrom(value);
      else if (key === "cornerRadius" && typeof value === "number") node.cornerRadius = value;
      else node[key] = value;
    } catch (e) { warnings.push(key + ": " + (e && e.message)); }
  }
  if (resizeTo && typeof node.resize === "function") {
    try { node.resize(Math.max(0.01, resizeTo.width || 0.01), Math.max(0.01, resizeTo.height || 0.01)); }
    catch (e) { warnings.push("resize: " + (e && e.message)); }
  }
  return warnings;
}
async function createNode(op, refs) {
  const type = op.nodeType || op.type || "FRAME";
  let node = null;
  if (type === "FRAME") node = figma.createFrame();
  else if (type === "RECTANGLE") node = figma.createRectangle();
  else if (type === "ELLIPSE") node = figma.createEllipse();
  else if (type === "LINE") node = figma.createLine();
  else if (type === "STAR") node = figma.createStar();
  else if (type === "POLYGON") node = figma.createPolygon();
  else if (type === "SECTION") node = figma.createSection();
  else if (type === "TEXT") { node = figma.createText(); try { await loadFont(INTER_FALLBACK); node.fontName = INTER_FALLBACK; } catch (e) {} }
  else if (type === "COMPONENT") node = figma.createComponent();
  else if (type === "INSTANCE") {
    const comp = await resolveNode(op.component || op.parentComponent, refs);
    if (!comp || typeof comp.createInstance !== "function") throw new Error("createInstance: component not found");
    node = comp.createInstance();
  } else if (type === "VECTOR") {
    node = figma.createVector();
    if (op.vectorPaths) node.vectorPaths = op.vectorPaths;
    if (op.vectorNetwork) node.vectorNetwork = op.vectorNetwork;
  } else throw new Error("Unsupported nodeType: " + type);
  if (op.name) node.name = op.name;
  if (op.ref) refs.set(op.ref, node);
  const warnings = await setProps(node, op.props || {});
  const parent = op.parent ? await resolveNode(op.parent, refs) : figma.currentPage;
  if (parent && typeof parent.appendChild === "function" && node.parent !== parent) parent.appendChild(node);
  if (op.index != null && parent && typeof parent.insertChild === "function") {
    try { parent.insertChild(op.index, node); } catch (e) { warnings.push("insertChild: " + (e && e.message)); }
  }
  return { node: nodeInfo(node), warnings };
}
async function executeBatch(payload) {
  const refs = new Map();
  const results = [];
  const ops = (payload && payload.ops) || [];
  for (let i = 0; i < ops.length; i++) {
    const op = ops[i];
    const kind = op.op || "create";
    if (kind === "loadFonts") {
      const loaded = [];
      for (const f of op.fonts || []) { const fn = await resolveFont(f); loaded.push(fn.family + " " + fn.style); }
      results.push({ op: kind, loaded });
    } else if (kind === "create") {
      const r = await createNode(op, refs);
      results.push({ op: kind, ref: op.ref || null, node: r.node, warnings: r.warnings });
    } else if (kind === "set" || kind === "update") {
      const node = await resolveNode(op.node || op.ref || op.id || op.name, refs);
      if (!node) throw new Error("set: node not found at op " + i);
      const warnings = await setProps(node, op.props || {});
      results.push({ op: kind, node: nodeInfo(node), warnings });
    } else if (kind === "append" || kind === "insert") {
      const child = await resolveNode(op.child || op.ref, refs);
      const parent = await resolveNode(op.parent, refs);
      if (!child || !parent) throw new Error("append: child/parent not found at op " + i);
      if (kind === "insert" && typeof parent.insertChild === "function" && op.index != null) parent.insertChild(op.index, child);
      else parent.appendChild(child);
      results.push({ op: kind, node: nodeInfo(child) });
    } else if (kind === "remove" || kind === "delete") {
      const node = await resolveNode(op.node || op.ref || op.id || op.name, refs);
      if (!node) throw new Error("remove: node not found at op " + i);
      const info = nodeInfo(node);
      node.remove();
      results.push({ op: kind, node: info });
    } else if (kind === "clone") {
      const node = await resolveNode(op.node || op.ref || op.id || op.name, refs);
      if (!node || typeof node.clone !== "function") throw new Error("clone: node not found at op " + i);
      const copy = node.clone();
      if (op.newRef) refs.set(op.newRef, copy);
      if (op.props) await setProps(copy, op.props);
      results.push({ op: kind, node: nodeInfo(copy) });
    } else if (kind === "group") {
      const nodes = [];
      for (const ref of op.nodes || []) { const n = await resolveNode(ref, refs); if (n) nodes.push(n); }
      if (!nodes.length) throw new Error("group: no nodes at op " + i);
      const parent = op.parent ? await resolveNode(op.parent, refs) : nodes[0].parent;
      const g = figma.group(nodes, parent);
      if (op.name) g.name = op.name;
      if (op.newRef || op.ref) refs.set(op.newRef || op.ref, g);
      results.push({ op: kind, node: nodeInfo(g) });
    } else if (kind === "ungroup") {
      const node = await resolveNode(op.node || op.ref, refs);
      if (!node) throw new Error("ungroup: node not found at op " + i);
      const released = figma.ungroup(node);
      results.push({ op: kind, nodes: released.map(nodeInfo) });
    } else if (kind === "componentFromNode") {
      const node = await resolveNode(op.node || op.ref, refs);
      if (!node) throw new Error("componentFromNode: node not found at op " + i);
      const comp = figma.createComponentFromNode(node);
      if (op.name) comp.name = op.name;
      if (op.newRef) refs.set(op.newRef, comp);
      results.push({ op: kind, node: nodeInfo(comp) });
    } else if (kind === "combineAsVariants") {
      const nodes = [];
      for (const ref of op.nodes || []) { const n = await resolveNode(ref, refs); if (n) nodes.push(n); }
      const parent = op.parent ? await resolveNode(op.parent, refs) : figma.currentPage;
      const set = figma.combineAsVariants(nodes, parent);
      if (op.name) set.name = op.name;
      if (op.newRef) refs.set(op.newRef, set);
      results.push({ op: kind, node: nodeInfo(set) });
    } else if (kind === "boolean") {
      const nodes = [];
      for (const ref of op.nodes || []) { const n = await resolveNode(ref, refs); if (n) nodes.push(n); }
      const parent = op.parent ? await resolveNode(op.parent, refs) : figma.currentPage;
      const mode = String(op.mode || "union").toLowerCase();
      const fn = { union: figma.union, subtract: figma.subtract, intersect: figma.intersect, exclude: figma.exclude }[mode];
      if (!fn) throw new Error("boolean: bad mode " + mode);
      const resNode = fn(nodes, parent);
      if (op.name) resNode.name = op.name;
      if (op.newRef) refs.set(op.newRef, resNode);
      results.push({ op: kind, node: nodeInfo(resNode) });
    } else if (kind === "detach") {
      const node = await resolveNode(op.node || op.ref, refs);
      if (!node || typeof node.detachInstance !== "function") throw new Error("detach: instance not found at op " + i);
      const frame = node.detachInstance();
      if (op.newRef) refs.set(op.newRef, frame);
      results.push({ op: kind, node: nodeInfo(frame) });
    } else if (kind === "swapComponent") {
      const node = await resolveNode(op.node || op.ref, refs);
      const comp = await resolveNode(op.component, refs);
      if (!node || !comp || typeof node.swapComponent !== "function") throw new Error("swapComponent: bad nodes at op " + i);
      node.swapComponent(comp);
      results.push({ op: kind, node: nodeInfo(node) });
    } else if (kind === "setRange") {
      const node = await resolveNode(op.node || op.ref, refs);
      if (!node || node.type !== "TEXT") throw new Error("setRange: text node not found at op " + i);
      const s = op.start || 0, e = op.end != null ? op.end : node.characters.length;
      if (op.props && op.props.font) { const fn = await resolveFont(op.props.font); node.setRangeFontName(s, e, fn); }
      if (op.props && op.props.fontSize) node.setRangeFontSize(s, e, op.props.fontSize);
      if (op.props && (op.props.fill || op.props.fills)) node.setRangeFills(s, e, paintsFrom(op.props.fill || op.props.fills));
      if (op.props && op.props.lineHeight) node.setRangeLineHeight(s, e, typeof op.props.lineHeight === "number" ? { unit: "PIXELS", value: op.props.lineHeight } : op.props.lineHeight);
      results.push({ op: kind, node: nodeInfo(node) });
    } else if (kind === "select") {
      const nodes = [];
      for (const ref of op.nodes || []) { const n = await resolveNode(ref, refs); if (n) nodes.push(n); }
      figma.currentPage.selection = nodes;
      results.push({ op: kind, selection: nodes.map(nodeInfo) });
    } else if (kind === "zoom") {
      const node = await resolveNode(op.node || op.ref || op.id || op.name, refs);
      if (node) figma.viewport.scrollAndZoomIntoView([node]);
      results.push({ op: kind, node: nodeInfo(node) });
    } else if (kind === "info" || kind === "read") {
      const node = await resolveNode(op.node || op.ref || op.id || op.name, refs);
      const depth = op.depth != null ? op.depth : (kind === "read" ? 99 : 0);
      const budget = { count: op.maxNodes || 4000 };
      results.push({ op: kind, node: node ? (kind === "read" ? serializeNode(node, depth, budget) : shallowWalk(node, depth)) : null });
    } else if (kind === "find") {
      const scope = op.node ? await resolveNode(op.node, refs) : figma.currentPage;
      const type = op.nodeType || null, nameQ = op.name ? String(op.name).toLowerCase() : null;
      const hits = scope && typeof scope.findAll === "function" ? scope.findAll((n) => (!type || n.type === type) && (!nameQ || (n.name || "").toLowerCase().includes(nameQ))) : [];
      results.push({ op: kind, nodes: hits.slice(0, op.limit || 200).map(nodeInfo), total: hits.length });
    } else if (kind === "cleanupBadFrames") {
      results.push({ op: kind, ...(await cleanupBadFrames(op.names ? { names: op.names } : {})) });
    } else if (kind === "createImage") {
      const b64 = op.imageBase64 || (op.props && op.props.imageBase64);
      if (!b64) throw new Error("createImage: imageBase64 missing at op " + i);
      const img = figma.createImage(figma.base64Decode(b64));
      const node = figma.createRectangle();
      if (op.name) node.name = op.name;
      if (op.ref) refs.set(op.ref, node);
      node.fills = [{ type: "IMAGE", imageHash: img.hash, scaleMode: op.scaleMode || "FILL" }];
      const p = op.props || {};
      const warnings = await setProps(node, { x: p.x || 0, y: p.y || 0, width: p.width || 100, height: p.height || 100, cornerRadius: p.cornerRadius || 0, opacity: p.opacity == null ? 1 : p.opacity });
      const parent = op.parent ? await resolveNode(op.parent, refs) : figma.currentPage;
      if (parent && typeof parent.appendChild === "function" && node.parent !== parent) parent.appendChild(node);
      results.push({ op: kind, ref: op.ref || null, node: nodeInfo(node), warnings });
    } else if (kind === "createSvg" || kind === "createSvgComponent") {
      if (!op.svg) throw new Error("createSvg: svg missing at op " + i);
      let node = figma.createNodeFromSvg(String(op.svg));
      if (kind === "createSvgComponent") node = figma.createComponentFromNode(node);
      if (op.name) node.name = op.name;
      if (op.ref) refs.set(op.ref, node);
      const p = op.props || {};
      const parent = op.parent ? await resolveNode(op.parent, refs) : figma.currentPage;
      if (parent && typeof parent.appendChild === "function" && node.parent !== parent) parent.appendChild(node);
      const warnings = await setProps(node, { x: p.x || 0, y: p.y || 0, width: p.width || node.width, height: p.height || node.height, opacity: p.opacity == null ? 1 : p.opacity });
      results.push({ op: kind, ref: op.ref || null, node: nodeInfo(node), warnings });
    } else if (kind === "createPage") {
      const page = figma.createPage();
      if (op.name) page.name = op.name;
      if (op.ref) refs.set(op.ref, page);
      results.push({ op: kind, node: nodeInfo(page) });
    } else if (kind === "setCurrentPage") {
      const page = await resolveNode(op.node || op.page || op.name, refs);
      if (!page || page.type !== "PAGE") throw new Error("setCurrentPage: page not found at op " + i);
      figma.currentPage = page;
      results.push({ op: kind, node: nodeInfo(page) });
    } else if (kind === "setFlow") {
      const page = op.page ? await resolveNode(op.page, refs) : figma.currentPage;
      const node = await resolveNode(op.node || op.ref, refs);
      if (!page || !node) throw new Error("setFlow: page/node not found at op " + i);
      page.flowStartingPoints = [{ nodeId: node.id, name: op.name || node.name }];
      results.push({ op: kind, node: nodeInfo(node) });
    } else if (kind === "createVariableCollection") {
      const col = figma.variables.createVariableCollection(op.name || "Collection");
      if (op.modes) { try { col.renameMode(col.modes[0].id, op.modes[0]); } catch (e) {} for (let m = 1; m < op.modes.length; m++) col.addMode(op.modes[m]); }
      if (op.ref) refs.set(op.ref, col);
      results.push({ op: kind, collection: { id: col.id, name: col.name, modes: col.modes } });
    } else if (kind === "createVariable") {
      let col = op.collection ? await resolveNode(op.collection, refs) : null;
      if (!col || !col.modes) { const cols = await figma.variables.getLocalVariableCollectionsAsync(); col = cols.find((c) => c.id === op.collection || c.name === op.collection) || null; }
      if (!col) throw new Error("createVariable: collection not found at op " + i);
      const variable = figma.variables.createVariable(op.name || "Variable", col, op.valueType || "COLOR");
      const modeId = op.modeId || col.modes[0].id;
      let v = op.value;
      if ((op.valueType || "COLOR") === "COLOR") { const c = parseColor(v) || { r: 0, g: 0, b: 0, a: 1 }; v = { r: c.r, g: c.g, b: c.b, a: c.a }; }
      variable.setValueForMode(modeId, v);
      if (op.ref) refs.set(op.ref, variable);
      results.push({ op: kind, variable: { id: variable.id, name: variable.name } });
    } else if (kind === "createPaintStyle" || kind === "createTextStyle" || kind === "createEffectStyle") {
      let style;
      if (kind === "createPaintStyle") { style = figma.createPaintStyle(); style.paints = paintsFrom(op.fill || op.color || "#000000"); }
      if (kind === "createTextStyle") { style = figma.createTextStyle(); const fn = await resolveFont(op.font || {}); style.fontName = fn; style.fontSize = op.fontSize || 16; if (op.lineHeight) style.lineHeight = typeof op.lineHeight === "number" ? { unit: "PIXELS", value: op.lineHeight } : op.lineHeight; if (op.letterSpacing) style.letterSpacing = typeof op.letterSpacing === "number" ? { unit: "PIXELS", value: op.letterSpacing } : op.letterSpacing; }
      if (kind === "createEffectStyle") { style = figma.createEffectStyle(); style.effects = effectsFrom(op.effects || []); }
      if (op.name) style.name = op.name;
      if (op.description) style.description = op.description;
      results.push({ op: kind, style: { id: style.id, name: style.name, key: style.key } });
    } else if (kind === "setReactions") {
      const node = await resolveNode(op.node || op.ref || op.id || op.name, refs);
      if (!node) throw new Error("setReactions: node not found at op " + i);
      const reactions = op.reactions || [];
      if (typeof node.setReactionsAsync === "function") await node.setReactionsAsync(reactions);
      else node.reactions = reactions;
      results.push({ op: kind, node: nodeInfo(node), count: reactions.length });
    } else if (kind === "notify") {
      figma.notify(String(op.message || "Bridge"), { timeout: op.timeout || 3000 });
      results.push({ op: kind });
    } else {
      throw new Error("Unsupported op: " + kind + " at index " + i);
    }
  }
  const refInfo = {};
  for (const [k, v] of refs.entries()) { try { refInfo[k] = nodeInfo(v); } catch (e) { /* variables etc. */ } }
  return { results, refs: refInfo };
}
function shallowWalk(node, depth) {
  const base = nodeInfo(node);
  if (depth > 0 && "children" in node) base.children = node.children.map((c) => shallowWalk(c, depth - 1));
  return base;
}
async function cleanupBadFrames(payload) {
  const names = (payload && payload.names) || [];
  const removed = [];
  for (const page of figma.root.children) {
    if (!("children" in page)) continue;
    for (const child of [...page.children]) {
      if (names.includes(child.name)) {
        removed.push({ page: page.name, ...nodeInfo(child) });
        child.remove();
      }
    }
  }
  return { removed };
}
function fileState() {
  return {
    fileName: figma.root.name,
    currentPage: nodeInfo(figma.currentPage),
    pages: figma.root.children.map((p) => ({
      ...nodeInfo(p),
      children: "children" in p ? p.children.map(nodeInfo) : [],
    })),
    selection: figma.currentPage.selection.map(nodeInfo),
  };
}
async function listStylesCommand() {
  const collections = [];
  try {
    const cols = await figma.variables.getLocalVariableCollectionsAsync();
    for (const col of cols) {
      const vars = [];
      for (const id of col.variableIds) {
        const v = await figma.variables.getVariableByIdAsync(id);
        if (!v) continue;
        const values = {};
        for (const m of col.modes) {
          let val = v.valuesByMode[m.modeId];
          if (val && typeof val === "object" && "r" in val) val = hexOf(val, val.a);
          values[m.name] = val;
        }
        vars.push({ id: v.id, name: v.name, type: v.resolvedType, values });
      }
      collections.push({ id: col.id, name: col.name, modes: col.modes.map((m) => m.name), variables: vars });
    }
  } catch (e) { /* variables optional */ }
  const paintStyles = figma.getLocalPaintStyles().map((s) => ({ id: s.id, name: s.name, key: s.key, paints: (s.paints || []).map(paintInfo) }));
  const textStyles = figma.getLocalTextStyles().map((s) => ({ id: s.id, name: s.name, key: s.key, fontName: s.fontName, fontSize: s.fontSize, lineHeight: s.lineHeight, letterSpacing: s.letterSpacing }));
  const effectStyles = figma.getLocalEffectStyles().map((s) => ({ id: s.id, name: s.name, key: s.key, effects: (s.effects || []).map((e) => ({ type: e.type, radius: e.radius, color: e.color ? hexOf(e.color, e.color.a) : null })) }));
  return { variableCollections: collections, paintStyles, textStyles, effectStyles };
}
async function exportNodeCommand(payload) {
  const node = await resolveNode(payload.node || payload.id || payload.name, null);
  if (!node || typeof node.exportAsync !== "function") throw new Error("export_node: node not found or not exportable");
  const scale = payload.scale || 0.5;
  const format = payload.format || "PNG";
  const settings = format === "PNG" || format === "JPG" ? { format, constraint: { type: "SCALE", value: scale } } : { format };
  const bytes = await node.exportAsync(settings);
  return {
    __exportBase64: figma.base64Encode(bytes),
    nodeId: node.id, nodeName: node.name, format, scale,
    width: Math.round((node.width || 0) * scale), height: Math.round((node.height || 0) * scale),
    bytes: bytes.length,
  };
}
async function executeCommand(cmd) {
  const type = cmd.command_type;
  const payload = cmd.payload || {};
  if (type === "ping") return { ok: true, version: 2, file: figma.root.name, state: fileState() };
  if (type === "file_state") return fileState();
  if (type === "cleanup_bad_frames") return cleanupBadFrames(payload);
  if (type === "export_node") return exportNodeCommand(payload);
  if (type === "read_node") {
    const node = await resolveNode(payload.node || payload.id || payload.name, null);
    if (!node) throw new Error("read_node: node not found");
    return serializeNode(node, payload.depth != null ? payload.depth : 99, { count: payload.maxNodes || 6000 });
  }
  if (type === "read_selection") {
    return { selection: figma.currentPage.selection.map((n) => serializeNode(n, payload.depth != null ? payload.depth : 99, { count: payload.maxNodes || 6000 })) };
  }
  if (type === "list_styles") return listStylesCommand();
  if (type === "batch") return executeBatch(payload);
  throw new Error("Unsupported command_type: " + type);
}

figma.ui.onmessage = async (msg) => {
  if (!msg) return;
  if (msg.type === "resize") {
    try { figma.ui.resize(Math.max(240, msg.width || 320), Math.max(80, msg.height || 468)); } catch (e) {}
    return;
  }
  if (msg.type === "ui_ready") {
    const sessionId = await getSessionId();
    figma.ui.postMessage({ type: "session", sessionId });
    figma.ui.postMessage({ type: "hello", data: fileState() });
    return;
  }
  if (msg.type === "reset_session") {
    SESSION_ID = uuidv4();
    try { await figma.clientStorage.setAsync("arena-Bridge-session", SESSION_ID); } catch (e) {}
    figma.ui.postMessage({ type: "session", sessionId: SESSION_ID });
    return;
  }
  if (msg.type === "execute" && msg.command) {
    const cmd = msg.command;
    try {
      const result = await executeCommand(cmd);
      figma.ui.postMessage({ type: "result", commandId: cmd.id, ok: true, result });
    } catch (e) {
      figma.ui.postMessage({ type: "result", commandId: cmd.id, ok: false, error: (e && e.stack) || String(e) });
    }
  }
};
