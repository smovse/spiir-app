import React from "react";

/*
 * Minimal line-icon set replacing lucide-react in the standalone build
 * (no access to that package here). Same call signature as lucide-react
 * icons: <IconName size={16} color="#000" strokeWidth={2} />.
 */

function base(paths, viewBox = "0 0 24 24") {
  return function Icon({ size = 20, color = "currentColor", strokeWidth = 2, style, ...rest }) {
    return (
      <svg
        width={size}
        height={size}
        viewBox={viewBox}
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        style={style}
        {...rest}
      >
        {paths}
      </svg>
    );
  };
}

export const Home = base(
  <path d="M3 11.5 12 4l9 7.5M5 10v9a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1v-9" />
);

export const Wallet = base(
  <>
    <path d="M3 7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
    <path d="M16 12h3" />
    <path d="M3 9h18" />
  </>
);

export const ListTree = base(
  <>
    <path d="M4 4v6h6" />
    <path d="M4 10v8" />
    <path d="M10 6h10" />
    <path d="M10 12h10" />
    <path d="M10 18h10" />
  </>
);

export const Settings = base(
  <>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1 1.55V21a2 2 0 0 1-4 0v-.09A1.7 1.7 0 0 0 9 19.36a1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.64 15a1.7 1.7 0 0 0-1.55-1H3a2 2 0 0 1 0-4h.09A1.7 1.7 0 0 0 4.64 9a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 9 4.64a1.7 1.7 0 0 0 1-1.55V3a2 2 0 0 1 4 0v.09a1.7 1.7 0 0 0 1 1.55 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.36 9a1.7 1.7 0 0 0 1.55 1H21a2 2 0 0 1 0 4h-.09a1.7 1.7 0 0 0-1.55 1Z" />
  </>
);

export const Calendar = base(
  <>
    <rect x="3" y="4.5" width="18" height="16" rx="2" />
    <path d="M16 2.5v4M8 2.5v4M3 9.5h18" />
  </>
);

export const Plus = base(<path d="M12 5v14M5 12h14" />);

export const X = base(<path d="M18 6 6 18M6 6l12 12" />);

export const FileText = base(
  <>
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
    <path d="M14 2v6h6" />
    <path d="M8 13h8M8 17h8M8 9h2" />
  </>
);

export const ArrowUpRight = base(<path d="M7 17 17 7M7 7h10v10" />);
export const ArrowDownRight = base(<path d="M7 7l10 10M17 7v10H7" />);
export const ChevronRight = base(<path d="m9 6 6 6-6 6" />);
export const Search = base(
  <>
    <circle cx="11" cy="11" r="7" />
    <path d="m21 21-4.3-4.3" />
  </>
);
export const Info = base(
  <>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 16v-5M12 8h.01" />
  </>
);
