import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import opentype from 'opentype.js';
import {
  fontEngine,
  matchFilenameToChar,
  ALL_SUPPORTED_CHARS,
} from './fontEngine';
import { SAMPLE_SVG_GLYPHS, STARTER_42_CHARS } from '../data/sampleGlyphs';

describe('Harfa Real Vector Font Engine (opentype.js + svgpath)', () => {
  beforeEach(() => {
    fontEngine.clearAll();
  });

  it('matches single-char, case-tagged, and unicode-hex filenames to characters', () => {
    assert.equal(matchFilenameToChar('A.svg'), 'A');
    assert.equal(matchFilenameToChar('a.svg'), 'a');
    assert.equal(matchFilenameToChar('upper-b.svg'), 'B');
    assert.equal(matchFilenameToChar('lower_b.svg'), 'b');
    assert.equal(matchFilenameToChar('U+0048.svg'), 'H');
    assert.equal(matchFilenameToChar('u0038.svg'), '8');
    assert.equal(matchFilenameToChar('unknown_icon_file.svg'), null);
  });

  it('rejects broken SVGs and stroke-only SVGs with clear error codes', async () => {
    const brokenRes = await fontEngine.addGlyph('A', '<div>Not an SVG</div>');
    assert.equal(brokenRes.success, false);
    assert.equal(brokenRes.error, 'INVALID_SVG_TAG');

    const strokeOnlySvg = `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
      <path d="M 20 80 L 50 15 L 80 80" fill="none" stroke="#000" stroke-width="8" />
    </svg>`;
    const strokeRes = await fontEngine.addGlyph('A', strokeOnlySvg);
    assert.equal(strokeRes.success, false);
    assert.equal(strokeRes.error, 'STROKE_ONLY_SVG');
    assert.equal(fontEngine.getGlyph('A'), undefined);
  });

  it('warns on mixed stroke+fill SVGs and allows continuing when ignoreStrokes is confirmed', async () => {
    const mixedSvg = `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
      <rect x="20" y="15" width="60" height="70" fill="#000" stroke="#f00" stroke-width="4" />
    </svg>`;
    const warnRes = await fontEngine.addGlyph('M', mixedSvg);
    assert.equal(warnRes.success, false);
    assert.equal(warnRes.error, 'STROKE_WARNING_CONFIRM_REQUIRED');

    const confirmRes = await fontEngine.addGlyph('M', mixedSvg, { ignoreStrokes: true });
    assert.equal(confirmRes.success, true);
    assert.ok(confirmRes.glyph);
    assert.equal(confirmRes.glyph.contourCount, 1);
  });

  it('converts rect (with rx/ry), circle, ellipse, polygon, polyline, and nested group transforms', async () => {
    const complexShapesSvg = `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
      <g transform="translate(5, 5) scale(0.9)">
        <rect x="10" y="10" width="30" height="30" rx="6" ry="6" fill="#000" />
        <circle cx="70" cy="25" r="14" fill="#000" />
        <ellipse cx="30" cy="70" rx="18" ry="12" fill="#000" />
        <polygon points="60,55 85,55 72,82" fill="#000" />
      </g>
    </svg>`;
    const res = await fontEngine.addGlyph('Q', complexShapesSvg);
    assert.equal(res.success, true);
    assert.ok(res.glyph);
    assert.equal(res.glyph.contourCount, 4);
  });

  it('blocks building a font when 0 glyphs are uploaded', async () => {
    await assert.rejects(
      async () => {
        await fontEngine.buildFontDetailed({
          fontName: 'EmptyFont',
          designerName: 'Harfa',
          version: '1.000',
          license: 'OFL-1.1',
        });
      },
      (err: Error) => err.message === 'ZERO_GLYPHS_ERROR'
    );
  });

  it('builds a valid font with 1 glyph and verifies it with opentype.parse()', async () => {
    await fontEngine.addGlyph('H', SAMPLE_SVG_GLYPHS.H);
    const result = await fontEngine.buildFontDetailed({
      fontName: 'Harfa Single',
      designerName: 'Studio Harfa',
      version: '1.000',
      license: 'OFL-1.1',
    });

    assert.equal(result.validation.isValid, true);
    assert.equal(result.validation.unitsPerEm, 1000);
    assert.equal(result.validation.ascender, 800);
    assert.equal(result.validation.descender, -200);
    assert.equal(result.includedChars.length, 1);

    const parsed = opentype.parse(result.ttfBuffer);
    const hGlyph = parsed.charToGlyph('H');
    assert.ok(hGlyph);
    assert.equal(hGlyph.name, 'H');
    assert.ok(hGlyph.path.commands.length > 0);
  });

  it('builds the starter glyph set + hole/curve glyphs (O, A, B, 8), parses back with opentype.parse(), and prints the glyph table', async () => {
    for (const ch of STARTER_42_CHARS) {
      await fontEngine.addGlyph(ch, SAMPLE_SVG_GLYPHS[ch]);
    }
    for (const ch of ['O', 'A', 'B', '8']) {
      await fontEngine.addGlyph(ch, SAMPLE_SVG_GLYPHS[ch]);
    }

    const detailed = await fontEngine.buildFontDetailed({
      fontName: 'Harfa Starter 42',
      designerName: 'Studio Harfa',
      version: '1.000',
      license: 'OFL-1.1',
    });

    assert.equal(detailed.validation.isValid, true);
    assert.equal(detailed.validation.errors.length, 0);
    assert.equal(detailed.validation.unitsPerEm, 1000);
    assert.equal(detailed.validation.ascender, 800);
    assert.equal(detailed.validation.descender, -200);

    const parsedFont = opentype.parse(detailed.ttfBuffer);
    assert.equal(parsedFont.unitsPerEm, 1000);
    assert.equal(parsedFont.ascender, 800);
    assert.equal(parsedFont.descender, -200);

    const oRow = detailed.validation.glyphTable.find((r) => r.char === 'O');
    const aRow = detailed.validation.glyphTable.find((r) => r.char === 'A');
    const bRow = detailed.validation.glyphTable.find((r) => r.char === 'B');
    const eightRow = detailed.validation.glyphTable.find((r) => r.char === '8');

    assert.ok(oRow && oRow.contourCount >= 2, 'O must have outer + inner hole contour');
    assert.ok(aRow && aRow.contourCount >= 2, 'A must have outer + inner hole contour');
    assert.ok(bRow && bRow.contourCount >= 3, 'B must have outer + 2 inner hole contours');
    assert.ok(eightRow && eightRow.contourCount >= 3, '8 must have outer + 2 inner hole contours');

    console.log('\n=== HARFA PARSED .TTF GLYPH DIAGNOSTIC TABLE (STARTER SET) ===');
    console.log('Char | Code Point | Glyph Name   | Advance Width | Contours');
    console.log('-----+------------+--------------+---------------+---------');
    for (const row of detailed.validation.glyphTable) {
      console.log(
        `${row.char.padEnd(4)} | ${row.codePointHex.padEnd(10)} | ${row.glyphName.padEnd(12)} | ${String(row.advanceWidth).padEnd(13)} | ${row.contourCount}`
      );
    }
    console.log('==============================================================\n');
  });

  it('builds a full 74-character font (A-Z, a-z, 0-9, punctuation) and validates every glyph in cmap', async () => {
    for (const ch of ALL_SUPPORTED_CHARS) {
      const svg = SAMPLE_SVG_GLYPHS[ch];
      assert.ok(svg, `Missing sample SVG for ${ch}`);
      const res = await fontEngine.addGlyph(ch, svg);
      assert.equal(res.success, true, `Failed adding glyph ${ch}: ${res.error}`);
    }

    const detailed = await fontEngine.buildFontDetailed({
      fontName: 'Harfa Complete 74',
      designerName: 'Studio Harfa',
      version: '1.000',
      license: 'OFL-1.1',
    });

    assert.equal(detailed.validation.isValid, true);
    assert.equal(detailed.includedChars.length, 74);
    assert.equal(detailed.missingChars.length, 0);
    assert.equal(detailed.validation.numGlyphs, 76);
    assert.ok(detailed.ttfBuffer.byteLength > 2000);
    assert.ok(detailed.woffBuffer.byteLength > 1000);
  });
});
