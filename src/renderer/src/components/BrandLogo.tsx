import React from 'react';

/**
 * The app's cloud-terminal mark (build/cloud_icon_yellow.svg), inlined as a
 * component so it renders crisp at any size without an extra asset request —
 * same pattern as the lucide-react icons used everywhere else.
 */
export const BrandLogo: React.FC<{ className?: string }> = ({ className }) => (
  <svg viewBox="60 110 392 284" className={className} fill="none" aria-hidden="true">
    <path
      d="M 191 254 L 234 297 L 156 373 A 72 72 0 1 1 160.3 229.1 A 96 96 0 0 1 351.7 229.1 A 72 72 0 1 1 356 373"
      stroke="#EAB308"
      strokeWidth="28"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <polygon points="216,359 360,359 360,387 188,387" fill="#EAB308" />
    <rect x="268" y="325" width="62" height="22" fill="#EAB308" />
  </svg>
);
