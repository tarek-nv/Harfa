import opentype from 'opentype.js';
import {
  buildGlyphFontOutline,
  GlyphMetricsInput,
  NormalizedContour,
  PathCommand,
} from './svgOutlineParser';

export interface CompilerGlyphInput {
  char: string;
  codePoint: number;
  viewBox: [number, number, number, number];
  contoursInSvgSpace: NormalizedContour[];
  metrics: GlyphMetricsInput;
}

export interface CompilerFontMetadata {
  fontName: string;
  designerName: string;
  version: string;
  license: string;
  description?: string;
}

export interface GlyphDiagnosticRow {
  char: string;
  codePoint: number;
  unicodeHex: string;
  codePointHex: string;
  glyphName: string;
  advanceWidth: number;
  contourCount: number;
  commandCount: number;
}

export interface FontValidationReport {
  valid: boolean;
  isValid: boolean;
  byteLength: number;
  headerSignature: string;
  unitsPerEm: number;
  ascender: number;
  descender: number;
  glyphCount: number;
  numGlyphs: number;
  includedChars: string[];
  missingCoreChars: string[];
  missingSupportedChars: string[];
  glyphTable: GlyphDiagnosticRow[];
  warnings: string[];
  errors: string[];
}

export interface CompiledFontPayload {
  ttfBuffer: ArrayBuffer;
  woffBuffer: ArrayBuffer;
  validation: FontValidationReport;
}

const POSTSCRIPT_GLYPH_NAMES: Record<string, string> = {
  ' ': 'space',
  '0': 'zero',
  '1': 'one',
  '2': 'two',
  '3': 'three',
  '4': 'four',
  '5': 'five',
  '6': 'six',
  '7': 'seven',
  '8': 'eight',
  '9': 'nine',
  '!': 'exclam',
  '?': 'question',
  '.': 'period',
  ',': 'comma',
  '-': 'hyphen',
  '_': 'underscore',
  '@': 'at',
  '#': 'numbersign',
  '&': 'ampersand',
  '(': 'parenleft',
  ')': 'parenright',
  '/': 'slash',
};

export function getPostScriptGlyphName(char: string): string {
  if (POSTSCRIPT_GLYPH_NAMES[char]) {
    return POSTSCRIPT_GLYPH_NAMES[char];
  }
  if (/^[A-Za-z]$/.test(char)) {
    return char;
  }
  const cp = char.charCodeAt(0);
  return `uni${cp.toString(16).toUpperCase().padStart(4, '0')}`;
}

export const LICENSE_FULL_TEXT: Record<string, string> = {
  'OFL-1.1':
    'This Font Software is licensed under the SIL Open Font License, Version 1.1. https://scripts.sil.org/OFL',
  MIT: 'Licensed under the MIT License. Permission is hereby granted, free of charge, to any person obtaining a copy of this font software.',
  'Apache-2.0':
    'Licensed under the Apache License, Version 2.0. https://www.apache.org/licenses/LICENSE-2.0',
  'CC0-1.0':
    'Dedicated to the public domain under Creative Commons CC0 1.0 Universal.',
  Commercial: 'Proprietary Commercial Foundry License. All rights reserved by the designer.',
};

export function sanitizeFontFamilyName(rawName: string): string {
  const cleaned = (rawName || '')
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 50);
  return cleaned || 'HarfaSans';
}

function appendCommandsToOpentypePath(otPath: opentype.Path, commands: PathCommand[]): void {
  for (const cmd of commands) {
    if (cmd.type === 'M' && cmd.x !== undefined && cmd.y !== undefined) {
      otPath.moveTo(cmd.x, cmd.y);
    } else if (cmd.type === 'L' && cmd.x !== undefined && cmd.y !== undefined) {
      otPath.lineTo(cmd.x, cmd.y);
    } else if (
      cmd.type === 'Q' &&
      cmd.x1 !== undefined &&
      cmd.y1 !== undefined &&
      cmd.x !== undefined &&
      cmd.y !== undefined
    ) {
      otPath.quadTo(cmd.x1, cmd.y1, cmd.x, cmd.y);
    } else if (
      cmd.type === 'C' &&
      cmd.x1 !== undefined &&
      cmd.y1 !== undefined &&
      cmd.x2 !== undefined &&
      cmd.y2 !== undefined &&
      cmd.x !== undefined &&
      cmd.y !== undefined
    ) {
      otPath.curveTo(cmd.x1, cmd.y1, cmd.x2, cmd.y2, cmd.x, cmd.y);
    } else if (cmd.type === 'Z') {
      otPath.close();
    }
  }
}

export function countOpentypeContours(commands: opentype.PathCommand[]): number {
  let count = 0;
  for (const c of commands) {
    if (c.type === 'M') count++;
  }
  return count;
}

export function sfntToWoffBuffer(sfntBuffer: ArrayBuffer): ArrayBuffer {
  const sfnt = new DataView(sfntBuffer);
  const sfntBytes = new Uint8Array(sfntBuffer);
  if (sfntBuffer.byteLength < 12) return sfntBuffer;

  const flavor = sfnt.getUint32(0, false);
  const numTables = sfnt.getUint16(4, false);

  const tables: Array<{
    tag: number;
    checksum: number;
    offset: number;
    length: number;
    paddedLength: number;
  }> = [];

  for (let i = 0; i < numTables; i++) {
    const dirOffset = 12 + i * 16;
    if (dirOffset + 16 > sfntBuffer.byteLength) break;
    const tag = sfnt.getUint32(dirOffset, false);
    const checksum = sfnt.getUint32(dirOffset + 4, false);
    const offset = sfnt.getUint32(dirOffset + 8, false);
    const length = sfnt.getUint32(dirOffset + 12, false);
    const paddedLength = (length + 3) & ~3;
    tables.push({ tag, checksum, offset, length, paddedLength });
  }

  const woffHeaderSize = 44;
  const woffDirSize = tables.length * 20;
  let totalWoffSize = woffHeaderSize + woffDirSize;
  for (const t of tables) {
    totalWoffSize += t.paddedLength;
  }

  const outBuffer = new ArrayBuffer(totalWoffSize);
  const outView = new DataView(outBuffer);
  const outBytes = new Uint8Array(outBuffer);

  outView.setUint32(0, 0x774f4646, false); // 'wOFF'
  outView.setUint32(4, flavor, false);
  outView.setUint32(8, totalWoffSize, false);
  outView.setUint16(12, tables.length, false);
  outView.setUint16(14, 0, false);
  outView.setUint32(16, sfntBuffer.byteLength, false);
  outView.setUint16(20, 1, false);
  outView.setUint16(22, 0, false);
  outView.setUint32(24, 0, false);
  outView.setUint32(28, 0, false);
  outView.setUint32(32, 0, false);
  outView.setUint32(36, 0, false);
  outView.setUint32(40, 0, false);

  let currentDataOffset = woffHeaderSize + woffDirSize;
  for (let i = 0; i < tables.length; i++) {
    const t = tables[i];
    const dirPos = woffHeaderSize + i * 20;
    outView.setUint32(dirPos, t.tag, false);
    outView.setUint32(dirPos + 4, currentDataOffset, false);
    outView.setUint32(dirPos + 8, t.length, false);
    outView.setUint32(dirPos + 12, t.length, false);
    outView.setUint32(dirPos + 16, t.checksum, false);

    if (t.offset + t.length <= sfntBytes.byteLength) {
      outBytes.set(sfntBytes.subarray(t.offset, t.offset + t.length), currentDataOffset);
    }
    currentDataOffset += t.paddedLength;
  }

  return outBuffer;
}

export function compileAndValidateFont(
  glyphInputs: CompilerGlyphInput[],
  meta: CompilerFontMetadata,
  allSupportedChars: string[],
  core62Chars: string[],
  onProgress?: (percent: number, stageKey: string) => void
): CompiledFontPayload {
  if (!glyphInputs || glyphInputs.length === 0) {
    throw new Error('ZERO_GLYPHS_ERROR');
  }

  onProgress?.(10, 'parsing_glyphs');

  const notdefPath = new opentype.Path();
  notdefPath.moveTo(60, 0);
  notdefPath.lineTo(60, 700);
  notdefPath.lineTo(440, 700);
  notdefPath.lineTo(440, 0);
  notdefPath.close();
  notdefPath.moveTo(120, 60);
  notdefPath.lineTo(380, 60);
  notdefPath.lineTo(380, 640);
  notdefPath.lineTo(120, 640);
  notdefPath.close();

  const notdefGlyph = new opentype.Glyph({
    name: '.notdef',
    unicode: 0,
    advanceWidth: 500,
    path: notdefPath,
  });

  const spaceGlyph = new opentype.Glyph({
    name: 'space',
    unicode: 0x0020,
    advanceWidth: 280,
    path: new opentype.Path(),
  });

  const otGlyphs: opentype.Glyph[] = [notdefGlyph, spaceGlyph];
  const expectedAdvanceMap = new Map<string, number>();
  const warnings: string[] = [];

  const sortedInputs = [...glyphInputs].sort((a, b) => a.codePoint - b.codePoint);

  onProgress?.(32, 'building_outlines');

  const total = sortedInputs.length;
  sortedInputs.forEach((input, idx) => {
    if (input.char === ' ') return;

    const transformed = buildGlyphFontOutline(
      input.contoursInSvgSpace,
      input.viewBox,
      input.metrics
    );

    if (transformed.clampedWarning) {
      warnings.push(`Glyph "${input.char}" had extreme coordinates clamped to the em box.`);
    }

    const otPath = new opentype.Path();
    appendCommandsToOpentypePath(otPath, transformed.commands);

    const glyphName = getPostScriptGlyphName(input.char);
    const otGlyph = new opentype.Glyph({
      name: glyphName,
      unicode: input.codePoint,
      advanceWidth: transformed.advanceWidth,
      path: otPath,
    });

    otGlyphs.push(otGlyph);
    expectedAdvanceMap.set(input.char, transformed.advanceWidth);

    const pct = 32 + Math.round(((idx + 1) / total) * 36);
    onProgress?.(pct, 'building_outlines');
  });

  onProgress?.(74, 'writing_tables');

  const familyName = sanitizeFontFamilyName(meta.fontName);
  const designer = (meta.designerName || 'Studio Harfa').trim();
  const versionStr = meta.version?.trim().startsWith('Version')
    ? meta.version.trim()
    : `Version ${meta.version?.trim() || '1.000'}`;
  const licenseText = LICENSE_FULL_TEXT[meta.license] || meta.license || 'SIL Open Font License 1.1';
  const year = new Date().getFullYear();

  const font = new opentype.Font({
    familyName,
    styleName: 'Regular',
    designer,
    version: versionStr,
    license: licenseText,
    copyright: `Copyright (c) ${year} ${designer}. Built with Harfa.`,
    description: meta.description || `Vector typeface ${familyName} compiled by Harfa.`,
    unitsPerEm: 1000,
    ascender: 800,
    descender: -200,
    glyphs: otGlyphs,
  });

  if (font.tables && font.tables.os2) {
    font.tables.os2.sTypoAscender = 800;
    font.tables.os2.sTypoDescender = -200;
    font.tables.os2.sTypoLineGap = 100;
    font.tables.os2.usWinAscent = 800;
    font.tables.os2.usWinDescent = 200;
    font.tables.os2.sxHeight = 500;
    font.tables.os2.sCapHeight = 700;
  }
  if (font.tables && font.tables.hhea) {
    font.tables.hhea.ascender = 800;
    font.tables.hhea.descender = -200;
    font.tables.hhea.lineGap = 100;
  }

  const ttfBuffer = font.toArrayBuffer();
  const woffBuffer = sfntToWoffBuffer(ttfBuffer);

  onProgress?.(90, 'validating_font');

  const validationErrors: string[] = [];
  const glyphTable: GlyphDiagnosticRow[] = [];
  let headerSignature = '';

  if (ttfBuffer.byteLength < 200) {
    validationErrors.push(`File size is too small (${ttfBuffer.byteLength} bytes).`);
  }

  const headerBytes = new Uint8Array(ttfBuffer.slice(0, 4));
  const isOTTO =
    headerBytes[0] === 0x4f &&
    headerBytes[1] === 0x54 &&
    headerBytes[2] === 0x54 &&
    headerBytes[3] === 0x4f;
  const isTrueType =
    headerBytes[0] === 0x00 &&
    headerBytes[1] === 0x01 &&
    headerBytes[2] === 0x00 &&
    headerBytes[3] === 0x00;

  if (isOTTO) {
    headerSignature = 'OTTO (OpenType CFF)';
  } else if (isTrueType) {
    headerSignature = '0x00010000 (TrueType)';
  } else {
    headerSignature = `0x${Array.from(headerBytes)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')}`;
    validationErrors.push(`Invalid OpenType/TrueType sfnt header: ${headerSignature}`);
  }

  let parsedFont: opentype.Font | null = null;
  try {
    parsedFont = opentype.parse(ttfBuffer);
  } catch (err) {
    validationErrors.push(
      `opentype.parse() failed: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  if (parsedFont) {
    if (parsedFont.unitsPerEm !== 1000) {
      validationErrors.push(`Expected unitsPerEm=1000, got ${parsedFont.unitsPerEm}`);
    }
    if (parsedFont.ascender !== 800) {
      validationErrors.push(`Expected ascender=800, got ${parsedFont.ascender}`);
    }
    if (parsedFont.descender !== -200) {
      validationErrors.push(`Expected descender=-200, got ${parsedFont.descender}`);
    }

    for (const input of sortedInputs) {
      const char = input.char;
      const mappedGlyph = parsedFont.charToGlyph(char);
      if (!mappedGlyph || mappedGlyph.name === '.notdef') {
        validationErrors.push(`Character "${char}" is missing from the compiled cmap table.`);
        continue;
      }

      const cmdCount = mappedGlyph.path?.commands?.length || 0;
      if (char !== ' ' && cmdCount === 0) {
        validationErrors.push(`Glyph "${char}" (${mappedGlyph.name}) compiled with 0 path commands.`);
      }

      const expectedAdv = expectedAdvanceMap.get(char);
      if (expectedAdv !== undefined && Math.abs((mappedGlyph.advanceWidth || 0) - expectedAdv) > 1) {
        validationErrors.push(
          `Advance width mismatch on "${char}": expected ${expectedAdv}, got ${mappedGlyph.advanceWidth}`
        );
      }

      const contourCount = countOpentypeContours(mappedGlyph.path?.commands || []);
      const hexStr = `U+${input.codePoint.toString(16).toUpperCase().padStart(4, '0')}`;
      glyphTable.push({
        char,
        codePoint: input.codePoint,
        unicodeHex: hexStr,
        codePointHex: hexStr,
        glyphName: mappedGlyph.name || getPostScriptGlyphName(char),
        advanceWidth: mappedGlyph.advanceWidth || expectedAdv || 500,
        contourCount,
        commandCount: cmdCount,
      });
    }
  }

  const includedSet = new Set(sortedInputs.map((g) => g.char));
  const missingCoreChars = core62Chars.filter((c) => !includedSet.has(c));
  const missingSupportedChars = allSupportedChars.filter((c) => !includedSet.has(c));

  onProgress?.(100, 'finalizing_ttf');

  const isValid = validationErrors.length === 0;
  const validation: FontValidationReport = {
    valid: isValid,
    isValid,
    byteLength: ttfBuffer.byteLength,
    headerSignature,
    unitsPerEm: parsedFont?.unitsPerEm ?? 1000,
    ascender: parsedFont?.ascender ?? 800,
    descender: parsedFont?.descender ?? -200,
    glyphCount: glyphTable.length,
    numGlyphs: parsedFont?.glyphs?.length ?? otGlyphs.length,
    includedChars: sortedInputs.map((g) => g.char),
    missingCoreChars,
    missingSupportedChars,
    glyphTable,
    warnings,
    errors: validationErrors,
  };

  if (!validation.valid) {
    const err = new Error(`FONT_VALIDATION_FAILED: ${validationErrors.join(' | ')}`);
    (err as Error & { validation?: FontValidationReport }).validation = validation;
    throw err;
  }

  return {
    ttfBuffer,
    woffBuffer,
    validation,
  };
}
