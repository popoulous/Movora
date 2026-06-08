export default {
  plugins: {
    "@tailwindcss/postcss": {},
    // Flatten @layer blocks into specificity-equivalent CSS for browsers that
    // predate Cascade Layers (Chrome <99, webOS, HbbTV, older smart-TV engines).
    // Must run before oklab so both transforms see the fully expanded CSS.
    "@csstools/postcss-cascade-layers": {},
    // Convert oklch()/oklab() to rgb() for older browsers (webOS, HbbTV, etc.).
    // preserve:false emits only rgb — no oklch fallback duplication.
    "@csstools/postcss-oklab-function": { preserve: false },
  },
};
