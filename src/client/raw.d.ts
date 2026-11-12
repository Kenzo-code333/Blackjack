// Vite imports a file's text with `?raw` (used for the arcade games).
declare module '*?raw' {
  const text: string;
  export default text;
}
