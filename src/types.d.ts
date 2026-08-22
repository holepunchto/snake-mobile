declare module 'b4a' {
  export function toString(data: Uint8Array, encoding?: string): string
  export function from(data: string, encoding?: string): Uint8Array
}

declare module 'framed-stream' {
  export default class FramedStream {
    constructor(stream: unknown)
    on(event: 'data', listener: (data: Uint8Array) => void): this
    on(event: 'error', listener: (err: Error) => void): this
    write(data: string): void
    destroy(): void
  }
}

declare module 'pear-mobile' {
  const PearRuntime: {
    run(entry: string, bundle: unknown, args?: string[]): unknown
  }
  export default PearRuntime
}

declare module '*worker.bundle.js' {
  const bundle: unknown
  export default bundle
}
