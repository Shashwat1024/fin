/** Migration SQL imported as text (Vite/Vitest `?raw`). */
declare module '*.sql?raw' {
  const sql: string
  export default sql
}
