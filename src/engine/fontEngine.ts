import {
  parseAndValidateSvgOutline,
  buildGlyphFontOutline,
  NormalizedContour,
  ParsedSvgResult,
} from './svgOutlineParser';
import {
  compileAndValidateFont,
  CompilerGlyphInput,
  FontValidationReport,
  GlyphDiagnosticRow,
} from './fontCompiler';
import type { FontWorkerRequest, FontWorkerResponse } from './fontWorker';

export type { FontValidationReport, GlyphDiagnosticRow };

export interface GlyphMetrics {
  offsetX: number;      // Horizontal shift dx in 1000-UPM units (-200 to +200)
  offsetY: number;      // Vertical shift dy in 1000-UPM units (-200 to +200)
  scale: number;        // Scale multiplier (0.4 to 2.0, default 1.0)
  leftBearing: number;  // Left side-bearing in 1000-UPM units (-50 to +200, default 45)
  rightBearing: number; // Right side-bearing in 1000-UPM units (-50 to +200, default 45)
}

export interface GlyphData {
  char: string;
  codePoint: number;
  svgString: string;
  innerSvg: string;
  normalizedSvgPathD: string;
  editorPathD: string;
  contoursInSvgSpace: NormalizedContour[];
  contourCount: number;
  advanceWidth: number;
  bbox: { minX: number; minY: number; maxX: number; maxY: number };
  viewBox: [number, number, number, number];
  metrics: GlyphMetrics;
  ignoredElements: string[];
  hasStrokeWarning: boolean;
  clampedWarning: boolean;
  updatedAt: number;
  fileName?: string;
}

export interface GlyphResult {
  success: boolean;
  char: string;
  glyph?: GlyphData;
  error?: string;
  warnings?: string[];
  ignoredElements?: string[];
  hasStrokeWarning?: boolean;
  hasUnexpandedStrokes?: boolean;
  clampedWarning?: boolean;
}

export interface FontMetadata {
  fontName: string;
  designerName: string;
  version: string;
  license: string;
  description?: string;
}

export interface PreviewGlyphToken {
  id: string;
  char: string;
  codePoint: number;
  isSpace: boolean;
  isNewline: boolean;
  hasSvg: boolean; // True when character exists in the compiled font cmap
  glyph?: GlyphData;
  advanceWidth: number;
  advanceRatio: number;
}

export interface BuildFontDetailedResult {
  ttfBlob: Blob;
  woffBlob: Blob;
  ttfBuffer: ArrayBuffer;
  woffBuffer: ArrayBuffer;
  validation: FontValidationReport;
  includedChars: string[];
  missingChars: string[];
}

export const DEFAULT_GLYPH_METRICS: GlyphMetrics = {
  offsetX: 0,
  offsetY: 0,
  scale: 1,
  leftBearing: 45,
  rightBearing: 45,
};

/**
 * Full 62 core alphanumeric characters + 12 common punctuation marks (74 total)
 */
export const GLYPH_CATEGORIES = {
  uppercase: Array.from('ABCDEFGHIJKLMNOPQRSTUVWXYZ'),
  lowercase: Array.from('abcdefghijklmnopqrstuvwxyz'),
  digits: Array.from('0123456789'),
  punctuation: ['!', '?', '.', ',', '-', '_', '@', '#', '&', '(', ')', '/'],
};

export const CORE_62_CHARS: string[] = [
  ...GLYPH_CATEGORIES.uppercase,
  ...GLYPH_CATEGORIES.lowercase,
  ...GLYPH_CATEGORIES.digits,
];

export const ALL_SUPPORTED_CHARS: string[] = [
  ...CORE_62_CHARS,
  ...GLYPH_CATEGORIES.punctuation,
];

export function parseAndValidateSvg(svgString: string): ParsedSvgResult {
  return parseAndValidateSvgOutline(svgString);
}

/**
 * Matches an uploaded filename to its target character.
 * Case-sensitive for single letters: "A.svg" -> "A", "a.svg" -> "a".
 * Also supports descriptive names like "upper-A.svg", "lower_a.svg", "U+0048.svg", "exclamation.svg".
 */
export function matchFilenameToChar(filename: string): string | null {
  if (!filename) return null;
  const base = filename.replace(/\.svg$/i, '').trim();
  if (!base) return null;

  if (base.length === 1 && ALL_SUPPORTED_CHARS.includes(base)) {
    return base;
  }

  const namedMap: Record<string, string> = {
    exclamation: '!',
    exclam: '!',
    bang: '!',
    question: '?',
    period: '.',
    dot: '.',
    fullstop: '.',
    comma: ',',
    hyphen: '-',
    dash: '-',
    minus: '-',
    underscore: '_',
    at: '@',
    hash: '#',
    numbersign: '#',
    pound: '#',
    ampersand: '&',
    and: '&',
    lparen: '(',
    parenleft: '(',
    rparen: ')',
    parenright: ')',
    slash: '/',
  };

  const lower = base.toLowerCase();
  if (namedMap[lower]) {
    return namedMap[lower];
  }

  const upperMatch = base.match(/^(?:upper|cap|capital)[-_ ]?([A-Za-z])$/i);
  if (upperMatch) {
    return upperMatch[1].toUpperCase();
  }
  const lowerMatch = base.match(/^(?:lower|small)[-_ ]?([A-Za-z])$/i);
  if (lowerMatch) {
    return lowerMatch[1].toLowerCase();
  }

  const prefixMatch = base.match(/^(?:glyph|char|letter|digit)[-_ ](.)$/i);
  if (prefixMatch && ALL_SUPPORTED_CHARS.includes(prefixMatch[1])) {
    return prefixMatch[1];
  }

  const hexMatch = base.match(/^(?:u\+|uni|u)([0-9a-fA-F]{4,6})$/i);
  if (hexMatch) {
    const cp = parseInt(hexMatch[1], 16);
    if (Number.isFinite(cp) && cp > 0) {
      const ch = String.fromCodePoint(cp);
      if (ALL_SUPPORTED_CHARS.includes(ch)) {
        return ch;
      }
    }
  }

  return null;
}

class RealVectorFontEngine {
  private glyphs: Map<string, GlyphData> = new Map();
  private worker: Worker | null = null;
  private workerCallbacks: Map<
    string,
    {
      onProgress?: (percent: number, stageKey: string) => void;
      resolve: (res: BuildFontDetailedResult) => void;
      reject: (err: Error) => void;
    }
  > = new Map();
  private lastDetailedResult: BuildFontDetailedResult | null = null;
  private activeFontFace: FontFace | null = null;
  private compiledCmapChars: Set<string> = new Set();

  private getOrInitWorker(): Worker | null {
    if (typeof window === 'undefined' || typeof Worker === 'undefined') {
      return null;
    }
    if (!this.worker) {
      try {
        this.worker = new Worker(new URL('./fontWorker.ts', import.meta.url), {
          type: 'module',
        });
        this.worker.onmessage = (event: MessageEvent<FontWorkerResponse>) => {
          const msg = event.data;
          const handler = this.workerCallbacks.get(msg.id);
          if (!handler) return;

          if (msg.type === 'progress') {
            handler.onProgress?.(msg.percent, msg.stageKey);
          } else if (msg.type === 'success') {
            this.workerCallbacks.delete(msg.id);
            const ttfBlob = new Blob([msg.ttfBuffer], { type: 'font/ttf' });
            const woffBlob = new Blob([msg.woffBuffer], { type: 'font/woff' });
            const detailed: BuildFontDetailedResult = {
              ttfBlob,
              woffBlob,
              ttfBuffer: msg.ttfBuffer,
              woffBuffer: msg.woffBuffer,
              validation: msg.validation,
              includedChars: msg.validation.includedChars,
              missingChars: msg.validation.missingSupportedChars,
            };
            this.lastDetailedResult = detailed;
            this.compiledCmapChars = new Set(msg.validation.includedChars);
            handler.resolve(detailed);
          } else if (msg.type === 'error') {
            this.workerCallbacks.delete(msg.id);
            const err = new Error(msg.error);
            (err as Error & { validation?: FontValidationReport }).validation = msg.validation;
            handler.reject(err);
          }
        };
        this.worker.onerror = (err) => {
          for (const [, cb] of this.workerCallbacks.entries()) {
            cb.reject(new Error(`WORKER_FAILURE: ${err.message || 'Web Worker error'}`));
          }
          this.workerCallbacks.clear();
        };
      } catch {
        this.worker = null;
      }
    }
    return this.worker;
  }

  private createGlyphData(
    char: string,
    svgString: string,
    parsed: ParsedSvgResult,
    metricsInput?: Partial<GlyphMetrics>,
    fileName?: string
  ): GlyphData {
    const existing = this.glyphs.get(char);
    const metrics: GlyphMetrics = {
      ...DEFAULT_GLYPH_METRICS,
      ...(existing?.metrics || {}),
      ...(metricsInput || {}),
    };

    const transformed = buildGlyphFontOutline(
      parsed.contoursInSvgSpace,
      parsed.viewBox,
      metrics
    );

    return {
      char,
      codePoint: char.charCodeAt(0),
      svgString: svgString.trim(),
      innerSvg: parsed.innerSvg,
      normalizedSvgPathD: parsed.normalizedSvgPathD,
      editorPathD: transformed.editorPathD,
      contoursInSvgSpace: parsed.contoursInSvgSpace,
      contourCount: transformed.contourCount,
      advanceWidth: transformed.advanceWidth,
      bbox: transformed.bbox,
      viewBox: parsed.viewBox,
      metrics,
      ignoredElements: parsed.ignoredElements,
      hasStrokeWarning: parsed.hasStrokeWarning,
      clampedWarning: transformed.clampedWarning,
      updatedAt: Date.now(),
      fileName: fileName || existing?.fileName || `${char}.svg`,
    };
  }

  async addGlyph(
    char: string,
    svgString: string,
    options?: {
      fileName?: string;
      metrics?: Partial<GlyphMetrics>;
      ignoreStrokes?: boolean;
      allowIgnoreStrokes?: boolean;
    }
  ): Promise<GlyphResult> {
    if (!char || char.length !== 1) {
      return {
        success: false,
        char: char || '',
        error: 'INVALID_CHAR',
      };
    }

    const parsed = parseAndValidateSvgOutline(svgString);
    if (!parsed.valid) {
      return {
        success: false,
        char,
        error: parsed.error || 'INVALID_SVG',
        ignoredElements: parsed.ignoredElements,
        hasStrokeWarning: parsed.hasStrokeWarning,
        hasUnexpandedStrokes: parsed.hasUnexpandedStrokes,
      };
    }

    const allowStrokes = Boolean(options?.ignoreStrokes || options?.allowIgnoreStrokes);
    if (parsed.hasStrokeWarning && !allowStrokes) {
      return {
        success: false,
        char,
        error: 'STROKE_WARNING_CONFIRM_REQUIRED',
        ignoredElements: parsed.ignoredElements,
        hasStrokeWarning: true,
        hasUnexpandedStrokes: false,
      };
    }

    const glyphData = this.createGlyphData(
      char,
      svgString,
      parsed,
      options?.metrics,
      options?.fileName
    );

    this.glyphs.set(char, glyphData);
    const warnings: string[] = [];
    if (glyphData.clampedWarning) {
      warnings.push('CLAMPED_EXTREME_COORDS');
    }

    return {
      success: true,
      char,
      glyph: glyphData,
      warnings,
      ignoredElements: glyphData.ignoredElements,
      hasStrokeWarning: glyphData.hasStrokeWarning,
      clampedWarning: glyphData.clampedWarning,
    };
  }

  addGlyphSync(
    char: string,
    svgString: string,
    metrics?: Partial<GlyphMetrics>,
    fileName?: string
  ): GlyphResult {
    if (!char || char.length !== 1) {
      return {
        success: false,
        char: char || '',
        error: 'INVALID_CHAR',
      };
    }

    const parsed = parseAndValidateSvgOutline(svgString);
    if (!parsed.valid) {
      return {
        success: false,
        char,
        error: parsed.error || 'INVALID_SVG',
        ignoredElements: parsed.ignoredElements,
        hasStrokeWarning: parsed.hasStrokeWarning,
        hasUnexpandedStrokes: parsed.hasUnexpandedStrokes,
      };
    }

    const glyphData = this.createGlyphData(char, svgString, parsed, metrics, fileName);
    this.glyphs.set(char, glyphData);
    return {
      success: true,
      char,
      glyph: glyphData,
      ignoredElements: glyphData.ignoredElements,
      hasStrokeWarning: glyphData.hasStrokeWarning,
      clampedWarning: glyphData.clampedWarning,
    };
  }

  removeGlyph(char: string): boolean {
    return this.glyphs.delete(char);
  }

  updateGlyphMetrics(char: string, partialMetrics: Partial<GlyphMetrics>): GlyphData | null {
    const existing = this.glyphs.get(char);
    if (!existing) return null;

    const nextMetrics: GlyphMetrics = {
      ...existing.metrics,
      ...partialMetrics,
    };

    const transformed = buildGlyphFontOutline(
      existing.contoursInSvgSpace,
      existing.viewBox,
      nextMetrics
    );

    const updated: GlyphData = {
      ...existing,
      metrics: nextMetrics,
      editorPathD: transformed.editorPathD,
      contourCount: transformed.contourCount,
      advanceWidth: transformed.advanceWidth,
      bbox: transformed.bbox,
      clampedWarning: transformed.clampedWarning,
      updatedAt: Date.now(),
    };

    this.glyphs.set(char, updated);
    return updated;
  }

  getGlyph(char: string): GlyphData | undefined {
    return this.glyphs.get(char);
  }

  getAllGlyphs(): Record<string, GlyphData> {
    const out: Record<string, GlyphData> = {};
    for (const [k, v] of this.glyphs.entries()) {
      out[k] = v;
    }
    return out;
  }

  loadGlyphsRecord(
    record: Record<
      string,
      Pick<GlyphData, 'svgString'> & Partial<Pick<GlyphData, 'metrics' | 'fileName'>>
    >
  ): void {
    this.glyphs.clear();
    for (const [char, data] of Object.entries(record)) {
      if (data && data.svgString) {
        this.addGlyphSync(char, data.svgString, data.metrics, data.fileName);
      }
    }
  }

  clearAll(): void {
    this.glyphs.clear();
    this.compiledCmapChars.clear();
  }

  getLastValidationReport(): FontValidationReport | null {
    return this.lastDetailedResult?.validation ?? null;
  }

  getLastDetailedBuild(): BuildFontDetailedResult | null {
    return this.lastDetailedResult;
  }

  private getCompilerInputs(): CompilerGlyphInput[] {
    return Array.from(this.glyphs.values()).map((g) => ({
      char: g.char,
      codePoint: g.codePoint,
      viewBox: g.viewBox,
      contoursInSvgSpace: g.contoursInSvgSpace,
      metrics: g.metrics,
    }));
  }

  async buildFontDetailed(
    meta: FontMetadata,
    onProgress?: (percent: number, stageKey: string) => void
  ): Promise<BuildFontDetailedResult> {
    const glyphInputs = this.getCompilerInputs();
    if (glyphInputs.length === 0) {
      throw new Error('ZERO_GLYPHS_ERROR');
    }

    const worker = this.getOrInitWorker();
    if (worker) {
      const reqId = `build-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      return new Promise<BuildFontDetailedResult>((resolve, reject) => {
        this.workerCallbacks.set(reqId, { onProgress, resolve, reject });
        const payload: FontWorkerRequest = {
          id: reqId,
          glyphInputs,
          meta,
          allSupportedChars: ALL_SUPPORTED_CHARS,
          core62Chars: CORE_62_CHARS,
        };
        worker.postMessage(payload);
      });
    }

    const compiled = compileAndValidateFont(
      glyphInputs,
      meta,
      ALL_SUPPORTED_CHARS,
      CORE_62_CHARS,
      onProgress
    );

    const ttfBlob = new Blob([compiled.ttfBuffer], { type: 'font/ttf' });
    const woffBlob = new Blob([compiled.woffBuffer], { type: 'font/woff' });
    const detailed: BuildFontDetailedResult = {
      ttfBlob,
      woffBlob,
      ttfBuffer: compiled.ttfBuffer,
      woffBuffer: compiled.woffBuffer,
      validation: compiled.validation,
      includedChars: compiled.validation.includedChars,
      missingChars: compiled.validation.missingSupportedChars,
    };
    this.lastDetailedResult = detailed;
    this.compiledCmapChars = new Set(compiled.validation.includedChars);
    return detailed;
  }

  async buildFont(
    meta: FontMetadata,
    onProgress?: (percent: number, stageKey: string) => void
  ): Promise<Blob> {
    const detailed = await this.buildFontDetailed(meta, onProgress);
    return detailed.ttfBlob;
  }

  async syncLivePreviewFontFace(
    meta: FontMetadata,
    cssFamilyName = 'HarfaLiveCompiledFont'
  ): Promise<boolean> {
    if (this.glyphs.size === 0) {
      this.compiledCmapChars.clear();
      if (this.activeFontFace && typeof document !== 'undefined' && document.fonts) {
        document.fonts.delete(this.activeFontFace);
        this.activeFontFace = null;
      }
      return false;
    }

    const detailed = await this.buildFontDetailed(meta);
    if (
      typeof window === 'undefined' ||
      typeof FontFace === 'undefined' ||
      typeof document === 'undefined' ||
      !document.fonts
    ) {
      return true;
    }

    const face = new FontFace(cssFamilyName, detailed.ttfBuffer.slice(0), {
      style: 'normal',
      weight: '400',
    });
    await face.load();

    if (this.activeFontFace) {
      document.fonts.delete(this.activeFontFace);
    }
    document.fonts.add(face);
    this.activeFontFace = face;

    return true;
  }

  previewText(text: string): PreviewGlyphToken[] {
    const tokens: PreviewGlyphToken[] = [];
    const chars = Array.from(text || '');

    chars.forEach((char, index) => {
      const codePoint = char.charCodeAt(0);
      if (char === '\n') {
        tokens.push({
          id: `nl-${index}`,
          char,
          codePoint,
          isSpace: false,
          isNewline: true,
          hasSvg: false,
          advanceWidth: 0,
          advanceRatio: 0,
        });
        return;
      }

      if (char === ' ') {
        tokens.push({
          id: `sp-${index}`,
          char,
          codePoint,
          isSpace: true,
          isNewline: false,
          hasSvg: true,
          advanceWidth: 280,
          advanceRatio: 0.28,
        });
        return;
      }

      const directGlyph = this.glyphs.get(char);
      const existsInCmap =
        Boolean(directGlyph) &&
        (this.compiledCmapChars.size === 0 || this.compiledCmapChars.has(char));

      if (directGlyph && existsInCmap) {
        const advanceRatio = Math.max(0.2, Math.min(1.8, directGlyph.advanceWidth / 1000));
        tokens.push({
          id: `gl-${index}-${char}`,
          char,
          codePoint,
          isSpace: false,
          isNewline: false,
          hasSvg: true,
          glyph: directGlyph,
          advanceWidth: directGlyph.advanceWidth,
          advanceRatio,
        });
      } else {
        tokens.push({
          id: `missing-${index}-${char}`,
          char,
          codePoint,
          isSpace: false,
          isNewline: false,
          hasSvg: false,
          advanceWidth: 600,
          advanceRatio: 0.6,
        });
      }
    });

    return tokens;
  }
}

export const fontEngine = new RealVectorFontEngine();
