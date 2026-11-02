import React from 'react';

interface HarfaLogoProps {
  size?: number;
  className?: string;
}

/**
 * Custom inline SVG monogram combining:
 *   - The structural vertical pillars of the Latin letter "H"
 *   - The sweeping brow and curved bowl of the Arabic letter "ح" (from حِرفة)
 * Rendered inside a concentric translucent squircle with multi-stop
 * specular highlights, inner refraction layers, and adaptive light/dark shading.
 */
export const HarfaLogo: React.FC<HarfaLogoProps> = ({ size = 40, className = '' }) => {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={`shrink-0 select-none ${className}`}
      role="img"
      aria-label="Harfa حِرفة Logo"
    >
      <defs>
        {/* Outer Squircle Base Gradient */}
        <linearGradient id="harfa-bg-grad" x1="6" y1="4" x2="58" y2="60" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#0EA5E9" />
          <stop offset="48%" stopColor="#4F46E5" />
          <stop offset="100%" stopColor="#EC4899" />
        </linearGradient>

        {/* Translucent Surface Inner Sheen */}
        <linearGradient id="harfa-surface-sheen" x1="8" y1="6" x2="52" y2="54" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.62" />
          <stop offset="42%" stopColor="#FFFFFF" stopOpacity="0.14" />
          <stop offset="100%" stopColor="#38BDF8" stopOpacity="0.24" />
        </linearGradient>

        {/* Latin H Pillars Gradient */}
        <linearGradient id="harfa-pillars" x1="16" y1="13" x2="48" y2="51" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.96" />
          <stop offset="100%" stopColor="#BAE6FD" stopOpacity="0.78" />
        </linearGradient>

        {/* Arabic ح Crossbar & Bowl Gradient */}
        <linearGradient id="harfa-haa-curve" x1="14" y1="24" x2="50" y2="52" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#FFFFFF" />
          <stop offset="65%" stopColor="#F0F9FF" />
          <stop offset="100%" stopColor="#7DD3FC" />
        </linearGradient>

        <filter id="harfa-soft-shadow" x="-15%" y="-15%" width="130%" height="135%">
          <feDropShadow dx="0" dy="3" stdDeviation="3" floodColor="#0F172A" floodOpacity="0.28" />
        </filter>
      </defs>

      {/* Layer 1: Concentric Outer Squircle Base */}
      <rect x="2" y="2" width="60" height="60" rx="17" fill="url(#harfa-bg-grad)" />

      {/* Layer 2: Translucent Inner Plate (Concentric inner radius: 17 - 3 = 14) */}
      <rect
        x="5"
        y="5"
        width="54"
        height="54"
        rx="14"
        fill="url(#harfa-surface-sheen)"
        stroke="#FFFFFF"
        strokeOpacity="0.55"
        strokeWidth="1.25"
      />

      {/* Top Specular Glint Arc */}
      <path
        d="M14 7.5 H50"
        stroke="#FFFFFF"
        strokeOpacity="0.85"
        strokeWidth="1.5"
        strokeLinecap="round"
      />

      {/* Layer 3: Combined Latin "H" Pillars + Arabic "ح" Curve */}
      <g filter="url(#harfa-soft-shadow)">
        {/* Left & Right Stems of Latin "H" */}
        <path
          d="M18 15 V49 M46 15 V49"
          stroke="url(#harfa-pillars)"
          strokeWidth="6.5"
          strokeLinecap="round"
        />

        {/* Translucent Bridge */}
        <rect
          x="15"
          y="26"
          width="34"
          height="11"
          rx="5.5"
          fill="#FFFFFF"
          fillOpacity="0.22"
          stroke="#FFFFFF"
          strokeOpacity="0.5"
          strokeWidth="1"
        />

        {/* Arabic "ح" (Haa) Brow & Open Descender Loop fusing the H crossbar */}
        <path
          d="M15 29 C23 20, 41 20, 49 29 C40 32.5, 29 36.5, 29 44.5 C29 49.5, 34.5 52, 42.5 50.5"
          stroke="url(#harfa-haa-curve)"
          strokeWidth="5.75"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </g>
    </svg>
  );
};
