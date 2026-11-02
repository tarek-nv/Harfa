import React from 'react';

/**
 * Full-bleed ambient canvas and SVG optical refraction filter.
 * Uses logical positioning (`inset-0`) and reduces blur complexity on phones
 * to sustain 60fps scrolling while keeping multi-orb refraction on tablet and desktop.
 */
export const SurfaceBackdrop: React.FC = () => {
  return (
    <>
      {/* Hidden SVG Filter Pipeline for Optical Surface Refraction */}
      <svg
        aria-hidden="true"
        className="pointer-events-none fixed top-0 start-0 h-0 w-0 opacity-0"
      >
        <defs>
          <filter
            id="surface-refraction"
            x="-10%"
            y="-10%"
            width="120%"
            height="120%"
            colorInterpolationFilters="sRGB"
          >
            <feTurbulence
              type="fractalNoise"
              baseFrequency="0.015 0.018"
              numOctaves="2"
              seed="14"
              result="surfaceNoise"
            />
            <feGaussianBlur in="surfaceNoise" stdDeviation="6" result="softLensMap" />
            <feDisplacementMap
              in="SourceGraphic"
              in2="softLensMap"
              scale="14"
              xChannelSelector="R"
              yChannelSelector="G"
              result="refractedSurface"
            />
          </filter>
        </defs>
      </svg>

      {/* Full-bleed Ambient Canvas */}
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 -z-10 overflow-hidden bg-[#eef3fb] dark:bg-[#050914]"
      >
        {/* Subtle architectural dot grid for optical lensing visibility */}
        <div
          className="absolute inset-0 opacity-45 dark:opacity-25"
          style={{
            backgroundImage:
              'radial-gradient(circle at 1px 1px, rgba(56, 189, 248, 0.28) 1px, transparent 0)',
            backgroundSize: '28px 28px',
          }}
        />

        {/* Luminous Orb 1 — Cyan / Azure */}
        <div className="animate-orb-1 absolute -top-20 -start-16 h-[280px] w-[280px] md:h-[440px] md:w-[440px] rounded-full bg-gradient-to-br from-sky-400/45 via-cyan-300/30 to-blue-500/25 dark:from-sky-500/28 dark:via-cyan-500/18 dark:to-indigo-600/22 blur-2xl md:blur-3xl" />

        {/* Luminous Orb 2 — Indigo / Rose */}
        <div className="animate-orb-2 absolute top-1/4 -end-20 h-[300px] w-[300px] md:h-[500px] md:w-[500px] rounded-full bg-gradient-to-tr from-indigo-400/40 via-fuchsia-300/30 to-rose-400/25 dark:from-indigo-500/25 dark:via-purple-500/18 dark:to-pink-500/18 blur-2xl md:blur-3xl" />

        {/* Luminous Orb 3 — Teal / Amber Warmth */}
        <div className="animate-orb-3 absolute -bottom-24 start-1/4 h-[280px] w-[280px] md:h-[460px] md:w-[460px] rounded-full bg-gradient-to-r from-teal-300/40 via-sky-300/30 to-amber-200/30 dark:from-teal-500/20 dark:via-sky-600/18 dark:to-amber-500/14 blur-2xl md:blur-3xl" />
      </div>
    </>
  );
};
