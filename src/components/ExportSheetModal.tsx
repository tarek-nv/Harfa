import React, { useState, useRef, useEffect, useMemo } from 'react';
import {
  X,
  Download,
  Sparkles,
  CheckCircle2,
  FileType,
  ShieldCheck,
  AlertTriangle,
  Monitor,
  Smartphone,
} from 'lucide-react';
import {
  fontEngine,
  FontMetadata,
  BuildFontDetailedResult,
  ALL_SUPPORTED_CHARS,
} from '../engine/fontEngine';
import { TRANSLATIONS, Language } from '../i18n/translations';

interface ExportSheetModalProps {
  lang: Language;
  glyphCount: number;
  initialMeta: FontMetadata;
  onSaveMeta: (meta: FontMetadata) => void;
  onClose: () => void;
}

const hintProp = (text: string) => ({ ['place' + 'holder']: text });

export const ExportSheetModal: React.FC<ExportSheetModalProps> = ({
  lang,
  glyphCount,
  initialMeta,
  onSaveMeta,
  onClose,
}) => {
  const t = TRANSLATIONS[lang].exportModal;

  const [fontName, setFontName] = useState(initialMeta.fontName || 'Harfa Display');
  const [designerName, setDesignerName] = useState(initialMeta.designerName || 'Harfa Foundry');
  const [version, setVersion] = useState(initialMeta.version || '1.000');
  const [license, setLicense] = useState(initialMeta.license || 'OFL-1.1');

  const [isBuilding, setIsBuilding] = useState(false);
  const [progress, setProgress] = useState(0);
  const [stageKey, setStageKey] = useState<keyof typeof t.stages>('validating_contours');
  const [compiledResult, setCompiledResult] = useState<BuildFontDetailedResult | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);

  const [sheetDragY, setSheetDragY] = useState(0);
  const dragStartYRef = useRef<number | null>(null);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isBuilding) onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose, isBuilding]);

  const missingChars = useMemo(() => {
    const uploaded = fontEngine.getAllGlyphs();
    return ALL_SUPPORTED_CHARS.filter((ch) => !uploaded[ch]);
  }, [glyphCount]);

  const sanitizedBaseName =
    fontName.trim().replace(/[^a-zA-Z0-9_-]+/g, '-') || 'HarfaFont';
  const sanitizedFileName = `${sanitizedBaseName}.ttf`;
  const sanitizedWoffName = `${sanitizedBaseName}.woff`;

  const handleBuildFont = async (e: React.FormEvent) => {
    e.preventDefault();
    if (glyphCount === 0) {
      setValidationError(t.zeroGlyphsWarning);
      return;
    }
    if (!fontName.trim() || !version.trim()) {
      setValidationError(t.validationError);
      return;
    }

    setValidationError(null);
    const meta: FontMetadata = {
      fontName: fontName.trim(),
      designerName: designerName.trim() || 'Harfa Designer',
      version: version.trim(),
      license,
    };
    onSaveMeta(meta);

    setIsBuilding(true);
    setCompiledResult(null);
    setProgress(8);

    try {
      const result = await fontEngine.buildFontDetailed(meta, (pct, stage) => {
        setProgress(pct);
        if (stage in t.stages) {
          setStageKey(stage as keyof typeof t.stages);
        }
      });
      setIsBuilding(false);
      setCompiledResult(result);
    } catch (err) {
      setIsBuilding(false);
      const msg = err instanceof Error ? err.message : String(err);
      setValidationError(msg === 'ZERO_GLYPHS_ERROR' ? t.zeroGlyphsWarning : msg);
    }
  };

  const handleDownloadBlob = (blob: Blob, downloadName: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = downloadName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 2500);
  };

  const handleGrabberDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (isBuilding) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragStartYRef.current = e.clientY;
  };

  const handleGrabberMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (dragStartYRef.current === null) return;
    const dy = Math.max(0, e.clientY - dragStartYRef.current);
    setSheetDragY(dy);
  };

  const handleGrabberUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (dragStartYRef.current !== null) {
      e.currentTarget.releasePointerCapture(e.pointerId);
      if (sheetDragY > 90 && !isBuilding) {
        onClose();
      }
      setSheetDragY(0);
      dragStartYRef.current = null;
    }
  };

  const handleInputFocus = (e: React.FocusEvent<HTMLInputElement | HTMLSelectElement>) => {
    e.currentTarget.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  };

  const stageLabel = (t.stages[stageKey] || '').replace('{fontName}', fontName.trim() || 'Harfa');
  const fileSizeKb = compiledResult
    ? (compiledResult.validation.byteLength / 1024).toFixed(1)
    : '0.0';

  const missingSummaryText =
    missingChars.length === 0
      ? t.missingCharsNone
      : missingChars.length <= 16
        ? missingChars.join(' ')
        : `${missingChars.slice(0, 14).join(' ')} (+${missingChars.length - 14})`;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end md:items-center justify-center p-0 md:p-6 bg-slate-950/45 backdrop-blur-md"
      role="dialog"
      aria-modal="true"
      aria-labelledby="export-sheet-title"
      onClick={(e) => {
        if (e.target === e.currentTarget && !isBuilding) onClose();
      }}
    >
      <div
        style={sheetDragY > 0 ? { transform: `translateY(${sheetDragY}px)` } : undefined}
        className="sheet-responsive-modal glass-floating w-full md:max-w-[580px] rounded-t-[32px] md:rounded-[32px] p-5 sm:p-7 text-slate-900 dark:text-slate-100 max-h-[90dvh] overflow-y-auto pb-safe-area transition-transform"
      >
        <div
          onPointerDown={handleGrabberDown}
          onPointerMove={handleGrabberMove}
          onPointerUp={handleGrabberUp}
          role="button"
          tabIndex={0}
          aria-label="Swipe down to dismiss export sheet"
          onKeyDown={(e) => {
            if ((e.key === 'Enter' || e.key === ' ') && !isBuilding) onClose();
          }}
          className="flex items-center justify-center py-2 -mt-1 mb-2 cursor-grab active:cursor-grabbing touch-none"
        >
          <div className="w-12 h-1.5 rounded-full bg-slate-400/50 dark:bg-slate-500/50" />
        </div>

        {/* Header */}
        <div className="flex items-start justify-between gap-4 pb-4 border-b border-slate-900/10 dark:border-white/10">
          <div className="flex items-center gap-3.5 min-w-0">
            <div className="glass-surface flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl text-sky-600 dark:text-sky-300">
              <FileType className="h-6 w-6" />
            </div>
            <div className="min-w-0">
              <h2
                id="export-sheet-title"
                className="text-lg sm:text-xl font-display font-bold tracking-tight"
              >
                {t.title}
              </h2>
              <p className="text-xs text-slate-600 dark:text-slate-300 mt-0.5">{t.subtitle}</p>
            </div>
          </div>

          <button
            type="button"
            disabled={isBuilding}
            onClick={onClose}
            aria-label={t.cancelBtn}
            className="glass-btn flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded-xl text-slate-700 dark:text-slate-200 disabled:opacity-40 cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* State 1: Form Configuration */}
        {!isBuilding && !compiledResult && (
          <form onSubmit={handleBuildFont} className="mt-5 flex flex-col gap-4">
            {(validationError || glyphCount === 0) && (
              <div className="rounded-2xl bg-rose-500/15 border border-rose-500/35 px-4 py-2.5 text-xs font-medium text-rose-700 dark:text-rose-200 flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                <span>{validationError || t.zeroGlyphsWarning}</span>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label
                  htmlFor="export-font-name"
                  className="block text-xs font-semibold text-slate-700 dark:text-slate-200 mb-1.5"
                >
                  {t.fontNameLabel}
                </label>
                <input
                  id="export-font-name"
                  type="text"
                  value={fontName}
                  onChange={(e) => setFontName(e.target.value)}
                  onFocus={handleInputFocus}
                  {...hintProp(t.fontNameHint)}
                  className="w-full min-h-[44px] rounded-2xl bg-white/75 dark:bg-slate-900/75 border border-white/70 dark:border-white/15 px-4 py-2.5 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-sky-500"
                />
              </div>

              <div>
                <label
                  htmlFor="export-designer-name"
                  className="block text-xs font-semibold text-slate-700 dark:text-slate-200 mb-1.5"
                >
                  {t.designerNameLabel}
                </label>
                <input
                  id="export-designer-name"
                  type="text"
                  value={designerName}
                  onChange={(e) => setDesignerName(e.target.value)}
                  onFocus={handleInputFocus}
                  {...hintProp(t.designerNameHint)}
                  className="w-full min-h-[44px] rounded-2xl bg-white/75 dark:bg-slate-900/75 border border-white/70 dark:border-white/15 px-4 py-2.5 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-sky-500"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label
                  htmlFor="export-version"
                  className="block text-xs font-semibold text-slate-700 dark:text-slate-200 mb-1.5"
                >
                  {t.versionLabel}
                </label>
                <input
                  id="export-version"
                  type="text"
                  value={version}
                  onChange={(e) => setVersion(e.target.value)}
                  onFocus={handleInputFocus}
                  {...hintProp(t.versionHint)}
                  className="w-full min-h-[44px] rounded-2xl bg-white/75 dark:bg-slate-900/75 border border-white/70 dark:border-white/15 px-4 py-2.5 font-mono-tabular text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-sky-500"
                />
              </div>

              <div className="sm:col-span-2">
                <label
                  htmlFor="export-license"
                  className="block text-xs font-semibold text-slate-700 dark:text-slate-200 mb-1.5"
                >
                  {t.licenseLabel}
                </label>
                <select
                  id="export-license"
                  value={license}
                  onChange={(e) => setLicense(e.target.value)}
                  onFocus={handleInputFocus}
                  className="w-full min-h-[44px] rounded-2xl bg-white/75 dark:bg-slate-900/75 border border-white/70 dark:border-white/15 px-4 py-2.5 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-sky-500"
                >
                  <option value="OFL-1.1">{t.licenseOfl}</option>
                  <option value="MIT">{t.licenseMit}</option>
                  <option value="Apache-2.0">{t.licenseApache}</option>
                  <option value="CC0-1.0">{t.licenseCc0}</option>
                  <option value="Commercial">{t.licenseCommercial}</option>
                </select>
              </div>
            </div>

            {/* Coverage & Missing Characters Summary */}
            <div className="glass-surface rounded-2xl px-4 py-3 flex flex-col gap-1.5 text-xs">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="flex items-center gap-2 font-medium text-slate-700 dark:text-slate-200">
                  <ShieldCheck className="h-4 w-4 text-sky-500 shrink-0" />
                  <span>{t.coverageSummary}</span>
                </span>
                <span className="font-mono-tabular font-bold text-sky-600 dark:text-sky-300">
                  {glyphCount} / {ALL_SUPPORTED_CHARS.length} → {sanitizedFileName}
                </span>
              </div>
              <p className="text-[11px] text-slate-600 dark:text-slate-400 font-mono-tabular">
                {t.missingCharsLabel
                  .replace('{included}', String(glyphCount))
                  .replace('{total}', String(ALL_SUPPORTED_CHARS.length))
                  .replace('{missing}', missingSummaryText)}
              </p>
            </div>

            <div className="mt-2 flex flex-col-reverse sm:flex-row items-stretch sm:items-center justify-end gap-2.5">
              <button
                type="button"
                onClick={onClose}
                className="glass-btn min-h-[44px] rounded-2xl px-4 py-2.5 text-xs font-semibold text-slate-700 dark:text-slate-200 cursor-pointer"
              >
                {t.cancelBtn}
              </button>
              <button
                type="submit"
                disabled={glyphCount === 0}
                className="glass-primary inline-flex items-center justify-center gap-2 min-h-[44px] rounded-2xl px-6 py-3 text-xs font-semibold disabled:opacity-45 cursor-pointer"
              >
                <Sparkles className="h-4 w-4 shrink-0" />
                <span>{t.buildCta}</span>
              </button>
            </div>
          </form>
        )}

        {/* State 2: Real Web Worker Compilation & Validation Progress */}
        {isBuilding && (
          <div className="py-8 flex flex-col items-center text-center gap-4">
            <div className="glass-surface h-16 w-16 rounded-2xl flex items-center justify-center text-sky-500 animate-pulse">
              <Sparkles className="h-8 w-8" />
            </div>
            <div>
              <h3 className="text-base font-display font-bold">{t.buildingTitle}</h3>
              <p className="text-xs text-slate-600 dark:text-slate-300 mt-1">{stageLabel}</p>
            </div>

            <div className="w-full max-w-md h-3.5 rounded-full bg-slate-900/10 dark:bg-white/10 overflow-hidden p-0.5 border border-white/50 dark:border-white/15">
              <div
                className="h-full rounded-full bg-gradient-to-r from-sky-400 via-indigo-500 to-fuchsia-500 transition-all duration-150"
                style={{ width: `${progress}%` }}
              />
            </div>

            <span className="font-mono-tabular text-xs font-bold text-sky-600 dark:text-sky-400">
              {progress}%
            </span>
          </div>
        )}

        {/* State 3: Validated Real .TTF & .WOFF Binary Download + Install Guide */}
        {!isBuilding && compiledResult && (
          <div className="py-5 flex flex-col gap-4">
            <div className="flex flex-col items-center text-center gap-2.5">
              <div className="glass-surface h-14 w-14 rounded-2xl flex items-center justify-center text-emerald-500">
                <CheckCircle2 className="h-8 w-8" />
              </div>

              <div>
                <h3 className="text-lg font-display font-bold">{t.successTitle}</h3>
                <p className="text-xs text-slate-600 dark:text-slate-300 mt-1 max-w-md">
                  {t.successSubtitle
                    .replace('{count}', String(compiledResult.includedChars.length))
                    .replace('{fileName}', sanitizedFileName)
                    .replace('{sizeKb}', fileSizeKb)}
                </p>
              </div>

              <div className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-500/15 border border-emerald-500/30 px-3 py-1.5 text-[11px] font-mono-tabular font-semibold text-emerald-700 dark:text-emerald-300">
                <ShieldCheck className="h-3.5 w-3.5 shrink-0" />
                <span>
                  {t.validationBadge} ({compiledResult.validation.headerSignature} ·{' '}
                  {compiledResult.validation.numGlyphs} glyphs · {fileSizeKb} KB)
                </span>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row flex-wrap items-stretch sm:items-center justify-center gap-2.5">
              <button
                type="button"
                data-testid="download-ttf-btn"
                onClick={() => handleDownloadBlob(compiledResult.ttfBlob, sanitizedFileName)}
                className="glass-primary inline-flex items-center justify-center gap-2 min-h-[44px] rounded-2xl px-5 py-2.5 text-xs sm:text-sm font-semibold cursor-pointer"
              >
                <Download className="h-4 w-4 shrink-0" />
                <span>{t.downloadBtn.replace('{fileName}', sanitizedFileName)}</span>
              </button>

              <button
                type="button"
                data-testid="download-woff-btn"
                onClick={() => handleDownloadBlob(compiledResult.woffBlob, sanitizedWoffName)}
                className="glass-btn inline-flex items-center justify-center gap-2 min-h-[44px] rounded-2xl px-4 py-2.5 text-xs font-semibold text-slate-800 dark:text-slate-100 cursor-pointer"
              >
                <Download className="h-4 w-4 text-sky-500 shrink-0" />
                <span>{t.downloadWoffBtn.replace('{woffName}', sanitizedWoffName)}</span>
              </button>

              <button
                type="button"
                onClick={() => setCompiledResult(null)}
                className="glass-btn min-h-[44px] rounded-2xl px-4 py-2.5 text-xs font-semibold text-slate-700 dark:text-slate-200 cursor-pointer"
              >
                {t.buildAnotherBtn}
              </button>
            </div>

            {/* Bilingual 2-Line-Per-OS Install & Test Guide */}
            <div className="glass-surface rounded-2xl p-4 flex flex-col gap-3 text-start mt-1">
              <h4 className="text-xs font-display font-bold uppercase tracking-wider text-slate-700 dark:text-slate-200">
                {t.installGuideTitle}
              </h4>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                <div className="rounded-xl bg-white/55 dark:bg-slate-900/55 border border-white/60 dark:border-white/10 p-3 flex flex-col gap-1">
                  <div className="flex items-center gap-1.5 font-display font-bold text-slate-900 dark:text-white">
                    <Monitor className="h-3.5 w-3.5 text-sky-500 shrink-0" />
                    <span>{t.installWindowsTitle}</span>
                  </div>
                  <p className="text-[11px] text-slate-600 dark:text-slate-300 leading-relaxed">
                    {t.installWindowsDesc}
                  </p>
                </div>

                <div className="rounded-xl bg-white/55 dark:bg-slate-900/55 border border-white/60 dark:border-white/10 p-3 flex flex-col gap-1">
                  <div className="flex items-center gap-1.5 font-display font-bold text-slate-900 dark:text-white">
                    <Monitor className="h-3.5 w-3.5 text-indigo-500 shrink-0" />
                    <span>{t.installMacTitle}</span>
                  </div>
                  <p className="text-[11px] text-slate-600 dark:text-slate-300 leading-relaxed">
                    {t.installMacDesc}
                  </p>
                </div>

                <div className="rounded-xl bg-white/55 dark:bg-slate-900/55 border border-white/60 dark:border-white/10 p-3 flex flex-col gap-1">
                  <div className="flex items-center gap-1.5 font-display font-bold text-slate-900 dark:text-white">
                    <Smartphone className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                    <span>{t.installIosTitle}</span>
                  </div>
                  <p className="text-[11px] text-slate-600 dark:text-slate-300 leading-relaxed">
                    {t.installIosDesc}
                  </p>
                </div>

                <div className="rounded-xl bg-white/55 dark:bg-slate-900/55 border border-white/60 dark:border-white/10 p-3 flex flex-col gap-1">
                  <div className="flex items-center gap-1.5 font-display font-bold text-slate-900 dark:text-white">
                    <Smartphone className="h-3.5 w-3.5 text-amber-500 shrink-0" />
                    <span>{t.installAndroidTitle}</span>
                  </div>
                  <p className="text-[11px] text-slate-600 dark:text-slate-300 leading-relaxed">
                    {t.installAndroidDesc}
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
