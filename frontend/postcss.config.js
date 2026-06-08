export default {
  plugins: {
    "@tailwindcss/postcss": {},
    // Convert oklch()/oklab() to rgb() for older browsers (webOS, HbbTV, etc.).
    // preserve:false emits only rgb — no oklch fallback duplication.
    "@csstools/postcss-oklab-function": { preserve: false },
  },
};
