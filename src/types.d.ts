declare module 'b4a' {
  export function toString(data: Uint8Array, encoding?: string): string
  export function from(data: string, encoding?: string): Uint8Array
}

declare module '*worker.bundle.js' {
  const bundle: unknown
  export default bundle
}
