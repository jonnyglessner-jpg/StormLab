/** Build date, injected by esbuild. */
declare const __BUILD__: string;

/** Stylesheets are bundled by esbuild. */
declare module '*.css';

/** WebGPU usage flags (TypeScript's DOM library has the WebGPU interfaces but not these runtime constants). */
declare const GPUBufferUsage: {
  readonly MAP_READ: number; readonly MAP_WRITE: number; readonly COPY_SRC: number; readonly COPY_DST: number;
  readonly INDEX: number; readonly VERTEX: number; readonly UNIFORM: number; readonly STORAGE: number;
};
declare const GPUTextureUsage: {
  readonly COPY_SRC: number; readonly COPY_DST: number; readonly TEXTURE_BINDING: number;
  readonly STORAGE_BINDING: number; readonly RENDER_ATTACHMENT: number;
};
declare const GPUMapMode: { readonly READ: number; readonly WRITE: number };
