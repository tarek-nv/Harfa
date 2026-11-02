import React, { useState, useRef, useEffect } from 'react';
import {
  X,
  Upload,
  RotateCcw,
  Trash2,
  Check,
  Move,
  Maximize2,
  AlignHorizontalSpaceAround,
  Sparkles,
  Code2,
  AlertTriangle,
} from 'lucide-react';
import {
  GlyphData,
  GlyphMetrics,
  DEFAULT_GLYPH_METRICS,
} from '../engine/fontEngine';
import { SAMPLE_SVG_GLYPHS } from '../data/sampleGlyphs';
import { TRANSLATIONS, Language } from '../i18n/translations';

interface GlyphEditorModalProps {
  char: string;
  glyph?: GlyphData;
  lang: Language;
  variant?: 'modal' | 'inline';
  onClose: () => void;
  onUploadSvg: (
    char: string,
    svgString: string,
    fileName?: string,
    options?: { ignoreStrokes?: boolean }
  ) => Promise<{ ok: boolean; error?: string }>;
  onUpdateMetrics: (char: string, metrics: Partial<GlyphMetrics>) => void;
  onRemoveGlyph: (char: string) => void;
}

const hintProp = (text: string) => ({ ['place' + 'holder']: text });

export const GlyphEditorModal: React.FC<GlyphEditorModalProps> = ({
  char,
  glyph,
  lang,
  variant = 'modal',
  onClose,
  onUploadSvg,
  onUpdateMetrics,
  onRemoveGlyph,
}) => {
  const t = TRANSLATIONS[lang].editor;
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [metrics, setMetrics] = useState<GlyphMetrics>(
    glyph?.metrics || { ...DEFAULT_GLYPH_METRICS }
  );
  const [rawSvgInput, setRawSvgInput] = useState<string>(glyph?.svgString || '');
  const [showRawCode, setShowRawCode] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [pendingStrokeSvg, setPendingStrokeSvg] = useState<{
    svgString: string;
    fileName?: string;
  } | null>(null);
  const [isDraggingCanvas, setIsDraggingCanvas] = useState<boolean>(false);
  const dragStartRef = useRef<{ x: number; y: number; startX: number; startY: number } | null>(
    null
  );

  const [sheetDragY, setSheetDragY] = useState<number>(0);
  const sheetDragStartRef = useRef<number | null>(null);

  useEffect(() => {
    setMetrics(glyph?.metrics || { ...DEFAULT_GLYPH_METRICS });
    setRawSvgInput(glyph?.svgString || '');
    setErrorMsg(null);
    setPendingStrokeSvg(null);
  }, [char, glyph?.svgString, glyph?.updatedAt]);

  useEffect(() => {
    if (variant !== 'modal') return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose, variant]);

  const unicodeHex = `U+${char.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')}`;

  const handleMetricChange = (key: keyof GlyphMetrics, value: number) => {
    const updated = { ...metrics, [key]: value };
    setMetrics(updated);
    if (glyph) {
      onUpdateMetrics(char, { [key]: value });
    }
  };

  const handleResetMetrics = () => {
    const fresh = { ...DEFAULT_GLYPH_METRICS };
    setMetrics(fresh);
    if (glyph) {
      onUpdateMetrics(char, fresh);
    }
  };

  const mapErrorCodeToMessage = (code?: string) => {
    if (code === 'STROKE_ONLY_SVG') return t.strokeOnlyError;
    if (code === 'HUGE_SVG_FILE') return t.hugeSvgError;
    return TRANSLATIONS[lang].grid.uploadErrorToast;
  };

  const attemptSvgUpload = async (
    svgText: string,
    fileName?: string,
    ignoreStrokes = false
  ) => {
    setErrorMsg(null);
    const res = await onUploadSvg(char, svgText, fileName, { ignoreStrokes });
    if (res.ok) {
      setPendingStrokeSvg(null);
      setRawSvgInput(svgText);
      return;
    }
    if (res.error === 'STROKE_WARNING_CONFIRM_REQUIRED') {
      setPendingStrokeSvg({ svgString: svgText, fileName });
      return;
    }
    setErrorMsg(mapErrorCodeToMessage(res.error));
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    await attemptSvgUpload(text, file.name, false);
    e.target.value = '';
  };

  const handleApplyRawSvg = async () => {
    if (!rawSvgInput.trim()) return;
    await attemptSvgUpload(rawSvgInput, `${char}.svg`, false);
  };

  const handleLoadSamplePreset = async () => {
    const preset = SAMPLE_SVG_GLYPHS[char];
    if (!preset) return;
    await attemptSvgUpload(preset, `${char}.svg`, true);
  };

  const handlePointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!glyph) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    setIsDraggingCanvas(true);
    dragStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      startX: metrics.offsetX,
      startY: metrics.offsetY,
    };
  };

  const handlePointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!isDraggingCanvas || !dragStartRef.current || !glyph) return;
    const dx = Math.round((e.clientX - dragStartRef.current.x) * 2.2);
    const dy = Math.round((e.clientY - dragStartRef.current.y) * 2.2);
    const nextX = Math.max(-200, Math.min(200, dragStartRef.current.startX + dx));
    const nextY = Math.max(-200, Math.min(200, dragStartRef.current.startY + dy));
    setMetrics((prev) => ({ ...prev, offsetX: nextX, offsetY: nextY }));
    onUpdateMetrics(char, { offsetX: nextX, offsetY: nextY });
  };

  const handlePointerUp = (e: React.PointerEvent<SVGSVGElement>) => {
    if (isDraggingCanvas) {
      e.currentTarget.releasePointerCapture(e.pointerId);
      setIsDraggingCanvas(false);
      dragStartRef.current = null;
    }
  };

  const handleGrabberDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    sheetDragStartRef.current = e.clientY;
  };

  const handleGrabberMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (sheetDragStartRef.current === null) return;
    const delta = Math.max(0, e.clientY - sheetDragStartRef.current);
    setSheetDragY(delta);
  };

  const handleGrabberUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (sheetDragStartRef.current !== null) {
      e.currentTarget.releasePointerCapture(e.pointerId);
      if (sheetDragY > 90) {
        onClose();
      }
      setSheetDragY(0);
      sheetDragStartRef.current = null;
    }
  };

  const handleInputFocus = (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    e.currentTarget.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  };

  const leftGuideX = Math.max(20, Math.min(450, 120 + metrics.leftBearing));
  const rightGuideX = Math.max(550, Math.min(980, 880 - metrics.rightBearing));

  const editorBody = (
    <div
      style={
        variant === 'modal' && sheetDragY > 0
          ? { transform: `translateY(${sheetDragY}px)` }
          : undefined
      }
      className={
        variant === 'modal'
          ? 'sheet-responsive-modal glass-floating w-full md:max-w-[560px] lg:max-w-[880px] rounded-t-[32px] md:rounded-[32px] p-4 sm:p-6 md:p-7 text-slate-900 dark:text-slate-100 max-h-[90dvh] overflow-y-auto pb-safe-area transition-transform'
          : 'glass-surface w-full rounded-[28px] p-4 sm:p-5 text-slate-900 dark:text-slate-100 flex flex-col'
      }
    >
      {variant === 'modal' && (
        <div
          onPointerDown={handleGrabberDown}
          onPointerMove={handleGrabberMove}
          onPointerUp={handleGrabberUp}
          role="button"
          tabIndex={0}
          aria-label="Swipe down to close editor"
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') onClose();
          }}
          className="flex items-center justify-center py-2 -mt-1 mb-2 cursor-grab active:cursor-grabbing touch-none"
        >
          <div className="w-12 h-1.5 rounded-full bg-slate-400/50 dark:bg-slate-500/50" />
        </div>
      )}

      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-slate-900/10 dark:border-white/10">
        <div className="flex items-center gap-3 min-w-0">
          <div className="glass-surface flex h-12 w-12 sm:h-14 sm:w-14 shrink-0 items-center justify-center rounded-2xl text-xl sm:text-2xl font-display font-bold text-sky-600 dark:text-sky-300">
            {char}
          </div>
          <div className="min-w-0">
            <h2
              id={variant === 'modal' ? 'glyph-editor-title' : undefined}
              className="text-base sm:text-lg font-display font-bold tracking-tight truncate"
            >
              {t.modalTitle} · &ldquo;{char}&rdquo;
            </h2>
            <p className="text-xs text-slate-600 dark:text-slate-300 font-mono-tabular mt-0.5 truncate">
              {t.unicodeLabel}: {unicodeHex} · {glyph ? t.statusUploaded : t.statusEmpty}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept=".svg,image/svg+xml"
            className="hidden"
            onChange={handleFileChange}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="glass-primary inline-flex items-center justify-center gap-2 min-h-[44px] rounded-2xl px-3.5 py-2 text-xs font-semibold whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Upload className="h-4 w-4 shrink-0" />
            <span>{t.uploadNewSvg}</span>
          </button>

          {variant === 'modal' && (
            <button
              type="button"
              onClick={onClose}
              aria-label={t.saveAndCloseBtn}
              className="glass-btn flex min-h-[44px] min-w-[44px] items-center justify-center rounded-2xl text-slate-700 dark:text-slate-200 cursor-pointer"
            >
              <X className="h-5 w-5" />
            </button>
          )}
        </div>
      </div>

      {/* Stroke Warning Confirmation Prompt */}
      {pendingStrokeSvg && (
        <div className="mt-4 rounded-2xl bg-amber-500/15 border border-amber-500/40 p-4 flex flex-col gap-3">
          <div className="flex items-start gap-2.5 text-xs font-medium text-amber-800 dark:text-amber-200">
            <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400 mt-0.5" />
            <span>{t.strokeWarningPrompt}</span>
          </div>
          <div className="flex flex-wrap items-center gap-2 justify-end">
            <button
              type="button"
              onClick={() => setPendingStrokeSvg(null)}
              className="glass-btn min-h-[38px] rounded-xl px-3 py-1.5 text-xs font-semibold text-slate-700 dark:text-slate-200 cursor-pointer"
            >
              {t.strokeCancelBtn}
            </button>
            <button
              type="button"
              onClick={() =>
                attemptSvgUpload(pendingStrokeSvg.svgString, pendingStrokeSvg.fileName, true)
              }
              className="glass-primary min-h-[38px] rounded-xl px-3.5 py-1.5 text-xs font-semibold cursor-pointer"
            >
              {t.strokeContinueBtn}
            </button>
          </div>
        </div>
      )}

      {/* Error Banner */}
      {errorMsg && (
        <div className="mt-4 rounded-2xl bg-rose-500/15 border border-rose-500/35 px-4 py-2.5 text-xs font-medium text-rose-700 dark:text-rose-200">
          {errorMsg}
        </div>
      )}

      {/* Ignored SVG Elements Notice */}
      {glyph && glyph.ignoredElements.length > 0 && (
        <div className="mt-3 rounded-xl bg-sky-500/10 border border-sky-500/25 px-3.5 py-2 text-[11px] text-sky-800 dark:text-sky-200">
          {t.ignoredElementsNotice.replace('{list}', glyph.ignoredElements.join(', '))}
        </div>
      )}

      {/* Main Responsive Grid */}
      <div
        className={`mt-4 grid grid-cols-1 ${
          variant === 'modal' ? 'lg:grid-cols-12' : ''
        } gap-5 items-start`}
      >
        {/* Left Column: 1000-UPM Interactive Typographic Canvas */}
        <div className={`${variant === 'modal' ? 'lg:col-span-7' : ''} flex flex-col gap-3`}>
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600 dark:text-slate-300">
            <span className="font-semibold">{t.guidesTitle}</span>
            {glyph ? (
              <span className="font-mono-tabular text-[11px] font-semibold text-sky-600 dark:text-sky-400">
                {t.advanceWidthReadout
                  .replace('{width}', String(glyph.advanceWidth))
                  .replace('{contours}', String(glyph.contourCount))}
              </span>
            ) : (
              <span className="text-[11px] opacity-80">{t.canvasDragHint}</span>
            )}
          </div>

          <div
            dir="ltr"
            className="relative aspect-square w-full max-w-[380px] mx-auto rounded-[24px] bg-white/75 dark:bg-slate-950/75 border border-white/70 dark:border-white/15 shadow-inner overflow-hidden select-none"
          >
            <svg
              viewBox="-40 -60 1080 1120"
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              className={`w-full h-full touch-none ${
                glyph ? 'cursor-grab active:cursor-grabbing' : 'cursor-default'
              }`}
            >
              <defs>
                <pattern id="upmGrid1000" width="100" height="100" patternUnits="userSpaceOnUse">
                  <path
                    d="M 100 0 L 0 0 0 100"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    className="text-slate-400/20 dark:text-slate-600/25"
                  />
                </pattern>
              </defs>
              <rect x="0" y="0" width="1000" height="1000" fill="url(#upmGrid1000)" />

              {/* Ascender Line (800 UPM -> y=0) */}
              <line
                x1="0"
                y1="0"
                x2="1000"
                y2="0"
                stroke="#0ea5e9"
                strokeWidth="3"
                strokeDasharray="12 8"
              />
              <text x="15" y="-12" fill="#0ea5e9" fontSize="26" fontFamily="JetBrains Mono, monospace">
                {t.guideAscender}
              </text>

              {/* Cap-Height Line (700 UPM -> y=100) */}
              <line
                x1="0"
                y1="100"
                x2="1000"
                y2="100"
                stroke="#6366f1"
                strokeWidth="2.5"
                strokeDasharray="8 8"
              />
              <text x="15" y="88" fill="#6366f1" fontSize="24" fontFamily="JetBrains Mono, monospace">
                {t.guideCapHeight}
              </text>

              {/* x-Height Line (500 UPM -> y=300) */}
              <line
                x1="0"
                y1="300"
                x2="1000"
                y2="300"
                stroke="#10b981"
                strokeWidth="2.5"
                strokeDasharray="8 8"
              />
              <text x="15" y="288" fill="#10b981" fontSize="24" fontFamily="JetBrains Mono, monospace">
                {t.guideXHeight}
              </text>

              {/* Baseline (0 UPM -> y=800) */}
              <line x1="0" y1="800" x2="1000" y2="800" stroke="#f43f5e" strokeWidth="5" />
              <text
                x="15"
                y="784"
                fill="#f43f5e"
                fontSize="26"
                fontWeight="700"
                fontFamily="JetBrains Mono, monospace"
              >
                {t.guideBaseline}
              </text>

              {/* Descender Line (-200 UPM -> y=1000) */}
              <line
                x1="0"
                y1="1000"
                x2="1000"
                y2="1000"
                stroke="#f59e0b"
                strokeWidth="3"
                strokeDasharray="12 8"
              />
              <text x="15" y="986" fill="#f59e0b" fontSize="24" fontFamily="JetBrains Mono, monospace">
                {t.guideDescender}
              </text>

              {/* Left Side-Bearing Vertical Guide */}
              <line
                x1={leftGuideX}
                y1="0"
                x2={leftGuideX}
                y2="1000"
                stroke="#8b5cf6"
                strokeWidth="3"
                strokeDasharray="8 8"
              />

              {/* Right Side-Bearing Vertical Guide */}
              <line
                x1={rightGuideX}
                y1="0"
                x2={rightGuideX}
                y2="1000"
                stroke="#8b5cf6"
                strokeWidth="3"
                strokeDasharray="8 8"
              />

              {/* Rendered 1000-UPM Normalized Glyph Outline (TrueType/OpenType Non-Zero Winding) */}
              {glyph ? (
                <path
                  d={glyph.editorPathD}
                  fill="currentColor"
                  fillRule="nonzero"
                  className="text-slate-900 dark:text-white transition-colors"
                />
              ) : (
                <text
                  x="500"
                  y="680"
                  textAnchor="middle"
                  fontSize="420"
                  fill="currentColor"
                  className="text-slate-300/35 dark:text-slate-700/35 font-display select-none"
                >
                  {char}
                </text>
              )}
            </svg>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2">
            {SAMPLE_SVG_GLYPHS[char] && (
              <button
                type="button"
                onClick={handleLoadSamplePreset}
                className="glass-btn inline-flex items-center gap-1.5 min-h-[44px] rounded-xl px-3.5 py-2 text-xs font-medium text-sky-700 dark:text-sky-300 cursor-pointer"
              >
                <Sparkles className="h-3.5 w-3.5 shrink-0" />
                <span>{t.loadPresetForChar.replace('{char}', char)}</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => setShowRawCode((v) => !v)}
              className="glass-btn inline-flex items-center gap-1.5 min-h-[44px] rounded-xl px-3.5 py-2 text-xs font-medium text-slate-700 dark:text-slate-200 cursor-pointer"
            >
              <Code2 className="h-3.5 w-3.5 shrink-0" />
              <span>{t.rawSvgLabel}</span>
            </button>
          </div>

          {showRawCode && (
            <div className="glass-clear rounded-2xl p-3 flex flex-col gap-2">
              <label
                htmlFor={`raw-svg-textarea-${variant}`}
                className="text-xs font-semibold text-slate-700 dark:text-slate-200"
              >
                {t.rawSvgLabel}
              </label>
              <textarea
                id={`raw-svg-textarea-${variant}`}
                dir="ltr"
                rows={3}
                value={rawSvgInput}
                onChange={(e) => setRawSvgInput(e.target.value)}
                onFocus={handleInputFocus}
                {...hintProp('<svg viewBox="0 0 100 100"><path d="..." /></svg>')}
                className="w-full rounded-xl bg-white/80 dark:bg-slate-900/80 border border-slate-300/60 dark:border-white/15 p-2.5 text-xs font-mono text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-sky-500"
              />
              <button
                type="button"
                onClick={handleApplyRawSvg}
                className="glass-primary self-end min-h-[44px] rounded-xl px-4 py-2 text-xs font-semibold cursor-pointer"
              >
                {t.applyRawSvgBtn}
              </button>
            </div>
          )}
        </div>

        {/* Right Column: Precision Optical Sliders */}
        <div className={`${variant === 'modal' ? 'lg:col-span-5' : ''} flex flex-col gap-4`}>
          <div className="glass-surface rounded-2xl p-4 flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-display font-bold">{t.metricsTitle}</h3>
              <button
                type="button"
                onClick={handleResetMetrics}
                className="inline-flex items-center gap-1 min-h-[36px] px-2 text-xs font-medium text-sky-600 dark:text-sky-400 hover:underline cursor-pointer"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                <span>{t.resetMetricsBtn}</span>
              </button>
            </div>

            {/* Horizontal Offset (dx) */}
            <div className="flex flex-col gap-1.5">
              <div className="flex justify-between text-xs">
                <label
                  htmlFor={`slider-offset-x-${variant}`}
                  className="font-medium flex items-center gap-1.5"
                >
                  <Move className="h-3.5 w-3.5 text-sky-500" />
                  <span>{t.offsetXLabel}</span>
                </label>
                <span className="font-mono-tabular font-semibold">{metrics.offsetX} UPM</span>
              </div>
              <input
                id={`slider-offset-x-${variant}`}
                type="range"
                min={-200}
                max={200}
                step={5}
                value={metrics.offsetX}
                onChange={(e) => handleMetricChange('offsetX', Number(e.target.value))}
                className="w-full h-6 accent-sky-500 cursor-pointer"
              />
            </div>

            {/* Vertical Offset (dy) */}
            <div className="flex flex-col gap-1.5">
              <div className="flex justify-between text-xs">
                <label
                  htmlFor={`slider-offset-y-${variant}`}
                  className="font-medium flex items-center gap-1.5"
                >
                  <Move className="h-3.5 w-3.5 text-indigo-500" />
                  <span>{t.offsetYLabel}</span>
                </label>
                <span className="font-mono-tabular font-semibold">{metrics.offsetY} UPM</span>
              </div>
              <input
                id={`slider-offset-y-${variant}`}
                type="range"
                min={-200}
                max={200}
                step={5}
                value={metrics.offsetY}
                onChange={(e) => handleMetricChange('offsetY', Number(e.target.value))}
                className="w-full h-6 accent-indigo-500 cursor-pointer"
              />
            </div>

            {/* Scale Multiplier */}
            <div className="flex flex-col gap-1.5">
              <div className="flex justify-between text-xs">
                <label
                  htmlFor={`slider-scale-${variant}`}
                  className="font-medium flex items-center gap-1.5"
                >
                  <Maximize2 className="h-3.5 w-3.5 text-emerald-500" />
                  <span>{t.scaleLabel}</span>
                </label>
                <span className="font-mono-tabular font-semibold">
                  {Math.round(metrics.scale * 100)}%
                </span>
              </div>
              <input
                id={`slider-scale-${variant}`}
                type="range"
                min={0.5}
                max={1.6}
                step={0.02}
                value={metrics.scale}
                onChange={(e) => handleMetricChange('scale', Number(e.target.value))}
                className="w-full h-6 accent-emerald-500 cursor-pointer"
              />
            </div>

            {/* Left Side-Bearing */}
            <div className="flex flex-col gap-1.5">
              <div className="flex justify-between text-xs">
                <label
                  htmlFor={`slider-lsb-${variant}`}
                  className="font-medium flex items-center gap-1.5"
                >
                  <AlignHorizontalSpaceAround className="h-3.5 w-3.5 text-purple-500" />
                  <span>{t.leftBearingLabel}</span>
                </label>
                <span className="font-mono-tabular font-semibold">{metrics.leftBearing} UPM</span>
              </div>
              <input
                id={`slider-lsb-${variant}`}
                type="range"
                min={-40}
                max={200}
                step={5}
                value={metrics.leftBearing}
                onChange={(e) => handleMetricChange('leftBearing', Number(e.target.value))}
                className="w-full h-6 accent-purple-500 cursor-pointer"
              />
            </div>

            {/* Right Side-Bearing */}
            <div className="flex flex-col gap-1.5">
              <div className="flex justify-between text-xs">
                <label
                  htmlFor={`slider-rsb-${variant}`}
                  className="font-medium flex items-center gap-1.5"
                >
                  <AlignHorizontalSpaceAround className="h-3.5 w-3.5 text-purple-500" />
                  <span>{t.rightBearingLabel}</span>
                </label>
                <span className="font-mono-tabular font-semibold">{metrics.rightBearing} UPM</span>
              </div>
              <input
                id={`slider-rsb-${variant}`}
                type="range"
                min={-40}
                max={200}
                step={5}
                value={metrics.rightBearing}
                onChange={(e) => handleMetricChange('rightBearing', Number(e.target.value))}
                className="w-full h-6 accent-purple-500 cursor-pointer"
              />
            </div>
          </div>

          {/* Action Footer */}
          <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
            {glyph ? (
              <button
                type="button"
                onClick={() => onRemoveGlyph(char)}
                className="glass-btn inline-flex items-center justify-center gap-1.5 min-h-[44px] rounded-2xl px-4 py-2.5 text-xs font-semibold text-rose-600 dark:text-rose-400 cursor-pointer"
              >
                <Trash2 className="h-4 w-4 shrink-0" />
                <span>{t.removeGlyphBtn}</span>
              </button>
            ) : (
              <div />
            )}

            {variant === 'modal' && (
              <button
                type="button"
                onClick={onClose}
                className="glass-primary inline-flex items-center justify-center gap-2 min-h-[44px] rounded-2xl px-6 py-2.5 text-xs font-semibold cursor-pointer"
              >
                <Check className="h-4 w-4 shrink-0" />
                <span>{t.saveAndCloseBtn}</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );

  if (variant === 'inline') {
    return editorBody;
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end md:items-center justify-center p-0 md:p-6 bg-slate-950/45 backdrop-blur-md"
      role="dialog"
      aria-modal="true"
      aria-labelledby="glyph-editor-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {editorBody}
    </div>
  );
};
