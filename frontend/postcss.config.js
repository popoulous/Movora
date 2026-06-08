export default {
  plugins: {
    "@tailwindcss/postcss": {},
    // Flatten @layer blocks into specificity-equivalent CSS for browsers that
    // predate Cascade Layers (Chrome <99, webOS, HbbTV, older smart-TV engines).
    "@csstools/postcss-cascade-layers": {},
    // Remove "in oklab"/"in oklch" interpolation hints from gradients (Chrome 111+);
    // older browsers ignore the entire background-image declaration if they see them.
    "@csstools/postcss-gradients-interpolation-method": { preserve: false },
    // Convert oklch()/oklab() to rgb() for older browsers.
    "@csstools/postcss-oklab-function": { preserve: false },
  },
};
