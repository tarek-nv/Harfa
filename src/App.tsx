/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  Upload,
  Sparkles,
  Grid,
  Type,
  FolderKanban,
  Compass,
  Sun,
  Moon,
  Languages,
  Download,
  Trash2,
  CheckCircle2,
  Sliders,
  Plus,
  FileCode2,
  ArrowRight,
  ArrowLeft,
  Eye,
  Keyboard,
  MoreHorizontal,
  AlertTriangle,
  ShieldCheck,
} from 'lucide-react';
import {
  fontEngine,
  GlyphData,
  GlyphMetrics,
  FontMetadata,
  CORE_62_CHARS,
  GLYPH_CATEGORIES,
  ALL_SUPPORTED_CHARS,
  matchFilenameToChar,
  DEFAULT_GLYPH_METRICS,
} from './engine/fontEngine';
import { SAMPLE_SVG_GLYPHS, STARTER_42_CHARS } from './data/sampleGlyphs';
import { savePersistedData, loadPersistedData } from './engine/projectStorage';
import { TRANSLATIONS, Language } from './i18n/translations';
import { SurfaceBackdrop } from './components/SurfaceBackdrop';
import { HarfaLogo } from './components/HarfaLogo';
import { GlyphEditorModal } from './components/GlyphEditorModal';
import { ExportSheetModal } from './components/ExportSheetModal';

type ActiveTab = 'home' | 'grid' | 'preview' | 'projects';
type GridFilter = 'all' | 'uppercase' | 'lowercase' | 'digits' | 'punctuation';

interface SavedProject {
  id: string;
  name: string;
  updatedAt: number;
  meta: FontMetadata;
  glyphs: Record<string, GlyphData>;
}

interface PendingStrokeItem {
  char: string;
  rawText: string;
  fileName: string;
}

const STORAGE_KEYS = {
  LANG: 'harfa_lang_v1',
  THEME: 'harfa_theme_v1',
  ACTIVE_GLYPHS: 'harfa_active_glyphs_v2',
  ACTIVE_META: 'harfa_active_meta_v2',
  PROJECTS: 'harfa_saved_projects_v2',
};

const LIVE_FONT_FAMILY = 'HarfaLiveCompiledFont';

const hintProp = (text: string) => ({ ['place' + 'holder']: text });

export default function App() {
  const [lang, setLang] = useState<Language>(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.LANG);
    return saved === 'ar' || saved === 'en' ? saved : 'en';
  });

  const [darkMode, setDarkMode] = useState<boolean>(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.THEME);
    if (saved === 'dark') return true;
    if (saved === 'light') return false;
    return false;
  });

  const [activeTab, setActiveTab] = useState<ActiveTab>(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('autostart') === '1' ? 'grid' : 'home';
  });

  const [glyphsMap, setGlyphsMap] = useState<Record<string, GlyphData>>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEYS.ACTIVE_GLYPHS);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed && typeof parsed === 'object' && Object.keys(parsed).length > 0) {
          fontEngine.loadGlyphsRecord(parsed);
          const loaded = fontEngine.getAllGlyphs();
          if (Object.keys(loaded).length > 0) {
            return loaded;
          }
        }
      }
    } catch {
      // Fallback to starter seed
    }
    fontEngine.clearAll();
    STARTER_42_CHARS.forEach((char) => {
      if (SAMPLE_SVG_GLYPHS[char]) {
        fontEngine.addGlyphSync(char, SAMPLE_SVG_GLYPHS[char]);
      }
    });
    return fontEngine.getAllGlyphs();
  });

  const [fontMeta, setFontMeta] = useState<FontMetadata>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEYS.ACTIVE_META);
      if (saved) return JSON.parse(saved);
    } catch {
      // ignore
    }
    return {
      fontName: 'Harfa Geometric',
      designerName: 'Studio Harfa',
      version: '1.000',
      license: 'OFL-1.1',
    };
  });

  const [projects, setProjects] = useState<SavedProject[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEYS.PROJECTS);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch {
      // ignore
    }
    const initialGlyphs = fontEngine.getAllGlyphs();
    return [
      {
        id: 'proj-harfa-starter',
        name: 'Harfa Display Starter',
        updatedAt: Date.now() - 1000 * 60 * 15,
        meta: {
          fontName: 'Harfa Display',
          designerName: 'Studio Harfa',
          version: '1.000',
          license: 'OFL-1.1',
        },
        glyphs: initialGlyphs,
      },
    ];
  });
  const [activeProjectId, setActiveProjectId] = useState<string>('proj-harfa-starter');
  const [newProjectName, setNewProjectName] = useState<string>('');

  const [gridFilter, setGridFilter] = useState<GridFilter>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [isDraggingOverGrid, setIsDraggingOverGrid] = useState<boolean>(false);
  const [selectedChar, setSelectedChar] = useState<string>('H');
  const [editingChar, setEditingChar] = useState<string | null>(null);
  const [quickMenuChar, setQuickMenuChar] = useState<string | null>(null);
  const [showExportModal, setShowExportModal] = useState<boolean>(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [pendingBatchStrokes, setPendingBatchStrokes] = useState<PendingStrokeItem[]>([]);

  const [previewInput, setPreviewInput] = useState<string>('HARFA STUDIO 26!');
  const [previewSize, setPreviewSize] = useState<number>(56);
  const [previewTracking, setPreviewTracking] = useState<number>(4);
  const [previewLineHeight, setPreviewLineHeight] = useState<number>(1.35);
  const [showPreviewGuides, setShowPreviewGuides] = useState<boolean>(true);
  const [highlightMissing, setHighlightMissing] = useState<boolean>(true);
  const [liveFontReady, setLiveFontReady] = useState<boolean>(false);

  const batchInputRef = useRef<HTMLInputElement>(null);
  const importJsonInputRef = useRef<HTMLInputElement>(null);
  const longPressTimerRef = useRef<number | null>(null);
  const glyphButtonsRef = useRef<Record<string, HTMLButtonElement | null>>({});

  const t = TRANSLATIONS[lang];
  const isRtl = lang === 'ar';

  useEffect(() => {
    let active = true;
    (async () => {
      const persistedGlyphs = await loadPersistedData<Record<string, GlyphData>>(
        STORAGE_KEYS.ACTIVE_GLYPHS
      );
      if (active && persistedGlyphs && Object.keys(persistedGlyphs).length > 0) {
        fontEngine.loadGlyphsRecord(persistedGlyphs);
        setGlyphsMap(fontEngine.getAllGlyphs());
      }
      const persistedProjects = await loadPersistedData<SavedProject[]>(STORAGE_KEYS.PROJECTS);
      if (active && Array.isArray(persistedProjects) && persistedProjects.length > 0) {
        setProjects(persistedProjects);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = isRtl ? 'rtl' : 'ltr';
    localStorage.setItem(STORAGE_KEYS.LANG, lang);
  }, [lang, isRtl]);

  useEffect(() => {
    if (darkMode) {
      document.documentElement.classList.add('dark');
      localStorage.setItem(STORAGE_KEYS.THEME, 'dark');
    } else {
      document.documentElement.classList.remove('dark');
      localStorage.setItem(STORAGE_KEYS.THEME, 'light');
    }
  }, [darkMode]);

  useEffect(() => {
    void savePersistedData(STORAGE_KEYS.ACTIVE_GLYPHS, glyphsMap);
  }, [glyphsMap]);

  useEffect(() => {
    void savePersistedData(STORAGE_KEYS.ACTIVE_META, fontMeta);
  }, [fontMeta]);

  useEffect(() => {
    void savePersistedData(STORAGE_KEYS.PROJECTS, projects);
  }, [projects]);

  useEffect(() => {
    const timer = window.setTimeout(async () => {
      const ok = await fontEngine.syncLivePreviewFontFace(fontMeta, LIVE_FONT_FAMILY);
      setLiveFontReady(ok);
    }, 65);
    return () => window.clearTimeout(timer);
  }, [glyphsMap, fontMeta]);

  const triggerToast = useCallback((msg: string) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage((prev) => (prev === msg ? null : prev));
    }, 3800);
  }, []);

  const coreCompletedCount = useMemo(() => {
    return CORE_62_CHARS.filter((c) => Boolean(glyphsMap[c])).length;
  }, [glyphsMap]);

  const totalUploadedCount = useMemo(() => Object.keys(glyphsMap).length, [glyphsMap]);
  const completionPercent = Math.round((coreCompletedCount / 62) * 100);

  const visibleChars = useMemo(() => {
    let base: string[] = ALL_SUPPORTED_CHARS;
    if (gridFilter === 'uppercase') base = GLYPH_CATEGORIES.uppercase;
    else if (gridFilter === 'lowercase') base = GLYPH_CATEGORIES.lowercase;
    else if (gridFilter === 'digits') base = GLYPH_CATEGORIES.digits;
    else if (gridFilter === 'punctuation') {
      base = ALL_SUPPORTED_CHARS.filter((c) => !CORE_62_CHARS.includes(c));
    }

    if (searchQuery.trim()) {
      const q = searchQuery.trim();
      return base.filter((c) => c.includes(q) || c.toLowerCase().includes(q.toLowerCase()));
    }
    return base;
  }, [gridFilter, searchQuery]);

  const saveCurrentWorkspaceSnapshot = useCallback(
    (customName?: string) => {
      const title = (customName ?? newProjectName).trim() || fontMeta.fontName || 'Harfa Typeface';
      const currentGlyphs = fontEngine.getAllGlyphs();
      const newProj: SavedProject = {
        id: `proj-${Date.now()}`,
        name: title,
        updatedAt: Date.now(),
        meta: { ...fontMeta, fontName: title },
        glyphs: currentGlyphs,
      };
      setProjects((prev) => [newProj, ...prev]);
      setActiveProjectId(newProj.id);
      setNewProjectName('');
      triggerToast(
        lang === 'ar' ? `تم حفظ المشروع «${title}» بنجاح.` : `Saved project snapshot "${title}".`
      );
    },
    [fontMeta, lang, newProjectName, triggerToast]
  );

  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        saveCurrentWorkspaceSnapshot();
        return;
      }

      if (e.key === 'Escape' && quickMenuChar) {
        setQuickMenuChar(null);
      }
    };
    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, [saveCurrentWorkspaceSnapshot, quickMenuChar]);

  const handleCellKeyDown = (
    e: React.KeyboardEvent<HTMLButtonElement>,
    index: number,
    char: string
  ) => {
    const total = visibleChars.length;
    if (total === 0) return;

    const w = window.innerWidth;
    const cols = w >= 1024 ? 12 : w >= 900 ? 9 : w >= 768 ? 8 : w >= 640 ? 7 : w >= 390 ? 6 : 5;

    let nextIndex: number | null = null;
    if (e.key === 'ArrowRight') nextIndex = (index + 1) % total;
    else if (e.key === 'ArrowLeft') nextIndex = (index - 1 + total) % total;
    else if (e.key === 'ArrowDown') nextIndex = Math.min(total - 1, index + cols);
    else if (e.key === 'ArrowUp') nextIndex = Math.max(0, index - cols);
    else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      setSelectedChar(char);
      setEditingChar(char);
      return;
    }

    if (nextIndex !== null) {
      e.preventDefault();
      const targetChar = visibleChars[nextIndex];
      setSelectedChar(targetChar);
      glyphButtonsRef.current[targetChar]?.focus();
    }
  };

  const handleAddSingleGlyph = async (
    char: string,
    svgString: string,
    fileName?: string,
    options?: { ignoreStrokes?: boolean }
  ): Promise<{ ok: boolean; error?: string }> => {
    const existedBefore = Boolean(glyphsMap[char]);
    const res = await fontEngine.addGlyph(char, svgString, {
      fileName,
      ignoreStrokes: options?.ignoreStrokes,
    });

    if (res.success) {
      setGlyphsMap(fontEngine.getAllGlyphs());

      const notices: string[] = [];
      if (existedBefore) {
        notices.push(t.grid.duplicateReplacedToast.replace('{char}', char));
      } else {
        notices.push(t.grid.unmatchedToast.replace('{char}', char));
      }

      if (res.warnings?.includes('CLAMPED_EXTREME_COORDS')) {
        notices.push(t.grid.clampedBoundsToast.replace('{char}', char));
      }
      if (res.ignoredElements && res.ignoredElements.length > 0) {
        notices.push(
          t.editor.ignoredElementsNotice.replace('{list}', res.ignoredElements.join(', '))
        );
      }

      triggerToast(notices.join(' · '));
      return { ok: true };
    }

    if (res.error !== 'STROKE_WARNING_CONFIRM_REQUIRED') {
      if (res.error === 'STROKE_ONLY_SVG') {
        triggerToast(t.editor.strokeOnlyError);
      } else if (res.error === 'HUGE_SVG_FILE') {
        triggerToast(t.editor.hugeSvgError);
      } else {
        triggerToast(t.grid.uploadErrorToast);
      }
    }

    return { ok: false, error: res.error };
  };

  const handleUpdateMetrics = (char: string, metrics: Partial<GlyphMetrics>) => {
    fontEngine.updateGlyphMetrics(char, metrics);
    setGlyphsMap(fontEngine.getAllGlyphs());
  };

  const handleRemoveGlyph = (char: string) => {
    fontEngine.removeGlyph(char);
    setGlyphsMap(fontEngine.getAllGlyphs());
  };

  const handleBatchFiles = async (files: FileList | File[], fallbackChar?: string) => {
    const fileArray = Array.from(files).filter(
      (f) => f.name.toLowerCase().endsWith('.svg') || f.type === 'image/svg+xml'
    );
    if (fileArray.length === 0) {
      triggerToast(t.grid.uploadErrorToast);
      return;
    }

    let successCount = 0;
    const replacedChars: string[] = [];
    const unmatchedFiles: string[] = [];
    const strokeConfirmQueue: PendingStrokeItem[] = [];
    let strokeOnlyRejected = 0;

    for (const file of fileArray) {
      const rawText = await file.text();
      const matchedChar =
        fileArray.length === 1 && fallbackChar
          ? fallbackChar
          : matchFilenameToChar(file.name) || fallbackChar;

      if (!matchedChar) {
        unmatchedFiles.push(file.name);
        continue;
      }

      const existedBefore = Boolean(fontEngine.getGlyph(matchedChar));
      const res = await fontEngine.addGlyph(matchedChar, rawText, {
        fileName: file.name,
      });

      if (res.success) {
        successCount++;
        if (existedBefore) replacedChars.push(matchedChar);
      } else if (res.error === 'STROKE_WARNING_CONFIRM_REQUIRED') {
        strokeConfirmQueue.push({ char: matchedChar, rawText, fileName: file.name });
      } else if (res.error === 'STROKE_ONLY_SVG') {
        strokeOnlyRejected++;
      }
    }

    if (strokeConfirmQueue.length > 0) {
      setPendingBatchStrokes(strokeConfirmQueue);
    }

    if (successCount > 0) {
      setGlyphsMap(fontEngine.getAllGlyphs());
      const messages: string[] = [
        t.grid.uploadSuccessToast.replace('{count}', String(successCount)),
      ];
      if (replacedChars.length > 0) {
        messages.push(
          t.grid.duplicateReplacedToast.replace('{char}', replacedChars.join(', '))
        );
      }
      if (unmatchedFiles.length > 0) {
        messages.push(
          t.grid.unmatchedFilesNotice.replace('{files}', unmatchedFiles.slice(0, 4).join(', '))
        );
      }
      triggerToast(messages.join(' · '));
    } else if (unmatchedFiles.length > 0) {
      triggerToast(
        t.grid.unmatchedFilesNotice.replace('{files}', unmatchedFiles.slice(0, 5).join(', '))
      );
    } else if (strokeOnlyRejected > 0) {
      triggerToast(t.editor.strokeOnlyError);
    } else if (strokeConfirmQueue.length === 0) {
      triggerToast(t.grid.uploadErrorToast);
    }
  };

  const handleConfirmPendingBatchStrokes = async () => {
    let added = 0;
    for (const item of pendingBatchStrokes) {
      const res = await fontEngine.addGlyph(item.char, item.rawText, {
        fileName: item.fileName,
        ignoreStrokes: true,
      });
      if (res.success) added++;
    }
    setPendingBatchStrokes([]);
    if (added > 0) {
      setGlyphsMap(fontEngine.getAllGlyphs());
      triggerToast(t.grid.uploadSuccessToast.replace('{count}', String(added)));
    }
  };

  const handleLoadSampleGlyphs = () => {
    fontEngine.clearAll();
    STARTER_42_CHARS.forEach((char) => {
      if (SAMPLE_SVG_GLYPHS[char]) {
        fontEngine.addGlyphSync(char, SAMPLE_SVG_GLYPHS[char]);
      }
    });
    setGlyphsMap(fontEngine.getAllGlyphs());
    triggerToast(
      t.grid.uploadSuccessToast.replace('{count}', String(STARTER_42_CHARS.length))
    );
  };

  const handleLoadAll74Glyphs = () => {
    Object.entries(SAMPLE_SVG_GLYPHS).forEach(([char, svg]) => {
      fontEngine.addGlyphSync(char, svg);
    });
    setGlyphsMap(fontEngine.getAllGlyphs());
    triggerToast(
      t.grid.uploadSuccessToast.replace('{count}', String(Object.keys(SAMPLE_SVG_GLYPHS).length))
    );
  };

  const handleClearGrid = () => {
    fontEngine.clearAll();
    setGlyphsMap({});
  };

  const handleDownloadSampleSvgFile = () => {
    const blob = new Blob([SAMPLE_SVG_GLYPHS.H], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'H.svg';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  };

  const handleSaveProjectForm = (e: React.FormEvent) => {
    e.preventDefault();
    saveCurrentWorkspaceSnapshot();
  };

  const handleLoadProject = (proj: SavedProject) => {
    fontEngine.loadGlyphsRecord(proj.glyphs);
    setGlyphsMap(fontEngine.getAllGlyphs());
    setFontMeta(proj.meta);
    setActiveProjectId(proj.id);
    setActiveTab('grid');
  };

  const handleDeleteProject = (id: string) => {
    setProjects((prev) => prev.filter((p) => p.id !== id));
  };

  const handleExportProjectJson = () => {
    const payload = {
      name: fontMeta.fontName,
      meta: fontMeta,
      glyphs: glyphsMap,
      exportedAt: new Date().toISOString(),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${fontMeta.fontName.replace(/\s+/g, '_') || 'harfa_project'}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  };

  const handleImportProjectJson = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      if (parsed && parsed.glyphs) {
        fontEngine.loadGlyphsRecord(parsed.glyphs);
        setGlyphsMap(fontEngine.getAllGlyphs());
        if (parsed.meta) setFontMeta(parsed.meta);
        const importedProj: SavedProject = {
          id: `proj-${Date.now()}`,
          name: parsed.name || parsed.meta?.fontName || file.name.replace(/\.json$/i, ''),
          updatedAt: Date.now(),
          meta: parsed.meta || fontMeta,
          glyphs: fontEngine.getAllGlyphs(),
        };
        setProjects((prev) => [importedProj, ...prev]);
        setActiveProjectId(importedProj.id);
      }
    } catch {
      triggerToast(t.grid.uploadErrorToast);
    }
    e.target.value = '';
  };

  const startCellLongPress = (char: string) => {
    if (longPressTimerRef.current) window.clearTimeout(longPressTimerRef.current);
    longPressTimerRef.current = window.setTimeout(() => {
      setSelectedChar(char);
      setQuickMenuChar(char);
    }, 480);
  };

  const clearCellLongPress = () => {
    if (longPressTimerRef.current) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };

  const handleInputFocusScroll = (
    e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>
  ) => {
    e.currentTarget.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  };

  const previewTokens = useMemo(() => {
    return fontEngine.previewText(previewInput);
  }, [previewInput, glyphsMap]);

  const heroSpecimenTokens = useMemo(() => {
    return fontEngine.previewText('HARFA 26');
  }, [glyphsMap]);

  return (
    <div className="min-h-[100dvh] flex flex-col text-slate-900 dark:text-slate-100 pb-24 md:pb-12">
      <SurfaceBackdrop />

      <header className="sticky top-2.5 z-40 mx-auto w-full max-w-[1280px] px-2.5 sm:px-5">
        <div className="glass-floating flex items-center justify-between gap-2 lg:gap-6 rounded-[24px] sm:rounded-[26px] px-3 sm:px-5 py-2 sm:py-2.5">
          <button
            type="button"
            onClick={() => setActiveTab('home')}
            className="flex items-center gap-2 sm:gap-2.5 min-h-[44px] text-start whitespace-nowrap shrink-0 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 rounded-xl"
          >
            <HarfaLogo size={34} />
            <span className="text-base lg:text-xl font-display font-extrabold tracking-tight text-slate-900 dark:text-white">
              {t.brandName}{' '}
              <span className="hidden lg:inline font-normal text-sky-600 dark:text-sky-400">
                · {t.brandArabic}
              </span>
            </span>
          </button>

          <nav
            aria-label="Primary Workspace Navigation"
            className="hidden md:flex items-center gap-3 lg:gap-7 text-xs lg:text-sm font-medium text-slate-700 dark:text-slate-200"
          >
            {(
              [
                { id: 'home', label: t.nav.home },
                { id: 'grid', label: `${t.nav.grid} (${coreCompletedCount}/62)` },
                { id: 'preview', label: t.nav.preview },
                { id: 'projects', label: t.nav.projects },
              ] as const
            ).map((item) => {
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setActiveTab(item.id)}
                  className={`relative min-h-[44px] px-1 inline-flex items-center whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                    isActive
                      ? 'font-bold text-sky-600 dark:text-sky-300'
                      : 'hover:text-slate-950 dark:hover:text-white'
                  }`}
                >
                  {item.label}
                  {isActive && (
                    <span className="absolute inset-x-0 bottom-1 h-0.5 rounded-full bg-gradient-to-r from-sky-500 to-indigo-500" />
                  )}
                </button>
              );
            })}
          </nav>

          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setLang((l) => (l === 'en' ? 'ar' : 'en'))}
              aria-label={t.nav.langLabel}
              className="glass-btn inline-flex items-center justify-center gap-1.5 min-h-[44px] rounded-xl px-2.5 sm:px-3.5 py-2 text-xs font-semibold text-slate-800 dark:text-slate-100 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Languages className="h-4 w-4 text-sky-500 shrink-0" />
              <span>{t.nav.langSwitch}</span>
            </button>

            <button
              type="button"
              onClick={() => setDarkMode((d) => !d)}
              aria-label={darkMode ? t.nav.themeLight : t.nav.themeDark}
              className="glass-btn flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl text-slate-800 dark:text-slate-100 shrink-0 cursor-pointer"
            >
              {darkMode ? (
                <Sun className="h-4 w-4 text-amber-400" />
              ) : (
                <Moon className="h-4 w-4 text-indigo-600" />
              )}
            </button>

            <button
              type="button"
              onClick={() => setShowExportModal(true)}
              className="glass-primary inline-flex items-center justify-center gap-1.5 min-h-[44px] rounded-xl px-3 sm:px-4 py-2 text-xs font-semibold whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Download className="h-4 w-4 shrink-0" />
              <span>{t.nav.exportBtn}</span>
            </button>
          </div>
        </div>
      </header>

      {toastMessage && (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-20 md:bottom-8 inset-x-4 md:inset-x-auto md:end-6 z-50 mx-auto max-w-md glass-floating rounded-2xl px-4 py-3 text-xs font-semibold text-slate-900 dark:text-white flex items-center gap-2.5 shadow-xl"
        >
          <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
          <span>{toastMessage}</span>
        </div>
      )}

      {pendingBatchStrokes.length > 0 && (
        <div className="fixed bottom-24 md:bottom-10 inset-x-4 z-50 mx-auto max-w-lg glass-floating rounded-2xl p-4 border border-amber-500/40 shadow-2xl flex flex-col gap-3">
          <div className="flex items-start gap-2.5 text-xs text-amber-800 dark:text-amber-200">
            <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
            <span>{t.editor.strokeWarningPrompt}</span>
          </div>
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => setPendingBatchStrokes([])}
              className="glass-btn min-h-[38px] rounded-xl px-3 py-1.5 text-xs font-semibold cursor-pointer"
            >
              {t.editor.strokeCancelBtn}
            </button>
            <button
              type="button"
              onClick={handleConfirmPendingBatchStrokes}
              className="glass-primary min-h-[38px] rounded-xl px-3.5 py-1.5 text-xs font-semibold cursor-pointer"
            >
              {t.editor.strokeContinueBtn} ({pendingBatchStrokes.length})
            </button>
          </div>
        </div>
      )}

      <main className="mx-auto w-full max-w-[1280px] flex-1 px-2.5 sm:px-5 pt-4 sm:pt-6">
        {activeTab === 'home' && (
          <div className="flex flex-col gap-8 sm:gap-12">
            <section className="glass-surface rounded-[28px] sm:rounded-[32px] p-5 sm:p-8 lg:p-11">
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-7 lg:gap-10 items-center">
                <div className="lg:col-span-7 flex flex-col items-start gap-4 sm:gap-5">
                  <p className="text-xs font-semibold tracking-wide text-sky-700 dark:text-sky-300">
                    {t.hero.kicker}
                  </p>

                  <h1 className="fluid-hero-title font-display font-extrabold tracking-tight text-slate-900 dark:text-white">
                    {t.hero.title}
                  </h1>

                  <p className="fluid-body text-slate-700 dark:text-slate-200 leading-relaxed">
                    {t.hero.subtitle}
                  </p>

                  <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 pt-1 w-full sm:w-auto">
                    <button
                      type="button"
                      onClick={() => setActiveTab('grid')}
                      className="glass-primary inline-flex items-center justify-center gap-2 min-h-[48px] rounded-2xl px-6 py-3 text-sm font-semibold whitespace-nowrap shrink-0 cursor-pointer"
                    >
                      <span>{t.hero.startCta}</span>
                      {isRtl ? (
                        <ArrowLeft className="h-4 w-4 shrink-0" />
                      ) : (
                        <ArrowRight className="h-4 w-4 shrink-0" />
                      )}
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setActiveTab('preview');
                      }}
                      className="glass-btn inline-flex items-center justify-center gap-2 min-h-[48px] rounded-2xl px-5 py-3 text-sm font-semibold text-slate-800 dark:text-slate-100 whitespace-nowrap shrink-0 cursor-pointer"
                    >
                      <Eye className="h-4 w-4 text-sky-500 shrink-0" />
                      <span>{t.hero.explorePreviewCta}</span>
                    </button>
                  </div>

                  <div className="pt-1 flex flex-wrap items-center gap-2 text-xs text-slate-700 dark:text-slate-300 font-mono-tabular">
                    <span>62 {t.hero.statsGlyphs}</span>
                    <span aria-hidden="true">·</span>
                    <span>{t.hero.statsFormat}</span>
                    <span aria-hidden="true">·</span>
                    <span>{t.hero.statsEngine}</span>
                  </div>
                </div>

                <div className="lg:col-span-5">
                  <div className="glass-clear rounded-[24px] p-4 sm:p-6 flex flex-col gap-4">
                    <div className="flex items-center justify-between gap-2 text-xs text-slate-700 dark:text-slate-300 font-mono-tabular">
                      <span className="truncate">{fontMeta.fontName}</span>
                      <span className="shrink-0">
                        {coreCompletedCount}/62 SVGs ({completionPercent}%)
                      </span>
                    </div>

                    <div
                      dir="ltr"
                      className="relative rounded-2xl bg-white/75 dark:bg-slate-950/75 border border-white/70 dark:border-white/15 p-4 sm:p-5 overflow-hidden"
                    >
                      <div className="pointer-events-none absolute inset-x-0 top-6 border-t border-dashed border-sky-500/35" />
                      <div className="pointer-events-none absolute inset-x-0 top-12 border-t border-dashed border-emerald-500/35" />
                      <div className="pointer-events-none absolute inset-x-0 bottom-7 border-t-2 border-rose-500/50" />

                      <div className="relative flex flex-wrap items-baseline gap-1 min-h-[72px]">
                        {heroSpecimenTokens.map((tok) => {
                          if (tok.isSpace) {
                            return <span key={tok.id} className="inline-block w-3" />;
                          }
                          if (tok.hasSvg && tok.glyph) {
                            return (
                              <button
                                key={tok.id}
                                type="button"
                                onClick={() => {
                                  setSelectedChar(tok.char);
                                  setEditingChar(tok.char);
                                }}
                                title={`Edit "${tok.char}"`}
                                className="group relative inline-flex items-baseline justify-center rounded-lg px-0.5 hover:bg-sky-500/15 transition-colors cursor-pointer text-slate-900 dark:text-white"
                                style={{
                                  fontFamily: `'${LIVE_FONT_FAMILY}'`,
                                  fontSize: '48px',
                                  lineHeight: 1.15,
                                }}
                              >
                                {tok.char}
                              </button>
                            );
                          }
                          return (
                            <span
                              key={tok.id}
                              className="inline-flex h-11 w-8 items-center justify-center rounded-lg border border-dashed border-slate-400 text-xs font-mono text-slate-400"
                            >
                              {tok.char}
                            </span>
                          );
                        })}
                      </div>
                    </div>

                    <div className="grid grid-cols-6 gap-1.5 sm:gap-2" dir="ltr">
                      {['H', 'A', 'R', 'F', 'a', '2'].map((c) => {
                        const g = glyphsMap[c];
                        return (
                          <button
                            key={c}
                            type="button"
                            onClick={() => {
                              setSelectedChar(c);
                              setEditingChar(c);
                            }}
                            className="glass-btn min-h-[48px] rounded-xl p-1.5 flex flex-col items-center justify-center gap-0.5 cursor-pointer"
                          >
                            <div className="h-6 w-6 text-slate-900 dark:text-white">
                              {g ? (
                                <svg
                                  viewBox="0 0 1000 1000"
                                  className="w-full h-full"
                                >
                                  <path
                                    d={g.editorPathD}
                                    fill="currentColor"
                                    fillRule="nonzero"
                                  />
                                </svg>
                              ) : (
                                <span className="text-xs text-slate-400">{c}</span>
                              )}
                            </div>
                            <span className="text-[10px] font-mono-tabular text-slate-600 dark:text-slate-300">
                              {c}.svg
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </div>
            </section>

            <section className="flex flex-col gap-4 sm:gap-5">
              <h2 className="fluid-h2 font-display font-bold tracking-tight px-1">
                {t.hero.stepsTitle}
              </h2>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 sm:gap-5">
                {[
                  {
                    title: t.hero.step1Title,
                    desc: t.hero.step1Desc,
                    icon: Upload,
                    action: () => setActiveTab('grid'),
                  },
                  {
                    title: t.hero.step2Title,
                    desc: t.hero.step2Desc,
                    icon: Sliders,
                    action: () => {
                      setSelectedChar('H');
                      setEditingChar('H');
                    },
                  },
                  {
                    title: t.hero.step3Title,
                    desc: t.hero.step3Desc,
                    icon: Sparkles,
                    action: () => setActiveTab('preview'),
                  },
                ].map((step, idx) => {
                  const Icon = step.icon;
                  return (
                    <button
                      key={idx}
                      type="button"
                      onClick={step.action}
                      className="glass-surface rounded-[26px] p-5 sm:p-6 flex flex-col justify-between gap-4 text-start cursor-pointer hover:-translate-y-1 transition-transform"
                    >
                      <div className="flex flex-col gap-3">
                        <div className="h-11 w-11 rounded-2xl bg-sky-500/15 border border-sky-400/30 flex items-center justify-center text-sky-600 dark:text-sky-300">
                          <Icon className="h-5 w-5" />
                        </div>
                        <h3 className="text-base font-display font-bold text-slate-900 dark:text-white">
                          {step.title}
                        </h3>
                        <p className="text-sm text-slate-700 dark:text-slate-300 leading-relaxed">
                          {step.desc}
                        </p>
                      </div>
                    </button>
                  );
                })}
              </div>
            </section>

            <section className="glass-surface rounded-[28px] sm:rounded-[30px] p-5 sm:p-8">
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 lg:gap-8 items-center">
                <div className="lg:col-span-7 flex flex-col gap-4">
                  <h2 className="fluid-h2 font-display font-bold">
                    {t.hero.namingSectionTitle}
                  </h2>

                  <div className="flex flex-col gap-3.5 text-sm">
                    <div className="pb-3 border-b border-slate-900/10 dark:border-white/10">
                      <p className="font-display font-bold text-sky-700 dark:text-sky-300">
                        1. {t.hero.namingOption1Name}
                      </p>
                      <p className="text-slate-700 dark:text-slate-300 mt-0.5">
                        {t.hero.namingOption1Desc}
                      </p>
                    </div>

                    <div className="pb-3 border-b border-slate-900/10 dark:border-white/10">
                      <p className="font-display font-bold text-slate-900 dark:text-slate-100">
                        2. {t.hero.namingOption2Name}
                      </p>
                      <p className="text-slate-700 dark:text-slate-300 mt-0.5">
                        {t.hero.namingOption2Desc}
                      </p>
                    </div>

                    <div>
                      <p className="font-display font-bold text-slate-900 dark:text-slate-100">
                        3. {t.hero.namingOption3Name}
                      </p>
                      <p className="text-slate-700 dark:text-slate-300 mt-0.5">
                        {t.hero.namingOption3Desc}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="lg:col-span-5 grid grid-cols-2 gap-3 sm:gap-4">
                  <div className="rounded-2xl bg-[#f4f7fb] border border-white p-4 sm:p-5 flex flex-col items-center justify-center gap-2.5 text-center shadow-sm">
                    <HarfaLogo size={52} />
                    <span className="text-xs font-display font-bold text-slate-900">
                      Harfa · حِرفة (Light)
                    </span>
                  </div>
                  <div className="rounded-2xl bg-[#070d1f] border border-white/15 p-4 sm:p-5 flex flex-col items-center justify-center gap-2.5 text-center shadow-sm">
                    <HarfaLogo size={52} />
                    <span className="text-xs font-display font-bold text-white">
                      Harfa · حِرفة (Dark)
                    </span>
                  </div>
                </div>
              </div>
            </section>
          </div>
        )}

        {activeTab === 'grid' && (
          <section
            onDragOver={(e) => {
              e.preventDefault();
              setIsDraggingOverGrid(true);
            }}
            onDragLeave={(e) => {
              if (e.currentTarget === e.target) setIsDraggingOverGrid(false);
            }}
            onDrop={async (e) => {
              e.preventDefault();
              setIsDraggingOverGrid(false);
              if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                await handleBatchFiles(e.dataTransfer.files);
              }
            }}
            className="relative flex flex-col gap-5"
          >
            {isDraggingOverGrid && (
              <div className="fixed inset-4 z-50 rounded-[32px] glass-floating border-2 border-dashed border-sky-400 flex flex-col items-center justify-center p-8 text-center pointer-events-none">
                <Upload className="h-12 w-12 text-sky-500 animate-bounce mb-3" />
                <p className="text-xl font-display font-bold">{t.grid.dropOverlayTitle}</p>
                <p className="text-sm text-slate-600 dark:text-slate-300 mt-1">
                  {t.grid.dropOverlaySub}
                </p>
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-12 gap-5 items-start">
              <aside
                aria-label="Studio Projects and Shortcuts Sidebar"
                className="hidden lg:flex lg:col-span-2 flex-col gap-4 sticky top-20"
              >
                <div className="glass-surface rounded-[24px] p-4 flex flex-col gap-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-display font-bold uppercase tracking-wider text-slate-600 dark:text-slate-300">
                      {t.nav.projects}
                    </span>
                    <button
                      type="button"
                      onClick={() => saveCurrentWorkspaceSnapshot()}
                      title="Save Snapshot (Ctrl/Cmd+S)"
                      className="glass-btn min-h-[36px] min-w-[36px] rounded-xl flex items-center justify-center text-sky-600 dark:text-sky-300 cursor-pointer"
                    >
                      <Plus className="h-4 w-4" />
                    </button>
                  </div>

                  <div className="flex flex-col gap-1.5">
                    {projects.slice(0, 4).map((p) => {
                      const active = p.id === activeProjectId;
                      return (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => handleLoadProject(p)}
                          className={`w-full min-h-[40px] rounded-xl px-3 py-2 text-start text-xs font-semibold truncate transition-all cursor-pointer ${
                            active
                              ? 'glass-primary'
                              : 'glass-btn text-slate-700 dark:text-slate-200'
                          }`}
                        >
                          {p.name}
                        </button>
                      );
                    })}
                  </div>

                  <button
                    type="button"
                    onClick={() => setActiveTab('projects')}
                    className="text-xs font-semibold text-sky-700 dark:text-sky-300 hover:underline text-start pt-1 cursor-pointer"
                  >
                    {t.projects.savedListTitle} ({projects.length}) →
                  </button>
                </div>

                <div className="glass-surface rounded-[24px] p-4 flex flex-col gap-2.5 text-xs text-slate-700 dark:text-slate-300">
                  <div className="flex items-center gap-1.5 font-display font-bold text-slate-900 dark:text-white">
                    <Keyboard className="h-4 w-4 text-sky-500 shrink-0" />
                    <span>{lang === 'ar' ? 'اختصارات لوحة المفاتيح' : 'Shortcuts'}</span>
                  </div>
                  <div className="flex items-center justify-between gap-1">
                    <span>{lang === 'ar' ? 'تنقل' : 'Navigate'}</span>
                    <kbd className="font-mono-tabular px-1.5 py-0.5 rounded bg-slate-900/10 dark:bg-white/10 text-[11px]">
                      ↑↓←→
                    </kbd>
                  </div>
                  <div className="flex items-center justify-between gap-1">
                    <span>{lang === 'ar' ? 'تحرير' : 'Edit Cell'}</span>
                    <kbd className="font-mono-tabular px-1.5 py-0.5 rounded bg-slate-900/10 dark:bg-white/10 text-[11px]">
                      Enter
                    </kbd>
                  </div>
                  <div className="flex items-center justify-between gap-1">
                    <span>{lang === 'ar' ? 'حفظ' : 'Save'}</span>
                    <kbd className="font-mono-tabular px-1.5 py-0.5 rounded bg-slate-900/10 dark:bg-white/10 text-[11px]">
                      ⌘/Ctrl+S
                    </kbd>
                  </div>
                </div>
              </aside>

              <div className="md:col-span-7 lg:col-span-6 flex flex-col gap-4">
                <div className="glass-surface rounded-[26px] p-4 sm:p-6 flex flex-col gap-4">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                      <h1 className="fluid-h1 font-display font-extrabold tracking-tight">
                        {t.grid.title}
                      </h1>
                      <p className="text-xs sm:text-sm text-slate-700 dark:text-slate-300 mt-1 max-w-xl">
                        {t.grid.subtitle}
                      </p>
                    </div>

                    <div className="flex flex-col items-end gap-1.5 min-w-[200px] w-full sm:w-auto">
                      <div className="flex items-center justify-between gap-4 w-full text-xs font-mono-tabular">
                        <span className="text-slate-700 dark:text-slate-300">
                          {t.grid.completionLabel}
                        </span>
                        <span
                          data-testid="glyph-progress-count"
                          className="font-bold text-sky-700 dark:text-sky-300"
                        >
                          {coreCompletedCount}/62 ({completionPercent}%)
                        </span>
                      </div>
                      <div className="w-full h-2.5 rounded-full bg-slate-900/10 dark:bg-white/10 overflow-hidden p-0.5">
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-sky-400 via-indigo-500 to-fuchsia-500 transition-all duration-300"
                          style={{ width: `${completionPercent}%` }}
                        />
                      </div>
                    </div>
                  </div>

                  <div
                    role="tablist"
                    aria-label="Glyph Category Filter"
                    className="flex flex-wrap items-center gap-1.5 pt-2 border-t border-slate-900/10 dark:border-white/10"
                  >
                    {(
                      [
                        { id: 'all', label: t.grid.filterAll },
                        { id: 'uppercase', label: t.grid.filterUpper },
                        { id: 'lowercase', label: t.grid.filterLower },
                        { id: 'digits', label: t.grid.filterDigits },
                        { id: 'punctuation', label: t.grid.filterPunct },
                      ] as const
                    ).map((tab) => (
                      <button
                        key={tab.id}
                        role="tab"
                        aria-selected={gridFilter === tab.id}
                        type="button"
                        onClick={() => setGridFilter(tab.id)}
                        className={`min-h-[44px] rounded-xl px-3 py-2 text-xs font-semibold whitespace-nowrap shrink-0 transition-all cursor-pointer ${
                          gridFilter === tab.id
                            ? 'glass-primary'
                            : 'glass-btn text-slate-800 dark:text-slate-200'
                        }`}
                      >
                        {tab.label}
                      </button>
                    ))}
                  </div>

                  <div className="flex flex-col sm:flex-row flex-wrap items-stretch sm:items-center justify-between gap-2.5">
                    <input
                      ref={batchInputRef}
                      type="file"
                      accept=".svg,image/svg+xml"
                      multiple
                      className="hidden"
                      onChange={(e) => {
                        if (e.target.files && e.target.files.length > 0) {
                          handleBatchFiles(e.target.files);
                          e.target.value = '';
                        }
                      }}
                    />

                    <div className="flex flex-col sm:flex-row flex-wrap items-stretch sm:items-center gap-2">
                      <button
                        type="button"
                        onClick={() => batchInputRef.current?.click()}
                        className="glass-primary inline-flex items-center justify-center gap-1.5 min-h-[44px] rounded-xl px-4 py-2 text-xs font-semibold whitespace-nowrap shrink-0 cursor-pointer"
                      >
                        <Upload className="h-4 w-4 shrink-0" />
                        <span>{t.grid.batchUploadBtn}</span>
                      </button>

                      <button
                        type="button"
                        onClick={handleLoadSampleGlyphs}
                        className="glass-btn inline-flex items-center justify-center gap-1.5 min-h-[44px] rounded-xl px-3.5 py-2 text-xs font-semibold text-slate-800 dark:text-slate-100 whitespace-nowrap shrink-0 cursor-pointer"
                      >
                        <Sparkles className="h-4 w-4 text-sky-500 shrink-0" />
                        <span>{t.grid.loadSampleBtn}</span>
                      </button>

                      <button
                        type="button"
                        onClick={handleLoadAll74Glyphs}
                        className="glass-btn inline-flex items-center justify-center gap-1.5 min-h-[44px] rounded-xl px-3.5 py-2 text-xs font-semibold text-slate-800 dark:text-slate-100 whitespace-nowrap shrink-0 cursor-pointer"
                      >
                        <Sparkles className="h-4 w-4 text-emerald-500 shrink-0" />
                        <span>{t.grid.loadAll74Btn}</span>
                      </button>

                      <button
                        type="button"
                        onClick={handleDownloadSampleSvgFile}
                        className="glass-btn inline-flex items-center justify-center gap-1.5 min-h-[44px] rounded-xl px-3.5 py-2 text-xs font-semibold text-slate-700 dark:text-slate-200 whitespace-nowrap shrink-0 cursor-pointer"
                      >
                        <FileCode2 className="h-4 w-4 text-indigo-500 shrink-0" />
                        <span>{t.grid.downloadSampleSvgBtn}</span>
                      </button>

                      {totalUploadedCount > 0 && (
                        <button
                          type="button"
                          onClick={handleClearGrid}
                          className="glass-btn inline-flex items-center justify-center gap-1.5 min-h-[44px] rounded-xl px-3.5 py-2 text-xs font-semibold text-rose-600 dark:text-rose-400 whitespace-nowrap shrink-0 cursor-pointer"
                        >
                          <Trash2 className="h-4 w-4 shrink-0" />
                          <span>{t.grid.clearAllBtn}</span>
                        </button>
                      )}
                    </div>

                    <input
                      type="search"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      onFocus={handleInputFocusScroll}
                      {...hintProp(t.grid.searchHint)}
                      aria-label={t.grid.searchHint}
                      className="w-full sm:w-52 min-h-[44px] rounded-xl bg-white/75 dark:bg-slate-900/75 border border-white/70 dark:border-white/15 px-3.5 py-2 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-sky-500"
                    />
                  </div>
                </div>

                {quickMenuChar && (
                  <div className="glass-floating rounded-2xl p-3 flex flex-wrap items-center justify-between gap-2 text-xs">
                    <span className="font-display font-bold">
                      {lang === 'ar'
                        ? `إجراءات سريعة للمحرف "${quickMenuChar}"`
                        : `Quick Actions for "${quickMenuChar}"`}
                    </span>
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setEditingChar(quickMenuChar);
                          setQuickMenuChar(null);
                        }}
                        className="glass-primary min-h-[40px] rounded-xl px-3 py-1.5 font-semibold cursor-pointer"
                      >
                        {t.editor.modalTitle}
                      </button>
                      {SAMPLE_SVG_GLYPHS[quickMenuChar] && (
                        <button
                          type="button"
                          onClick={async () => {
                            await handleAddSingleGlyph(
                              quickMenuChar,
                              SAMPLE_SVG_GLYPHS[quickMenuChar],
                              `${quickMenuChar}.svg`
                            );
                            setQuickMenuChar(null);
                          }}
                          className="glass-btn min-h-[40px] rounded-xl px-3 py-1.5 font-semibold cursor-pointer"
                        >
                          {t.editor.loadPresetForChar.replace('{char}', quickMenuChar)}
                        </button>
                      )}
                      {glyphsMap[quickMenuChar] && (
                        <button
                          type="button"
                          onClick={() => {
                            handleUpdateMetrics(quickMenuChar, { ...DEFAULT_GLYPH_METRICS });
                            setQuickMenuChar(null);
                          }}
                          className="glass-btn min-h-[40px] rounded-xl px-3 py-1.5 font-semibold cursor-pointer"
                        >
                          {t.editor.resetMetricsBtn}
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => setQuickMenuChar(null)}
                        className="glass-btn min-h-[40px] rounded-xl px-2.5 py-1.5 cursor-pointer"
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                )}

                <div dir="ltr" className="harfa-glyph-grid">
                  {visibleChars.map((char, index) => {
                    const glyph = glyphsMap[char];
                    const isPopulated = Boolean(glyph);
                    const isSelected = selectedChar === char;
                    const hexCode = `U+${char.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')}`;

                    return (
                      <div key={char} className="glyph-cell-container relative">
                        <button
                          ref={(el) => {
                            glyphButtonsRef.current[char] = el;
                          }}
                          type="button"
                          onClick={() => {
                            setSelectedChar(char);
                            if (window.innerWidth < 768) {
                              setEditingChar(char);
                            }
                          }}
                          onDoubleClick={() => {
                            setSelectedChar(char);
                            setEditingChar(char);
                          }}
                          onKeyDown={(e) => handleCellKeyDown(e, index, char)}
                          onPointerDown={() => startCellLongPress(char)}
                          onPointerUp={clearCellLongPress}
                          onPointerLeave={clearCellLongPress}
                          onContextMenu={(e) => {
                            e.preventDefault();
                            setSelectedChar(char);
                            setQuickMenuChar(char);
                          }}
                          onDragOver={(e) => e.preventDefault()}
                          onDrop={async (e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            setIsDraggingOverGrid(false);
                            if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                              await handleBatchFiles(e.dataTransfer.files, char);
                            }
                          }}
                          title={`${char} (${hexCode}) — ${isPopulated ? t.grid.populatedCellHint : t.grid.emptyCellHint}`}
                          aria-label={`Glyph ${char} (${hexCode}) ${isPopulated ? 'uploaded' : 'empty'}`}
                          className={`group relative w-full min-h-[68px] sm:min-h-[82px] rounded-[16px] sm:rounded-[18px] p-1.5 sm:p-2 flex flex-col items-center justify-between cursor-pointer transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 ${
                            isSelected
                              ? 'glass-surface ring-2 ring-sky-500 shadow-md'
                              : isPopulated
                                ? 'glass-surface ring-1 ring-sky-500/35 hover:ring-sky-500'
                                : 'glass-clear opacity-85 hover:opacity-100'
                          }`}
                        >
                          <div className="flex w-full items-center justify-between text-[10px] font-mono-tabular px-0.5">
                            <span className="font-bold text-slate-800 dark:text-slate-100">
                              {char}
                            </span>
                            <span className="text-[9px] text-sky-600 dark:text-sky-400">
                              {isPopulated ? '●' : '+'}
                            </span>
                          </div>

                          <div className="relative flex h-8 w-8 sm:h-10 sm:w-10 items-center justify-center my-0.5">
                            <div className="pointer-events-none absolute inset-x-0.5 bottom-1.5 border-t border-rose-500/35" />
                            {glyph ? (
                              <svg
                                viewBox="0 0 1000 1000"
                                className="h-7 w-7 sm:h-9 sm:w-9 text-slate-900 dark:text-white transition-transform group-hover:scale-110"
                              >
                                <path
                                  d={glyph.editorPathD}
                                  fill="currentColor"
                                  fillRule="nonzero"
                                />
                              </svg>
                            ) : (
                              <span className="text-lg sm:text-xl font-display font-bold text-slate-400/45 dark:text-slate-600/50 select-none">
                                {char}
                              </span>
                            )}
                          </div>

                          <div className="glyph-cell-meta w-full text-center text-[9px] font-mono-tabular text-slate-600 dark:text-slate-400 truncate">
                            {glyph
                              ? `${Math.round(glyph.metrics.scale * 100)}%`
                              : hexCode}
                          </div>
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>

              <aside
                aria-label="Glyph Optical Inspector and Quick Preview"
                className="hidden md:flex md:col-span-5 lg:col-span-4 flex-col gap-4 sticky top-20"
              >
                <div className="flex items-center justify-between px-1">
                  <span className="text-xs font-display font-bold uppercase tracking-wider text-slate-600 dark:text-slate-300">
                    {t.editor.modalTitle}
                  </span>
                  <button
                    type="button"
                    onClick={() => setEditingChar(selectedChar)}
                    className="inline-flex items-center gap-1 text-xs font-semibold text-sky-700 dark:text-sky-300 hover:underline cursor-pointer"
                  >
                    <MoreHorizontal className="h-3.5 w-3.5" />
                    <span>{lang === 'ar' ? 'فتح في نافذة' : 'Expand Sheet'}</span>
                  </button>
                </div>

                <GlyphEditorModal
                  char={selectedChar}
                  glyph={glyphsMap[selectedChar]}
                  lang={lang}
                  variant="inline"
                  onClose={() => setEditingChar(null)}
                  onUploadSvg={handleAddSingleGlyph}
                  onUpdateMetrics={handleUpdateMetrics}
                  onRemoveGlyph={handleRemoveGlyph}
                />
              </aside>
            </div>
          </section>
        )}

        {activeTab === 'preview' && (
          <section className="flex flex-col gap-5">
            <div className="glass-surface rounded-[28px] p-4 sm:p-7 flex flex-col gap-5">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <h1 className="fluid-h1 font-display font-extrabold tracking-tight">
                    {t.preview.title}
                  </h1>
                  <p className="text-xs sm:text-sm text-slate-700 dark:text-slate-300 mt-1 max-w-2xl">
                    {t.preview.subtitle}
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2" dir="ltr">
                  {[
                    t.preview.presetPangram1,
                    t.preview.presetPangram2,
                    t.preview.presetPangram3,
                  ].map((preset, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => setPreviewInput(preset)}
                      className="glass-btn min-h-[44px] rounded-xl px-3 py-2 text-xs font-mono font-medium text-slate-800 dark:text-slate-100 cursor-pointer"
                    >
                      {preset.slice(0, 18)}…
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-center pt-2 border-t border-slate-900/10 dark:border-white/10">
                <div className="lg:col-span-6">
                  <label htmlFor="live-preview-input" className="sr-only">
                    {t.preview.inputHint}
                  </label>
                  <textarea
                    id="live-preview-input"
                    rows={2}
                    dir="ltr"
                    value={previewInput}
                    onChange={(e) => setPreviewInput(e.target.value)}
                    onFocus={handleInputFocusScroll}
                    {...hintProp(t.preview.inputHint)}
                    className="w-full rounded-2xl bg-white/80 dark:bg-slate-900/80 border border-white/70 dark:border-white/15 px-4 py-3 font-mono text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-sky-500"
                  />
                </div>

                <div className="lg:col-span-6 grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div>
                    <div className="flex justify-between text-xs mb-1">
                      <label htmlFor="preview-size-slider" className="font-semibold">
                        {t.preview.sizeLabel}
                      </label>
                      <span className="font-mono-tabular">{previewSize}px</span>
                    </div>
                    <input
                      id="preview-size-slider"
                      type="range"
                      min={28}
                      max={120}
                      value={previewSize}
                      onChange={(e) => setPreviewSize(Number(e.target.value))}
                      className="w-full h-6 accent-sky-500 cursor-pointer"
                    />
                  </div>

                  <div>
                    <div className="flex justify-between text-xs mb-1">
                      <label htmlFor="preview-tracking-slider" className="font-semibold">
                        {t.preview.trackingLabel}
                      </label>
                      <span className="font-mono-tabular">{previewTracking}px</span>
                    </div>
                    <input
                      id="preview-tracking-slider"
                      type="range"
                      min={-12}
                      max={36}
                      value={previewTracking}
                      onChange={(e) => setPreviewTracking(Number(e.target.value))}
                      className="w-full h-6 accent-indigo-500 cursor-pointer"
                    />
                  </div>

                  <div>
                    <div className="flex justify-between text-xs mb-1">
                      <label htmlFor="preview-lh-slider" className="font-semibold">
                        {t.preview.lineHeightLabel}
                      </label>
                      <span className="font-mono-tabular">{previewLineHeight.toFixed(2)}</span>
                    </div>
                    <input
                      id="preview-lh-slider"
                      type="range"
                      min={1.0}
                      max={2.0}
                      step={0.05}
                      value={previewLineHeight}
                      onChange={(e) => setPreviewLineHeight(Number(e.target.value))}
                      className="w-full h-6 accent-emerald-500 cursor-pointer"
                    />
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-4 text-xs">
                <div className="flex flex-wrap items-center gap-4">
                  <label className="inline-flex items-center gap-2 min-h-[44px] cursor-pointer">
                    <input
                      type="checkbox"
                      checked={showPreviewGuides}
                      onChange={(e) => setShowPreviewGuides(e.target.checked)}
                      className="h-4 w-4 rounded accent-sky-500"
                    />
                    <span className="font-medium">{t.preview.showGuidesToggle}</span>
                  </label>

                  <label className="inline-flex items-center gap-2 min-h-[44px] cursor-pointer">
                    <input
                      type="checkbox"
                      checked={highlightMissing}
                      onChange={(e) => setHighlightMissing(e.target.checked)}
                      className="h-4 w-4 rounded accent-sky-500"
                    />
                    <span className="font-medium">{t.preview.showMissingToggle}</span>
                  </label>
                </div>

                {liveFontReady && totalUploadedCount > 0 && (
                  <span className="inline-flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400 font-mono-tabular font-semibold">
                    <ShieldCheck className="h-4 w-4 shrink-0" />
                    <span>{t.preview.liveFontBadge}</span>
                  </span>
                )}
              </div>
            </div>

            <div className="glass-surface rounded-[30px] p-5 sm:p-10 min-h-[260px] flex flex-col justify-between overflow-hidden">
              {totalUploadedCount === 0 ? (
                <div className="my-auto text-center py-10 flex flex-col items-center gap-4">
                  <p className="text-sm text-slate-700 dark:text-slate-300 max-w-md">
                    {t.preview.emptyVaultWarning}
                  </p>
                  <button
                    type="button"
                    onClick={handleLoadSampleGlyphs}
                    className="glass-primary inline-flex items-center gap-2 min-h-[44px] rounded-2xl px-5 py-2.5 text-xs font-semibold cursor-pointer"
                  >
                    <Sparkles className="h-4 w-4 shrink-0" />
                    <span>{t.grid.loadSampleBtn}</span>
                  </button>
                </div>
              ) : (
                <div
                  dir="ltr"
                  data-testid="live-font-preview-stage"
                  className="flex flex-wrap items-baseline content-start"
                  style={{
                    rowGap: `${Math.round(previewSize * (previewLineHeight - 0.9))}px`,
                  }}
                >
                  {previewTokens.map((tok) => {
                    if (tok.isNewline) {
                      return <div key={tok.id} className="w-full h-0" />;
                    }
                    if (tok.isSpace) {
                      return (
                        <span
                          key={tok.id}
                          style={{
                            fontFamily: `'${LIVE_FONT_FAMILY}'`,
                            fontSize: `${previewSize}px`,
                            letterSpacing: `${previewTracking}px`,
                            lineHeight: previewLineHeight,
                          }}
                          className="inline-block whitespace-pre"
                        >
                          {' '}
                        </span>
                      );
                    }

                    if (tok.hasSvg && tok.glyph) {
                      return (
                        <button
                          key={tok.id}
                          type="button"
                          onClick={() => {
                            setSelectedChar(tok.char);
                            setEditingChar(tok.char);
                          }}
                          title={`Click to calibrate "${tok.char}" (${tok.glyph.advanceWidth} UPM)`}
                          style={{
                            fontFamily: `'${LIVE_FONT_FAMILY}'`,
                            fontSize: `${previewSize}px`,
                            letterSpacing: `${previewTracking}px`,
                            lineHeight: previewLineHeight,
                          }}
                          className={`group relative inline-flex items-baseline justify-center rounded-lg px-0.5 transition-colors hover:bg-sky-500/15 text-slate-900 dark:text-white cursor-pointer ${
                            showPreviewGuides
                              ? 'border-b-2 border-rose-500/40 bg-sky-500/[0.03]'
                              : ''
                          }`}
                        >
                          {tok.char}
                        </button>
                      );
                    }

                    return (
                      <button
                        key={tok.id}
                        type="button"
                        data-testid={`missing-cmap-char-${tok.char}`}
                        onClick={() => {
                          setSelectedChar(tok.char);
                          setEditingChar(tok.char);
                        }}
                        title={`Missing from cmap — click to upload SVG for "${tok.char}"`}
                        style={{
                          minWidth: `${Math.round(previewSize * 0.58)}px`,
                          height: `${previewSize}px`,
                          marginInlineEnd: `${Math.max(2, previewTracking)}px`,
                        }}
                        className={`inline-flex flex-col items-center justify-center rounded-lg font-mono text-slate-500 dark:text-slate-400 cursor-pointer px-1 ${
                          highlightMissing
                            ? 'border border-dashed border-amber-500/75 bg-amber-500/15 text-amber-800 dark:text-amber-300'
                            : 'border border-dashed border-slate-400/50'
                        }`}
                      >
                        <span style={{ fontSize: `${Math.round(previewSize * 0.38)}px`, lineHeight: 1 }}>
                          {tok.char}
                        </span>
                        <span className="text-[9px] uppercase tracking-tighter opacity-75 mt-0.5">
                          missing
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}

              <div className="mt-8 pt-4 border-t border-slate-900/10 dark:border-white/10 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600 dark:text-slate-400">
                <span>{t.preview.missingNotice}</span>
                <span className="font-mono-tabular">
                  {previewTokens.filter((tok) => tok.hasSvg).length} cmap glyphs rendered via{' '}
                  <code>FontFace(&apos;{LIVE_FONT_FAMILY}&apos;)</code>
                </span>
              </div>
            </div>
          </section>
        )}

        {activeTab === 'projects' && (
          <section className="flex flex-col gap-5">
            <div className="glass-surface rounded-[28px] p-4 sm:p-7 flex flex-col gap-5">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <h1 className="fluid-h1 font-display font-extrabold tracking-tight">
                    {t.projects.title}
                  </h1>
                  <p className="text-xs sm:text-sm text-slate-700 dark:text-slate-300 mt-1">
                    {t.projects.subtitle}
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <input
                    ref={importJsonInputRef}
                    type="file"
                    accept=".json,application/json"
                    className="hidden"
                    onChange={handleImportProjectJson}
                  />
                  <button
                    type="button"
                    onClick={handleExportProjectJson}
                    className="glass-btn inline-flex items-center justify-center gap-1.5 min-h-[44px] rounded-xl px-3.5 py-2 text-xs font-semibold text-slate-800 dark:text-slate-100 cursor-pointer"
                  >
                    <Download className="h-4 w-4 text-sky-500 shrink-0" />
                    <span>{t.projects.exportJsonBtn}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => importJsonInputRef.current?.click()}
                    className="glass-btn inline-flex items-center justify-center gap-1.5 min-h-[44px] rounded-xl px-3.5 py-2 text-xs font-semibold text-slate-800 dark:text-slate-100 cursor-pointer"
                  >
                    <Upload className="h-4 w-4 text-indigo-500 shrink-0" />
                    <span>{t.projects.importJsonBtn}</span>
                  </button>
                </div>
              </div>

              <form
                onSubmit={handleSaveProjectForm}
                className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 pt-3 border-t border-slate-900/10 dark:border-white/10"
              >
                <input
                  type="text"
                  value={newProjectName}
                  onChange={(e) => setNewProjectName(e.target.value)}
                  onFocus={handleInputFocusScroll}
                  {...hintProp(t.projects.projectNameHint)}
                  aria-label={t.projects.projectNameHint}
                  className="flex-1 min-h-[44px] rounded-2xl bg-white/80 dark:bg-slate-900/80 border border-white/70 dark:border-white/15 px-4 py-2.5 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-sky-500"
                />
                <button
                  type="submit"
                  className="glass-primary inline-flex items-center justify-center gap-2 min-h-[44px] rounded-2xl px-5 py-2.5 text-xs font-semibold whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <Plus className="h-4 w-4 shrink-0" />
                  <span>{t.projects.saveBtn}</span>
                </button>
              </form>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-5">
              {projects.map((proj) => {
                const projGlyphKeys = Object.keys(proj.glyphs || {});
                const coreCount = CORE_62_CHARS.filter((c) => Boolean(proj.glyphs?.[c])).length;
                const sampleThumbChars = projGlyphKeys.slice(0, 6);
                const isLoaded = proj.id === activeProjectId;

                return (
                  <div
                    key={proj.id}
                    className="glass-surface rounded-[26px] p-5 flex flex-col justify-between gap-4"
                  >
                    <div className="flex flex-col gap-3">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <h3 className="text-base font-display font-bold text-slate-900 dark:text-white">
                            {proj.name}
                          </h3>
                          <p className="text-xs text-slate-600 dark:text-slate-400 font-mono-tabular mt-0.5">
                            {t.projects.glyphsCount.replace('{count}', String(coreCount))} · v
                            {proj.meta.version}
                          </p>
                        </div>
                        {isLoaded && (
                          <span className="text-xs font-semibold text-sky-700 dark:text-sky-300">
                            {t.projects.activeBadge}
                          </span>
                        )}
                      </div>

                      <div
                        dir="ltr"
                        className="grid grid-cols-6 gap-1.5 rounded-2xl bg-white/65 dark:bg-slate-950/65 border border-white/50 dark:border-white/10 p-2.5 min-h-[54px]"
                      >
                        {sampleThumbChars.length > 0 ? (
                          sampleThumbChars.map((ch) => {
                            const g = proj.glyphs[ch];
                            return (
                              <div
                                key={ch}
                                className="flex items-center justify-center h-9 rounded-lg bg-slate-900/5 dark:bg-white/5 p-1"
                              >
                                {g.editorPathD ? (
                                  <svg
                                    viewBox="0 0 1000 1000"
                                    className="w-6 h-6 text-slate-900 dark:text-white"
                                  >
                                    <path
                                      d={g.editorPathD}
                                      fill="currentColor"
                                      fillRule="nonzero"
                                    />
                                  </svg>
                                ) : (
                                  <svg
                                    viewBox={g.viewBox.join(' ')}
                                    className="w-6 h-6 text-slate-900 dark:text-white"
                                    dangerouslySetInnerHTML={{ __html: g.innerSvg }}
                                  />
                                )}
                              </div>
                            );
                          })
                        ) : (
                          <span className="col-span-6 text-center text-xs text-slate-400 my-auto">
                            0 SVGs
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center justify-between gap-2 pt-2 border-t border-slate-900/10 dark:border-white/10">
                      <button
                        type="button"
                        onClick={() => handleLoadProject(proj)}
                        className="glass-primary min-h-[44px] rounded-xl px-4 py-2 text-xs font-semibold cursor-pointer"
                      >
                        {t.projects.loadBtn}
                      </button>

                      <button
                        type="button"
                        onClick={() => handleDeleteProject(proj.id)}
                        aria-label={`${t.projects.deleteBtn} ${proj.name}`}
                        className="glass-btn min-h-[44px] rounded-xl px-3.5 py-2 text-xs font-semibold text-rose-600 dark:text-rose-400 cursor-pointer"
                      >
                        {t.projects.deleteBtn}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}
      </main>

      <nav
        aria-label="Mobile Bottom Navigation"
        className="mobile-bottom-tabbar md:hidden fixed bottom-safe-offset inset-x-2.5 z-40 glass-floating rounded-[24px] px-2 py-1.5 pb-safe-area grid grid-cols-4 gap-1"
      >
        {(
          [
            { id: 'home', label: t.nav.home, icon: Compass },
            { id: 'grid', label: t.nav.grid, icon: Grid },
            { id: 'preview', label: t.nav.preview, icon: Type },
            { id: 'projects', label: t.nav.projects, icon: FolderKanban },
          ] as const
        ).map((tab) => {
          const Icon = tab.icon;
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`tab-btn flex flex-col items-center justify-center min-h-[44px] rounded-[18px] py-1 px-1.5 text-[11px] font-semibold transition-all cursor-pointer ${
                active
                  ? 'glass-primary'
                  : 'text-slate-800 dark:text-slate-200 hover:bg-white/20'
              }`}
            >
              <Icon className="tab-icon h-4 w-4 shrink-0" />
              <span className="truncate max-w-full mt-0.5">{tab.label}</span>
            </button>
          );
        })}
      </nav>

      {editingChar && (
        <GlyphEditorModal
          char={editingChar}
          glyph={glyphsMap[editingChar]}
          lang={lang}
          variant="modal"
          onClose={() => setEditingChar(null)}
          onUploadSvg={handleAddSingleGlyph}
          onUpdateMetrics={handleUpdateMetrics}
          onRemoveGlyph={handleRemoveGlyph}
        />
      )}

      {showExportModal && (
        <ExportSheetModal
          lang={lang}
          glyphCount={totalUploadedCount}
          initialMeta={fontMeta}
          onSaveMeta={setFontMeta}
          onClose={() => setShowExportModal(false)}
        />
      )}
    </div>
  );
}
