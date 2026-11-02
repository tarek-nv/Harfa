import svgpath from 'svgpath';

export interface PathCommand {
  type: 'M' | 'L' | 'C' | 'Q' | 'Z';
  x?: number;
  y?: number;
  x1?: number;
  y1?: number;
  x2?: number;
  y2?: number;
}

export interface NormalizedContour {
  commands: PathCommand[];
  isHole: boolean;
  signedArea: number;
  bbox: { minX: number; minY: number; maxX: number; maxY: number };
}

export interface GlyphMetricsInput {
  offsetX: number;
  offsetY: number;
  scale: number;
  leftBearing: number;
  rightBearing: number;
}

export interface ParsedSvgResult {
  valid: boolean;
  viewBox: [number, number, number, number];
  innerSvg: string;
  normalizedSvgPathD: string;
  contoursInSvgSpace: NormalizedContour[];
  ignoredElements: string[];
  hasStrokeWarning: boolean;
  hasUnexpandedStrokes: boolean;
  strokeOnlyCount: number;
  filledShapeCount: number;
  error?: string;
}

export interface TransformedFontOutline {
  commands: PathCommand[];
  contours: NormalizedContour[];
  contourCount: number;
  advanceWidth: number;
  bbox: { minX: number; minY: number; maxX: number; maxY: number };
  clampedWarning: boolean;
  editorPathD: string;
}

interface SimpleDomNode {
  tagName: string;
  attributes: Record<string, string>;
  children: SimpleDomNode[];
}

const MAX_SVG_BYTES = 5 * 1024 * 1024; // 5 MB safety limit
const UNSUPPORTED_TAGS = new Set([
  'text',
  'tspan',
  'textPath',
  'image',
  'foreignObject',
  'filter',
  'feGaussianBlur',
  'feDropShadow',
  'feColorMatrix',
  'feBlend',
  'linearGradient',
  'radialGradient',
  'pattern',
  'clipPath',
  'mask',
  'marker',
  'script',
  'animate',
  'animateTransform',
]);

const CONTAINER_SKIP_TAGS = new Set([
  'defs',
  'style',
  'title',
  'desc',
  'metadata',
  'symbol',
  'clippath',
  'mask',
  'filter',
  'lineargradient',
  'radialgradient',
  'pattern',
  'script',
]);

const DRAWABLE_TAGS = new Set([
  'path',
  'rect',
  'circle',
  'ellipse',
  'polygon',
  'polyline',
  'line',
]);

function parseInlineStyle(styleStr?: string): Record<string, string> {
  const map: Record<string, string> = {};
  if (!styleStr) return map;
  for (const part of styleStr.split(';')) {
    const colonIdx = part.indexOf(':');
    if (colonIdx > 0) {
      const k = part.slice(0, colonIdx).trim().toLowerCase();
      const v = part.slice(colonIdx + 1).trim();
      if (k && v) map[k] = v;
    }
  }
  return map;
}

function getEffectiveAttr(
  node: SimpleDomNode,
  inlineStyle: Record<string, string>,
  inherited: Record<string, string>,
  name: string
): string | undefined {
  if (inlineStyle[name] !== undefined) return inlineStyle[name];
  if (node.attributes[name] !== undefined) return node.attributes[name];
  return inherited[name];
}

function parseNumber(val: string | undefined, fallback = 0): number {
  if (val === undefined || val === null || val === '') return fallback;
  const cleaned = String(val).trim().replace(/(px|pt|em|rem|%)$/i, '');
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Converts basic SVG shapes (<rect>, <circle>, <ellipse>, <polygon>, <polyline>, <line>)
 * into equivalent SVG <path d="..."> strings.
 */
export function shapeToPathD(tagName: string, attrs: Record<string, string>): string {
  const tag = tagName.toLowerCase();
  if (tag === 'path') {
    return (attrs.d || '').trim();
  }

  if (tag === 'rect') {
    const x = parseNumber(attrs.x, 0);
    const y = parseNumber(attrs.y, 0);
    const w = parseNumber(attrs.width, 0);
    const h = parseNumber(attrs.height, 0);
    if (w <= 0 || h <= 0) return '';

    let rx = attrs.rx !== undefined ? parseNumber(attrs.rx, 0) : parseNumber(attrs.ry, 0);
    let ry = attrs.ry !== undefined ? parseNumber(attrs.ry, 0) : parseNumber(attrs.rx, 0);
    rx = Math.min(Math.max(0, rx), w / 2);
    ry = Math.min(Math.max(0, ry), h / 2);

    if (rx === 0 || ry === 0) {
      return `M ${x} ${y} L ${x + w} ${y} L ${x + w} ${y + h} L ${x} ${y + h} Z`;
    }

    return [
      `M ${x + rx} ${y}`,
      `L ${x + w - rx} ${y}`,
      `A ${rx} ${ry} 0 0 1 ${x + w} ${y + ry}`,
      `L ${x + w} ${y + h - ry}`,
      `A ${rx} ${ry} 0 0 1 ${x + w - rx} ${y + h}`,
      `L ${x + rx} ${y + h}`,
      `A ${rx} ${ry} 0 0 1 ${x} ${y + h - ry}`,
      `L ${x} ${y + ry}`,
      `A ${rx} ${ry} 0 0 1 ${x + rx} ${y}`,
      'Z',
    ].join(' ');
  }

  if (tag === 'circle') {
    const cx = parseNumber(attrs.cx, 0);
    const cy = parseNumber(attrs.cy, 0);
    const r = parseNumber(attrs.r, 0);
    if (r <= 0) return '';
    return `M ${cx - r} ${cy} A ${r} ${r} 0 1 0 ${cx + r} ${cy} A ${r} ${r} 0 1 0 ${cx - r} ${cy} Z`;
  }

  if (tag === 'ellipse') {
    const cx = parseNumber(attrs.cx, 0);
    const cy = parseNumber(attrs.cy, 0);
    const rx = parseNumber(attrs.rx, 0);
    const ry = parseNumber(attrs.ry, 0);
    if (rx <= 0 || ry <= 0) return '';
    return `M ${cx - rx} ${cy} A ${rx} ${ry} 0 1 0 ${cx + rx} ${cy} A ${rx} ${ry} 0 1 0 ${cx - rx} ${cy} Z`;
  }

  if (tag === 'polygon' || tag === 'polyline') {
    const rawPts = (attrs.points || '').trim();
    if (!rawPts) return '';
    const nums = rawPts
      .split(/[\s,]+/)
      .filter(Boolean)
      .map(Number)
      .filter((n) => Number.isFinite(n));
    if (nums.length < 4) return '';
    const pairs: string[] = [];
    for (let i = 0; i + 1 < nums.length; i += 2) {
      pairs.push(`${nums[i]} ${nums[i + 1]}`);
    }
    return `M ${pairs[0]} L ${pairs.slice(1).join(' L ')}${tag === 'polygon' ? ' Z' : ''}`;
  }

  if (tag === 'line') {
    const x1 = parseNumber(attrs.x1, 0);
    const y1 = parseNumber(attrs.y1, 0);
    const x2 = parseNumber(attrs.x2, 0);
    const y2 = parseNumber(attrs.y2, 0);
    if (x1 === x2 && y1 === y2) return '';
    return `M ${x1} ${y1} L ${x2} ${y2}`;
  }

  return '';
}

function parseSvgXmlTree(svgString: string): {
  root: SimpleDomNode | null;
  innerSvg: string;
  error?: string;
} {
  const trimmed = svgString.trim();
  const svgOpenMatch = trimmed.match(/<svg\b[^>]*>([\s\S]*?)<\/svg>/i);
  if (!svgOpenMatch) {
    return { root: null, innerSvg: '', error: 'INVALID_SVG_TAG' };
  }

  const innerSvg = svgOpenMatch[1]
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .trim();

  if (typeof DOMParser !== 'undefined') {
    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(trimmed, 'image/svg+xml');
      const parserError = doc.querySelector('parsererror');
      if (parserError) {
        return { root: null, innerSvg: '', error: 'INVALID_SVG_XML' };
      }
      const svgEl = doc.querySelector('svg');
      if (!svgEl) {
        return { root: null, innerSvg: '', error: 'INVALID_SVG_TAG' };
      }

      const convertEl = (el: Element): SimpleDomNode => {
        const attributes: Record<string, string> = {};
        for (let i = 0; i < el.attributes.length; i++) {
          const attr = el.attributes[i];
          attributes[attr.name] = attr.value;
        }
        const children: SimpleDomNode[] = [];
        for (let i = 0; i < el.children.length; i++) {
          children.push(convertEl(el.children[i]));
        }
        return {
          tagName: el.tagName.replace(/^.*:/, ''),
          attributes,
          children,
        };
      };

      return { root: convertEl(svgEl), innerSvg };
    } catch {
      return { root: null, innerSvg: '', error: 'INVALID_SVG_XML' };
    }
  }

  // Fallback lightweight XML tokenizer for Node.js unit test environment
  const cleanedXml = trimmed
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<\?[\s\S]*?\?>/g, '')
    .replace(/<!DOCTYPE[^>]*>/gi, '');

  const stack: SimpleDomNode[] = [];
  let root: SimpleDomNode | null = null;
  const tagRegex = /<\/?([a-zA-Z0-9:_-]+)([^>]*?)(\/?)>/g;
  let match: RegExpExecArray | null;

  while ((match = tagRegex.exec(cleanedXml)) !== null) {
    const fullMatch = match[0];
    const isClosing = fullMatch.startsWith('</');
    const rawTag = match[1].replace(/^.*:/, '');
    const attrString = match[2] || '';
    const isSelfClosing = match[3] === '/' || fullMatch.endsWith('/>');

    if (isClosing) {
      if (stack.length === 0) {
        return { root: null, innerSvg: '', error: 'INVALID_SVG_XML' };
      }
      const popped = stack.pop()!;
      if (popped.tagName.toLowerCase() !== rawTag.toLowerCase()) {
        return { root: null, innerSvg: '', error: 'INVALID_SVG_XML' };
      }
    } else {
      const attributes: Record<string, string> = {};
      const attrRegex = /([a-zA-Z0-9:_-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
      let aMatch: RegExpExecArray | null;
      while ((aMatch = attrRegex.exec(attrString)) !== null) {
        attributes[aMatch[1]] = aMatch[2] !== undefined ? aMatch[2] : aMatch[3] || '';
      }

      const node: SimpleDomNode = {
        tagName: rawTag,
        attributes,
        children: [],
      };

      if (stack.length > 0) {
        stack[stack.length - 1].children.push(node);
      } else if (!root) {
        root = node;
      }

      if (!isSelfClosing) {
        stack.push(node);
      }
    }
  }

  if (!root || root.tagName.toLowerCase() !== 'svg' || stack.length !== 0) {
    return { root: null, innerSvg: '', error: 'INVALID_SVG_XML' };
  }

  return { root, innerSvg };
}

interface DrawSeg {
  type: 'L' | 'C' | 'Q';
  fromX: number;
  fromY: number;
  x1?: number;
  y1?: number;
  x2?: number;
  y2?: number;
  toX: number;
  toY: number;
}

function extractContoursFromSvgPath(sp: ReturnType<typeof svgpath>): PathCommand[][] {
  const contours: PathCommand[][] = [];
  let current: PathCommand[] = [];
  let startX = 0;
  let startY = 0;
  let curX = 0;
  let curY = 0;

  const flushContour = () => {
    if (current.length > 1) {
      if (current[current.length - 1].type !== 'Z') {
        current.push({ type: 'Z' });
      }
      contours.push(current);
    }
    current = [];
  };

  for (const seg of sp.segments) {
    const cmd = seg[0];
    if (cmd === 'M') {
      flushContour();
      curX = Number(seg[1]);
      curY = Number(seg[2]);
      startX = curX;
      startY = curY;
      current.push({ type: 'M', x: curX, y: curY });
    } else if (cmd === 'L') {
      curX = Number(seg[1]);
      curY = Number(seg[2]);
      current.push({ type: 'L', x: curX, y: curY });
    } else if (cmd === 'H') {
      curX = Number(seg[1]);
      current.push({ type: 'L', x: curX, y: curY });
    } else if (cmd === 'V') {
      curY = Number(seg[1]);
      current.push({ type: 'L', x: curX, y: curY });
    } else if (cmd === 'C') {
      const x1 = Number(seg[1]);
      const y1 = Number(seg[2]);
      const x2 = Number(seg[3]);
      const y2 = Number(seg[4]);
      curX = Number(seg[5]);
      curY = Number(seg[6]);
      current.push({ type: 'C', x1, y1, x2, y2, x: curX, y: curY });
    } else if (cmd === 'Q') {
      const x1 = Number(seg[1]);
      const y1 = Number(seg[2]);
      curX = Number(seg[3]);
      curY = Number(seg[4]);
      current.push({ type: 'Q', x1, y1, x: curX, y: curY });
    } else if (cmd === 'Z' || cmd === 'z') {
      curX = startX;
      curY = startY;
      current.push({ type: 'Z' });
      flushContour();
    }
  }
  flushContour();
  return contours;
}

function sampleContourPolygon(commands: PathCommand[]): Array<{ x: number; y: number }> {
  const pts: Array<{ x: number; y: number }> = [];
  let curX = 0;
  let curY = 0;
  let startX = 0;
  let startY = 0;

  for (const cmd of commands) {
    if (cmd.type === 'M' && cmd.x !== undefined && cmd.y !== undefined) {
      curX = cmd.x;
      curY = cmd.y;
      startX = curX;
      startY = curY;
      pts.push({ x: curX, y: curY });
    } else if (cmd.type === 'L' && cmd.x !== undefined && cmd.y !== undefined) {
      curX = cmd.x;
      curY = cmd.y;
      pts.push({ x: curX, y: curY });
    } else if (
      cmd.type === 'Q' &&
      cmd.x1 !== undefined &&
      cmd.y1 !== undefined &&
      cmd.x !== undefined &&
      cmd.y !== undefined
    ) {
      const steps = 8;
      for (let i = 1; i <= steps; i++) {
        const t = i / steps;
        const mt = 1 - t;
        const px = mt * mt * curX + 2 * mt * t * cmd.x1 + t * t * cmd.x;
        const py = mt * mt * curY + 2 * mt * t * cmd.y1 + t * t * cmd.y;
        pts.push({ x: px, y: py });
      }
      curX = cmd.x;
      curY = cmd.y;
    } else if (
      cmd.type === 'C' &&
      cmd.x1 !== undefined &&
      cmd.y1 !== undefined &&
      cmd.x2 !== undefined &&
      cmd.y2 !== undefined &&
      cmd.x !== undefined &&
      cmd.y !== undefined
    ) {
      const steps = 10;
      for (let i = 1; i <= steps; i++) {
        const t = i / steps;
        const mt = 1 - t;
        const px =
          mt * mt * mt * curX +
          3 * mt * mt * t * cmd.x1 +
          3 * mt * t * t * cmd.x2 +
          t * t * t * cmd.x;
        const py =
          mt * mt * mt * curY +
          3 * mt * mt * t * cmd.y1 +
          3 * mt * t * t * cmd.y2 +
          t * t * t * cmd.y;
        pts.push({ x: px, y: py });
      }
      curX = cmd.x;
      curY = cmd.y;
    } else if (cmd.type === 'Z') {
      if (Math.hypot(curX - startX, curY - startY) > 1e-3) {
        pts.push({ x: startX, y: startY });
      }
      curX = startX;
      curY = startY;
    }
  }
  return pts;
}

function computePolygonSignedArea(pts: Array<{ x: number; y: number }>): number {
  if (pts.length < 3) return 0;
  let area = 0;
  for (let i = 0; i < pts.length; i++) {
    const p1 = pts[i];
    const p2 = pts[(i + 1) % pts.length];
    area += p1.x * p2.y - p2.x * p1.y;
  }
  return area * 0.5;
}

function isPointInPolygon(pt: { x: number; y: number }, poly: Array<{ x: number; y: number }>): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x;
    const yi = poly[i].y;
    const xj = poly[j].x;
    const yj = poly[j].y;

    const intersect =
      yi > pt.y !== yj > pt.y &&
      pt.x < ((xj - xi) * (pt.y - yi)) / (yj - yi + 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

export function reverseContourCommands(commands: PathCommand[]): PathCommand[] {
  if (commands.length === 0) return commands;
  const first = commands[0];
  if (first.type !== 'M' || first.x === undefined || first.y === undefined) return commands;

  const segs: DrawSeg[] = [];
  let curX = first.x;
  let curY = first.y;
  const startX = first.x;
  const startY = first.y;

  for (let i = 1; i < commands.length; i++) {
    const cmd = commands[i];
    if (cmd.type === 'L' && cmd.x !== undefined && cmd.y !== undefined) {
      segs.push({ type: 'L', fromX: curX, fromY: curY, toX: cmd.x, toY: cmd.y });
      curX = cmd.x;
      curY = cmd.y;
    } else if (
      cmd.type === 'Q' &&
      cmd.x1 !== undefined &&
      cmd.y1 !== undefined &&
      cmd.x !== undefined &&
      cmd.y !== undefined
    ) {
      segs.push({
        type: 'Q',
        fromX: curX,
        fromY: curY,
        x1: cmd.x1,
        y1: cmd.y1,
        toX: cmd.x,
        toY: cmd.y,
      });
      curX = cmd.x;
      curY = cmd.y;
    } else if (
      cmd.type === 'C' &&
      cmd.x1 !== undefined &&
      cmd.y1 !== undefined &&
      cmd.x2 !== undefined &&
      cmd.y2 !== undefined &&
      cmd.x !== undefined &&
      cmd.y !== undefined
    ) {
      segs.push({
        type: 'C',
        fromX: curX,
        fromY: curY,
        x1: cmd.x1,
        y1: cmd.y1,
        x2: cmd.x2,
        y2: cmd.y2,
        toX: cmd.x,
        toY: cmd.y,
      });
      curX = cmd.x;
      curY = cmd.y;
    }
  }

  if (Math.hypot(curX - startX, curY - startY) > 1e-4) {
    segs.push({ type: 'L', fromX: curX, fromY: curY, toX: startX, toY: startY });
  }

  if (segs.length === 0) return commands;

  const reversed: PathCommand[] = [];
  const lastSeg = segs[segs.length - 1];
  reversed.push({ type: 'M', x: lastSeg.toX, y: lastSeg.toY });

  for (let i = segs.length - 1; i >= 0; i--) {
    const s = segs[i];
    if (s.type === 'L') {
      reversed.push({ type: 'L', x: s.fromX, y: s.fromY });
    } else if (s.type === 'Q') {
      reversed.push({ type: 'Q', x1: s.x1, y1: s.y1, x: s.fromX, y: s.fromY });
    } else if (s.type === 'C') {
      reversed.push({
        type: 'C',
        x1: s.x2,
        y1: s.y2,
        x2: s.x1,
        y2: s.y1,
        x: s.fromX,
        y: s.fromY,
      });
    }
  }
  reversed.push({ type: 'Z' });
  return reversed;
}

export function normalizeContoursAndHoles(rawContours: PathCommand[][]): NormalizedContour[] {
  const analyzed = rawContours
    .map((commands) => {
      const poly = sampleContourPolygon(commands);
      const area = computePolygonSignedArea(poly);
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const pt of poly) {
        if (pt.x < minX) minX = pt.x;
        if (pt.y < minY) minY = pt.y;
        if (pt.x > maxX) maxX = pt.x;
        if (pt.y > maxY) maxY = pt.y;
      }
      return {
        commands,
        poly,
        area,
        absArea: Math.abs(area),
        bbox: {
          minX: Number.isFinite(minX) ? minX : 0,
          minY: Number.isFinite(minY) ? minY : 0,
          maxX: Number.isFinite(maxX) ? maxX : 0,
          maxY: Number.isFinite(maxY) ? maxY : 0,
        },
      };
    })
    .filter((c) => c.poly.length >= 3 && c.absArea > 0.05);

  return analyzed.map((item, idx) => {
    const testPt = item.poly[0];
    let enclosingCount = 0;
    for (let j = 0; j < analyzed.length; j++) {
      if (j === idx) continue;
      const other = analyzed[j];
      if (other.absArea <= item.absArea) continue;
      if (
        testPt.x < other.bbox.minX ||
        testPt.x > other.bbox.maxX ||
        testPt.y < other.bbox.minY ||
        testPt.y > other.bbox.maxY
      ) {
        continue;
      }
      if (isPointInPolygon(testPt, other.poly)) {
        enclosingCount++;
      }
    }

    const isHole = enclosingCount % 2 === 1;
    const needsReverse = (!isHole && item.area < 0) || (isHole && item.area > 0);
    const finalCommands = needsReverse ? reverseContourCommands(item.commands) : item.commands;
    const finalArea = needsReverse ? -item.area : item.area;

    return {
      commands: finalCommands,
      isHole,
      signedArea: finalArea,
      bbox: item.bbox,
    };
  });
}

export function commandsToSvgPathD(contours: NormalizedContour[]): string {
  const parts: string[] = [];
  for (const contour of contours) {
    for (const c of contour.commands) {
      if (c.type === 'M') parts.push(`M ${Number(c.x?.toFixed(2))} ${Number(c.y?.toFixed(2))}`);
      else if (c.type === 'L') parts.push(`L ${Number(c.x?.toFixed(2))} ${Number(c.y?.toFixed(2))}`);
      else if (c.type === 'Q') {
        parts.push(
          `Q ${Number(c.x1?.toFixed(2))} ${Number(c.y1?.toFixed(2))} ${Number(c.x?.toFixed(2))} ${Number(c.y?.toFixed(2))}`
        );
      } else if (c.type === 'C') {
        parts.push(
          `C ${Number(c.x1?.toFixed(2))} ${Number(c.y1?.toFixed(2))} ${Number(c.x2?.toFixed(2))} ${Number(c.y2?.toFixed(2))} ${Number(c.x?.toFixed(2))} ${Number(c.y?.toFixed(2))}`
        );
      } else if (c.type === 'Z') {
        parts.push('Z');
      }
    }
  }
  return parts.join(' ');
}

export function parseAndValidateSvgOutline(svgString: string): ParsedSvgResult {
  const emptyResult: ParsedSvgResult = {
    valid: false,
    viewBox: [0, 0, 100, 100],
    innerSvg: '',
    normalizedSvgPathD: '',
    contoursInSvgSpace: [],
    ignoredElements: [],
    hasStrokeWarning: false,
    hasUnexpandedStrokes: false,
    strokeOnlyCount: 0,
    filledShapeCount: 0,
  };

  if (!svgString || typeof svgString !== 'string' || !svgString.trim()) {
    return { ...emptyResult, error: 'EMPTY_SVG' };
  }

  if (svgString.length > MAX_SVG_BYTES) {
    return { ...emptyResult, error: 'HUGE_SVG_FILE' };
  }

  const parsedTree = parseSvgXmlTree(svgString);
  if (!parsedTree.root) {
    return { ...emptyResult, error: parsedTree.error || 'INVALID_SVG_TAG' };
  }

  const root = parsedTree.root;

  let viewBox: [number, number, number, number] = [0, 0, 100, 100];
  const vbRaw = root.attributes.viewBox || root.attributes.viewbox;
  if (vbRaw) {
    const parts = vbRaw
      .trim()
      .split(/[\s,]+/)
      .map(Number);
    if (parts.length === 4 && parts.every((n) => Number.isFinite(n)) && parts[2] > 0 && parts[3] > 0) {
      viewBox = [parts[0], parts[1], parts[2], parts[3]];
    }
  } else {
    const w = parseNumber(root.attributes.width, 100);
    const h = parseNumber(root.attributes.height, 100);
    if (w > 0 && h > 0) {
      viewBox = [0, 0, w, h];
    }
  }

  const ignoredSet = new Set<string>();
  const rawContours: PathCommand[][] = [];
  let strokeOnlyCount = 0;
  let filledShapeCount = 0;
  let strokedFilledCount = 0;

  const walk = (
    node: SimpleDomNode,
    accumulatedTransform: string,
    inheritedAttrs: Record<string, string>
  ) => {
    const tagLower = node.tagName.toLowerCase();
    const inlineStyle = parseInlineStyle(node.attributes.style);

    const display = getEffectiveAttr(node, inlineStyle, inheritedAttrs, 'display');
    const visibility = getEffectiveAttr(node, inlineStyle, inheritedAttrs, 'visibility');
    const opacity = getEffectiveAttr(node, inlineStyle, inheritedAttrs, 'opacity');
    if (
      display === 'none' ||
      visibility === 'hidden' ||
      visibility === 'collapse' ||
      opacity === '0'
    ) {
      ignoredSet.add('hidden element');
      return;
    }

    if (UNSUPPORTED_TAGS.has(node.tagName) || UNSUPPORTED_TAGS.has(tagLower)) {
      ignoredSet.add(`<${node.tagName}>`);
      return;
    }

    if (CONTAINER_SKIP_TAGS.has(tagLower)) {
      return;
    }

    const ownTransform = (node.attributes.transform || '').trim();
    const nextTransform = [accumulatedTransform, ownTransform].filter(Boolean).join(' ');

    const nextInherited: Record<string, string> = {
      ...inheritedAttrs,
    };
    for (const key of ['fill', 'stroke', 'stroke-width', 'fill-rule', 'clip-rule']) {
      const v = getEffectiveAttr(node, inlineStyle, inheritedAttrs, key);
      if (v !== undefined) nextInherited[key] = v;
    }

    if (DRAWABLE_TAGS.has(tagLower)) {
      const d = shapeToPathD(tagLower, node.attributes);
      if (!d) return;

      const fillVal = (nextInherited.fill ?? 'currentColor').trim().toLowerCase();
      const strokeVal = (nextInherited.stroke ?? 'none').trim().toLowerCase();
      const strokeWidth = parseNumber(nextInherited['stroke-width'], 1);

      const hasFill =
        tagLower !== 'line' &&
        fillVal !== 'none' &&
        fillVal !== 'transparent' &&
        fillVal !== 'rgba(0,0,0,0)';
      const hasStroke =
        strokeVal !== 'none' &&
        strokeVal !== 'transparent' &&
        strokeWidth > 0;

      if (hasStroke && !hasFill) {
        strokeOnlyCount++;
        return;
      }

      if (hasFill) {
        filledShapeCount++;
        if (hasStroke) {
          strokedFilledCount++;
        }

        try {
          let sp = svgpath(d);
          if (nextTransform) {
            sp = sp.transform(nextTransform);
          }
          sp = sp.abs().unarc().unshort();
          const extracted = extractContoursFromSvgPath(sp);
          rawContours.push(...extracted);
        } catch {
          // Malformed path segment
        }
      }
      return;
    }

    for (const child of node.children) {
      walk(child, nextTransform, nextInherited);
    }
  };

  walk(root, '', {});

  if (filledShapeCount === 0 && strokeOnlyCount > 0) {
    return {
      ...emptyResult,
      viewBox,
      innerSvg: parsedTree.innerSvg,
      ignoredElements: Array.from(ignoredSet),
      hasStrokeWarning: true,
      hasUnexpandedStrokes: true,
      strokeOnlyCount,
      filledShapeCount: 0,
      error: 'STROKE_ONLY_SVG',
    };
  }

  const normalizedContours = normalizeContoursAndHoles(rawContours);
  if (normalizedContours.length === 0) {
    return {
      ...emptyResult,
      viewBox,
      innerSvg: parsedTree.innerSvg,
      ignoredElements: Array.from(ignoredSet),
      strokeOnlyCount,
      filledShapeCount,
      error: 'NO_VECTOR_PATHS',
    };
  }

  const normalizedSvgPathD = commandsToSvgPathD(normalizedContours);

  return {
    valid: true,
    viewBox,
    innerSvg: parsedTree.innerSvg,
    normalizedSvgPathD,
    contoursInSvgSpace: normalizedContours,
    ignoredElements: Array.from(ignoredSet),
    hasStrokeWarning: strokeOnlyCount > 0 || strokedFilledCount > 0,
    hasUnexpandedStrokes: false,
    strokeOnlyCount,
    filledShapeCount,
  };
}

export function buildGlyphFontOutline(
  contoursInSvgSpace: NormalizedContour[],
  viewBox: [number, number, number, number],
  metrics: GlyphMetricsInput
): TransformedFontOutline {
  const [vx, vy, vw, vh] = viewBox;
  const baseScale = 1000 / (vh > 0 ? vh : 100);
  const centerSvgX = (vw > 0 ? vw : 100) * 0.5 * baseScale;
  const baselineSvgY = 800;

  const toEditorSvgPoint = (rawX: number, rawY: number) => {
    const normX = (rawX - vx) * baseScale;
    const normY = (rawY - vy) * baseScale;
    const sx = centerSvgX + (normX - centerSvgX) * metrics.scale + metrics.offsetX;
    const sy = baselineSvgY + (normY - baselineSvgY) * metrics.scale + metrics.offsetY;
    return { x: sx, y: sy };
  };

  const editorContours: NormalizedContour[] = contoursInSvgSpace.map((c) => {
    const cmds: PathCommand[] = c.commands.map((cmd) => {
      if (cmd.type === 'M' || cmd.type === 'L') {
        const p = toEditorSvgPoint(cmd.x!, cmd.y!);
        return { type: cmd.type, x: p.x, y: p.y };
      }
      if (cmd.type === 'Q') {
        const p1 = toEditorSvgPoint(cmd.x1!, cmd.y1!);
        const p = toEditorSvgPoint(cmd.x!, cmd.y!);
        return { type: 'Q', x1: p1.x, y1: p1.y, x: p.x, y: p.y };
      }
      if (cmd.type === 'C') {
        const p1 = toEditorSvgPoint(cmd.x1!, cmd.y1!);
        const p2 = toEditorSvgPoint(cmd.x2!, cmd.y2!);
        const p = toEditorSvgPoint(cmd.x!, cmd.y!);
        return { type: 'C', x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y, x: p.x, y: p.y };
      }
      return { type: 'Z' };
    });
    return {
      ...c,
      commands: cmds,
    };
  });

  const editorPathD = commandsToSvgPathD(editorContours);

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  const trackPoint = (x: number, y: number) => {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  };

  const flippedContours = editorContours.map((c) => {
    const cmds: PathCommand[] = c.commands.map((cmd) => {
      if (cmd.type === 'M' || cmd.type === 'L') {
        const fx = cmd.x!;
        const fy = 800 - cmd.y!;
        trackPoint(fx, fy);
        return { type: cmd.type, x: fx, y: fy };
      }
      if (cmd.type === 'Q') {
        const fx1 = cmd.x1!;
        const fy1 = 800 - cmd.y1!;
        const fx = cmd.x!;
        const fy = 800 - cmd.y!;
        trackPoint(fx1, fy1);
        trackPoint(fx, fy);
        return { type: 'Q', x1: fx1, y1: fy1, x: fx, y: fy };
      }
      if (cmd.type === 'C') {
        const fx1 = cmd.x1!;
        const fy1 = 800 - cmd.y1!;
        const fx2 = cmd.x2!;
        const fy2 = 800 - cmd.y2!;
        const fx = cmd.x!;
        const fy = 800 - cmd.y!;
        trackPoint(fx1, fy1);
        trackPoint(fx2, fy2);
        trackPoint(fx, fy);
        return { type: 'C', x1: fx1, y1: fy1, x2: fx2, y2: fy2, x: fx, y: fy };
      }
      return { type: 'Z' };
    });
    return { ...c, commands: cmds };
  });

  if (!Number.isFinite(minX)) {
    minX = 0;
    maxX = 500;
    minY = 0;
    maxY = 700;
  }

  const scaledGlyphWidth = Math.max(1, maxX - minX);
  const shiftX = metrics.leftBearing - minX;
  const advanceWidth = Math.max(
    50,
    Math.min(3000, Math.round(metrics.leftBearing + scaledGlyphWidth + metrics.rightBearing))
  );

  let clampedWarning = false;
  const clampCoord = (val: number, minLim: number, maxLim: number): number => {
    const rounded = Math.round(val);
    if (rounded < minLim) {
      clampedWarning = true;
      return minLim;
    }
    if (rounded > maxLim) {
      clampedWarning = true;
      return maxLim;
    }
    return rounded;
  };

  let finalMinX = Infinity;
  let finalMinY = Infinity;
  let finalMaxX = -Infinity;
  let finalMaxY = -Infinity;

  const trackFinal = (x: number, y: number) => {
    if (x < finalMinX) finalMinX = x;
    if (y < finalMinY) finalMinY = y;
    if (x > finalMaxX) finalMaxX = x;
    if (y > finalMaxY) finalMaxY = y;
  };

  const finalCommands: PathCommand[] = [];
  const finalContours: NormalizedContour[] = flippedContours.map((c) => {
    const cmds: PathCommand[] = c.commands.map((cmd) => {
      if (cmd.type === 'M' || cmd.type === 'L') {
        const x = clampCoord(cmd.x! + shiftX, -1500, 3500);
        const y = clampCoord(cmd.y!, -1200, 2200);
        trackFinal(x, y);
        return { type: cmd.type, x, y };
      }
      if (cmd.type === 'Q') {
        const x1 = clampCoord(cmd.x1! + shiftX, -1500, 3500);
        const y1 = clampCoord(cmd.y1!, -1200, 2200);
        const x = clampCoord(cmd.x! + shiftX, -1500, 3500);
        const y = clampCoord(cmd.y!, -1200, 2200);
        trackFinal(x, y);
        return { type: 'Q', x1, y1, x, y };
      }
      if (cmd.type === 'C') {
        const x1 = clampCoord(cmd.x1! + shiftX, -1500, 3500);
        const y1 = clampCoord(cmd.y1!, -1200, 2200);
        const x2 = clampCoord(cmd.x2! + shiftX, -1500, 3500);
        const y2 = clampCoord(cmd.y2!, -1200, 2200);
        const x = clampCoord(cmd.x! + shiftX, -1500, 3500);
        const y = clampCoord(cmd.y!, -1200, 2200);
        trackFinal(x, y);
        return { type: 'C', x1, y1, x2, y2, x, y };
      }
      return { type: 'Z' };
    });
    finalCommands.push(...cmds);
    return {
      ...c,
      commands: cmds,
    };
  });

  if (finalMinY < -400 || finalMaxY > 1200 || finalMaxX > 2000) {
    clampedWarning = true;
  }

  return {
    commands: finalCommands,
    contours: finalContours,
    contourCount: finalContours.length,
    advanceWidth,
    bbox: {
      minX: Number.isFinite(finalMinX) ? finalMinX : 0,
      minY: Number.isFinite(finalMinY) ? finalMinY : 0,
      maxX: Number.isFinite(finalMaxX) ? finalMaxX : 0,
      maxY: Number.isFinite(finalMaxY) ? finalMaxY : 0,
    },
    clampedWarning,
    editorPathD,
  };
}
