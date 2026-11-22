#!/usr/bin/env python3
"""Design -> code for the Arena Figma Bridge.

Turns a `read_node` / `read_selection` spec (deep node tree exported through
the Bridge) into a React component with inline styles that mirror the Figma
structure 1:1:

  - Auto Layout frames -> flex containers (direction, gap, padding, align)
  - Absolute children   -> position:absolute inside a relative parent
  - Text nodes          -> styled <div> with font size/weight/family/color
  - Vector nodes        -> inline <svg> rebuilt from vectorPaths
  - Instances           -> placeholder component tags (swap in your real ones)

Usage:
  Bridge_client.py --session <code> --type read_node --payload '{"id":"4:731"}' --out spec.json
  figma_to_code.py spec.json --out Screen.jsx --name Screen

Also exports design tokens from a `list_styles` result:
  figma_to_code.py styles.json --styles --out tokens.css
"""
import argparse
import json
import pathlib
import re
import sys

WEIGHTS = {
    'thin': 100, 'extralight': 200, 'light': 300, 'regular': 400, 'normal': 400,
    'medium': 500, 'semibold': 600, 'semi bold': 600, 'bold': 700,
    'extrabold': 800, 'extra bold': 800, 'black': 900,
}
JUSTIFY = {'MIN': 'flex-start', 'CENTER': 'center', 'MAX': 'flex-end', 'SPACE_BETWEEN': 'space-between'}
ALIGN = {'MIN': 'flex-start', 'CENTER': 'center', 'MAX': 'flex-end', 'BASELINE': 'baseline'}


def weight_of(style_name):
    if not style_name:
        return None
    return WEIGHTS.get(str(style_name).strip().lower())


def px(v):
    if v is None:
        return None
    return f"{round(float(v), 1):g}px"


def solid(paints):
    for p in paints or []:
        if p.get('type') == 'SOLID' and p.get('visible', True):
            return p.get('color')
    return None


def background(paints):
    for p in paints or []:
        if not p.get('visible', True):
            continue
        if p.get('type') == 'SOLID':
            return p.get('color')
        if (p.get('type') or '').startswith('GRADIENT'):
            stops = p.get('gradientStops') or []
            if stops:
                parts = ', '.join(f"{s.get('color')} {round(s.get('position', 0) * 100):g}%" for s in stops)
                return f"linear-gradient(180deg, {parts})"
        if p.get('type') == 'IMAGE':
            return None  # image hash only; export the node as PNG/SVG for the asset
    return None


def shadow_of(effects):
    parts = []
    for e in effects or []:
        if e.get('type') == 'DROP_SHADOW' and e.get('visible', True):
            off = e.get('offset') or {}
            color = e.get('color') or 'rgba(0,0,0,0.25)'
            parts.append(f"{px(off.get('x', 0))} {px(off.get('y', 0))} {px(e.get('radius', 0))} {px(e.get('spread', 0))} {color}")
    return ', '.join(parts) if parts else None


def style_for(node, parent_layout):
    st = {}
    layout = node.get('layout') or {}
    mode = layout.get('mode')
    is_flex = mode in ('HORIZONTAL', 'VERTICAL')
    children = node.get('children') or []
    if node.get('type') in ('FRAME', 'COMPONENT', 'COMPONENT_SET', 'INSTANCE', 'GROUP', 'SECTION', 'BOOLEAN_OPERATION') and children:
        st['position'] = st.get('position', 'relative')
    if is_flex:
        st['display'] = 'flex'
        st['flexDirection'] = 'row' if mode == 'HORIZONTAL' else 'column'
        if layout.get('itemSpacing'):
            st['gap'] = px(layout['itemSpacing'])
        pad = layout.get('padding') or []
        if len(pad) == 4 and any(pad):
            st['padding'] = ' '.join(px(v) for v in pad)
        if layout.get('primaryAlign') in JUSTIFY:
            st['justifyContent'] = JUSTIFY[layout['primaryAlign']]
        if layout.get('counterAlign') in ALIGN:
            st['alignItems'] = ALIGN[layout['counterAlign']]
        if layout.get('wrap') == 'WRAP':
            st['flexWrap'] = 'wrap'
    # positioning
    sizing = node.get('sizing') or []
    if parent_layout in ('HORIZONTAL', 'VERTICAL') and node.get('layoutPositioning') != 'ABSOLUTE':
        if sizing and sizing[0] == 'FILL':
            st['flex'] = '1 1 0%'
            st.pop('width', None)
        if len(sizing) > 1 and sizing[1] == 'FILL':
            st['alignSelf'] = 'stretch'
    else:
        if node.get('localX') is not None:
            st['position'] = 'absolute'
            st['left'] = px(node.get('localX'))
            st['top'] = px(node.get('localY'))
    if 'width' not in st and sizing[:1] != ['FILL'] and node.get('width'):
        st['width'] = px(node['width'])
    if len(sizing) <= 1 or sizing[1] != 'FILL':
        if node.get('height'):
            st['height'] = px(node['height'])
    bg = background(node.get('fills'))
    if bg:
        st['background'] = bg
    strokes = node.get('strokes') or []
    stroke_color = solid(strokes)
    if stroke_color and node.get('strokeWeight'):
        st['border'] = f"{px(node['strokeWeight'])} solid {stroke_color}"
    radii = node.get('radii')
    if radii and any(radii):
        st['borderRadius'] = ' '.join(px(v) for v in [radii[0], radii[1], radii[3], radii[2]])
    elif node.get('cornerRadius'):
        st['borderRadius'] = px(node['cornerRadius'])
    if node.get('type') == 'ELLIPSE':
        st['borderRadius'] = '50%'
    bs = shadow_of(node.get('effects'))
    if bs:
        st['boxShadow'] = bs
    if node.get('opacity') is not None and node.get('opacity') != 1:
        st['opacity'] = str(node['opacity'])
    if node.get('rotation'):
        st['transform'] = f"rotate({-round(float(node['rotation']), 2):g}deg)"
    if node.get('blendMode') and node['blendMode'] != 'NORMAL':
        st['mixBlendMode'] = node['blendMode'].lower().replace('_', '-')
    if node.get('type') == 'TEXT':
        fn = node.get('fontName') or {}
        if fn.get('family'):
            st['fontFamily'] = f"'{fn['family']}', sans-serif"
        w = weight_of(fn.get('style'))
        if w:
            st['fontWeight'] = str(w)
        if node.get('fontSize'):
            st['fontSize'] = px(node['fontSize'])
        lh = node.get('lineHeight') or {}
        if lh.get('unit') == 'PIXELS':
            st['lineHeight'] = px(lh.get('value'))
        ls = node.get('letterSpacing') or {}
        if ls.get('unit') == 'PIXELS' and ls.get('value'):
            st['letterSpacing'] = px(ls.get('value'))
        color = solid(node.get('fills'))
        if color:
            st['color'] = color
        align = (node.get('textAlign') or [None])[0]
        if align and align != 'LEFT':
            st['textAlign'] = align.lower()
        st.pop('background', None)
        st.pop('border', None)
    return st


def style_str(st):
    if not st:
        return ''
    body = ', '.join(f"{k}: {json.dumps(v) if not str(v).isdigit() else v}" for k, v in st.items())
    return ' style={{' + body + '}}'


def esc(text):
    return (text or '').replace('\\', '\\\\').replace('{', "{'{'}").replace('}', "{'}'}").replace('<', "{'<'}").replace('>', "{'>'}")


def pascal(name):
    parts = re.split(r'[^a-zA-Z0-9]+', name or 'Component')
    out = ''.join(p[:1].upper() + p[1:] for p in parts if p)
    return out or 'Component'


def render(node, parent_layout, depth, used_components):
    t = node.get('type')
    layout = (node.get('layout') or {}).get('mode')
    indent = '  ' * depth
    if t == 'TEXT':
        st = style_for(node, parent_layout)
        return f"{indent}<div{style_str(st)}>{esc(node.get('text'))}</div>"
    if t == 'VECTOR':
        w, h = node.get('width') or 24, node.get('height') or 24
        fill = solid(node.get('fills')) or 'currentColor'
        paths = ''.join(f'<path d={json.dumps(p.get("data", ""))} fillRule="evenodd" />' for p in node.get('vectorPaths') or [])
        st = style_for(node, parent_layout)
        st.pop('background', None)
        st.pop('border', None)
        return (f"{indent}<svg width={{{round(float(w), 1):g}}} height={{{round(float(h), 1):g}}} "
                f"viewBox=\"0 0 {round(float(w), 1):g} {round(float(h), 1):g}\" fill=\"{fill}\"{style_str(st)}>{paths}</svg>")
    if t == 'INSTANCE':
        comp = (node.get('mainComponent') or {}).get('name') or node.get('name') or 'Component'
        tag = pascal(comp)
        used_components.add(tag)
        st = style_for(node, parent_layout)
        return f"{indent}<{tag}{style_str(st)} />"
    children = node.get('children') or []
    st = style_for(node, parent_layout)
    if children:
        inner = '\n'.join(render(c, layout, depth + 1, used_components) for c in children if c.get('visible', True))
        return f"{indent}<div{style_str(st)}>\n{inner}\n{indent}</div>"
    return f"{indent}<div{style_str(st)} />"


def unwrap_spec(data):
    if isinstance(data, dict) and 'result' in data:
        data = data['result']
    if isinstance(data, dict) and 'selection' in data:
        return data['selection'][0]
    if isinstance(data, dict) and 'node' in data:
        return data['node']
    if isinstance(data, dict) and 'results' in data and data['results']:
        return data['results'][0].get('node')
    return data


def tokens_css(data):
    if isinstance(data, dict) and 'result' in data:
        data = data['result']
    lines = [':root {']
    for col in data.get('variableCollections') or []:
        cname = re.sub(r'[^a-z0-9]+', '-', col['name'].lower()).strip('-')
        for v in col.get('variables') or []:
            vname = re.sub(r'[^a-z0-9]+', '-', v['name'].lower()).strip('-')
            values = v.get('values') or {}
            val = next(iter(values.values()), None)
            if val is not None:
                lines.append(f"  --{cname}-{vname}: {val};")
    for s in data.get('paintStyles') or []:
        vname = re.sub(r'[^a-z0-9]+', '-', s['name'].lower()).strip('-')
        paints = s.get('paints') or []
        color = solid(paints)
        if color:
            lines.append(f"  --color-{vname}: {color};")
    lines.append('}')
    for s in data.get('textStyles') or []:
        fn = s.get('fontName') or {}
        cls = re.sub(r'[^a-z0-9]+', '-', s['name'].lower()).strip('-')
        lines.append(f".text-{cls} {{ font-family: '{fn.get('family', 'Inter')}', sans-serif; "
                     f"font-weight: {weight_of(fn.get('style')) or 400}; font-size: {px(s.get('fontSize'))}; }}")
    return '\n'.join(lines) + '\n'


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('spec')
    ap.add_argument('--out', required=True)
    ap.add_argument('--name', default='Screen')
    ap.add_argument('--styles', action='store_true', help='Input is a list_styles result; emit tokens.css instead')
    args = ap.parse_args()
    data = json.loads(pathlib.Path(args.spec).read_text())
    if args.styles:
        pathlib.Path(args.out).write_text(tokens_css(data))
        print(f'wrote {args.out} (tokens)')
        return 0
    root = unwrap_spec(data)
    if not root:
        raise SystemExit('No node found in spec JSON')
    used = set()
    body = render(root, None, 1, used)
    imports = ''
    if used:
        imports = '\n'.join(f"// TODO: import or implement <{c} /> (Figma instance)" for c in sorted(used)) + '\n'
    jsx = (f"import React from 'react';\n{imports}\n"
           f"export default function {pascal(args.name)}() {{\n  return (\n{body}\n  );\n}}\n")
    pathlib.Path(args.out).write_text(jsx)
    print(f'wrote {args.out} (component {pascal(args.name)}, instances: {sorted(used) or "none"})')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
