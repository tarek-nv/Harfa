declare module 'svgpath' {
  interface SvgPathInstance {
    segments: Array<[string, ...number[]]>;
    abs(): SvgPathInstance;
    rel(): SvgPathInstance;
    unarc(): SvgPathInstance;
    unshort(): SvgPathInstance;
    transform(transformString: string): SvgPathInstance;
    scale(sx: number, sy?: number): SvgPathInstance;
    translate(x: number, y?: number): SvgPathInstance;
    rotate(angle: number, rx?: number, ry?: number): SvgPathInstance;
    matrix(m: number[]): SvgPathInstance;
    round(precision?: number): SvgPathInstance;
    toString(): string;
    iterate(
      iterator: (
        segment: [string, ...number[]],
        index: number,
        x: number,
        y: number
      ) => void | Array<[string, ...number[]]> | boolean,
      keepLazyStack?: boolean
    ): SvgPathInstance;
  }

  function svgpath(pathString: string): SvgPathInstance;
  export default svgpath;
}
