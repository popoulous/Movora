// Allow side-effect imports of plain CSS (e.g. import "../theme.css").
declare module "*.css";

// Image imports resolve to a URL string via webpack.
declare module "*.png" {
  const url: string;
  export default url;
}
