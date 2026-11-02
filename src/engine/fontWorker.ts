import {
  compileAndValidateFont,
  CompilerFontMetadata,
  CompilerGlyphInput,
  FontValidationReport,
} from './fontCompiler';

export interface FontWorkerRequest {
  id: string;
  glyphInputs: CompilerGlyphInput[];
  meta: CompilerFontMetadata;
  allSupportedChars: string[];
  core62Chars: string[];
}

export type FontWorkerResponse =
  | {
      id: string;
      type: 'progress';
      percent: number;
      stageKey: string;
    }
  | {
      id: string;
      type: 'success';
      ttfBuffer: ArrayBuffer;
      woffBuffer: ArrayBuffer;
      validation: FontValidationReport;
    }
  | {
      id: string;
      type: 'error';
      error: string;
      validation?: FontValidationReport;
    };

const ctx = self as unknown as {
  onmessage: ((event: MessageEvent<FontWorkerRequest>) => void) | null;
  postMessage: (message: FontWorkerResponse, transfer?: Transferable[]) => void;
};

ctx.onmessage = (event: MessageEvent<FontWorkerRequest>) => {
  const { id, glyphInputs, meta, allSupportedChars, core62Chars } = event.data;
  try {
    const result = compileAndValidateFont(
      glyphInputs,
      meta,
      allSupportedChars,
      core62Chars,
      (percent, stageKey) => {
        ctx.postMessage({
          id,
          type: 'progress',
          percent,
          stageKey,
        });
      }
    );

    ctx.postMessage(
      {
        id,
        type: 'success',
        ttfBuffer: result.ttfBuffer,
        woffBuffer: result.woffBuffer,
        validation: result.validation,
      },
      [result.ttfBuffer, result.woffBuffer]
    );
  } catch (err) {
    const validation = (err as Error & { validation?: FontValidationReport })?.validation;
    ctx.postMessage({
      id,
      type: 'error',
      error: err instanceof Error ? err.message : String(err),
      validation,
    });
  }
};
