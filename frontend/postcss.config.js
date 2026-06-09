// The old-browser compatibility transforms below are needed ONLY for the production
// bundle that ships to webOS / old smart-TV engines (Chrome <99). In dev we run a
// modern browser that supports these natively — and crucially,
// @csstools/postcss-cascade-layers misbehaves under Vite's incremental dev pipeline:
// it strips the @media (responsive) utilities, so lg:/md: breakpoints vanish and the
// layout falls back to its small-screen state (e.g. the sidebar stays a drawer even
// on a wide desktop). So apply them in production builds only.
const isDev = process.env.NODE_ENV === "development";

export default {
  plugins: {
    "@tailwindcss/postcss": {},
    ...(isDev
      ? {}
      : {
          // Flatten @layer blocks into specificity-equivalent CSS for browsers that
          // predate Cascade Layers (Chrome <99, webOS, HbbTV, older smart-TV engines).
          "@csstools/postcss-cascade-layers": {},
          // Remove "in oklab"/"in oklch" interpolation hints from gradients (Chrome 111+);
          // older browsers ignore the entire background-image declaration if they see them.
          "@csstools/postcss-gradients-interpolation-method": { preserve: false },
          // Convert oklch()/oklab() to rgb() for older browsers.
          "@csstools/postcss-oklab-function": { preserve: false },
        }),
  },
};
