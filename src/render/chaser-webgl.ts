/** WebGL2 fallback for the chaser view. Same ray march; the lighting arrives precomputed from the worker. */
import { type VolumeData } from '../physics/compute';
import { BMAX } from '../physics/volume';
import { cameraBasis, SUN_DIR, type Camera, type ChaserRenderer } from './chaser';
import { cloudNoise } from './noise';

const VS = `#version 300 es
in vec2 p; void main(){ gl_Position = vec4(p, 0., 1.); }`;
const FS = `#version 300 es
precision highp float; precision highp sampler3D;
uniform sampler3D A; uniform sampler3D Nz; uniform vec2 res; uniform float L; uniform float ZT;
uniform vec3 cp; uniform vec3 cr; uniform vec3 cu; uniform vec3 cf; uniform float th; uniform float bmax; uniform vec3 sd;
out vec4 o;
vec3 S(vec3 q){ return texture(A, vec3((q.x + L) / (2. * L), (q.y + L) / (2. * L), q.z / ZT)).rgb; }
void main(){
  vec2 uv = (gl_FragCoord.xy / res) * 2. - 1.; uv.x *= res.x / res.y;
  vec3 rd = normalize(cf + uv.x * th * cr + uv.y * th * cu);
  vec3 inv = 1. / rd, b0 = vec3(-L, -L, 0.), b1 = vec3(L, L, ZT);
  vec3 t0 = (b0 - cp) * inv, t1 = (b1 - cp) * inv; vec3 tmn = min(t0, t1), tmx = max(t0, t1);
  float ta = max(max(tmn.x, tmn.y), max(tmn.z, 0.)), tb = min(min(tmx.x, tmx.y), tmx.z);
  float cosg = dot(rd, sd);
  vec3 sunc = vec3(1., .93, .8), skyc = vec3(.48, .58, .72), col = vec3(0.); float T = 1.;
  if (tb > ta) {
    float dt0 = .22; float t = ta + dt0 * fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
    float ph = .5 + 1.1 * pow(max(cosg, 0.), 8.);
    for (int i = 0; i < 480; i++) {
      if (t > tb || T < .01) break;
      vec3 q = cp + rd * t;
      vec3 s = S(q);
      float dt = dt0 * (1. + t / 60.);
      if (s.r <= .004) dt = max(dt, .7);
      if (s.r > .004) {
        float nn = .62 * texture(Nz, q * .085).r + .38 * texture(Nz, q * .27 + vec3(.31, .17, .53)).r;
        float d = clamp(s.r * (.45 + 1.1 * nn) - .03, 0., 1.);
        float be = d * d * bmax;
        if (be > .002) {
          float a = 1. - exp(-be * dt);
          float base = smoothstep(0., 1.2, q.z);
          vec3 Lc = sunc * (s.g * ph * 1.9) + skyc * (.2 + .65 * s.b) * (.75 + .25 * base);
          col += T * a * Lc; T *= 1. - a;
        }
      }
      t += dt;
    }
  }
  vec3 bg;
  if (rd.z < 0.) {
    float tg = -cp.z / rd.z; vec3 g = cp + rd * tg;
    float sh = 1.;
    if (abs(g.x) < L && abs(g.y) < L) sh = texture(A, vec3((g.x + L) / (2. * L), (g.y + L) / (2. * L), .01)).g;
    float hz = 1. - exp(-tg / 70.);
    bg = vec3(.24, .3, .16) * (.3 + .7 * sh) * (1. - hz) + vec3(.62, .66, .7) * hz * .85;
  } else {
    float el = clamp(rd.z, 0., 1.);
    bg = vec3(.78, .82, .86) * pow(1. - el, 3.) + vec3(.34, .5, .76) * (1. - pow(1. - el, 3.)) + .35 * pow(max(cosg, 0.), 24.) * vec3(1., .9, .7);
  }
  vec3 c = col + T * bg;
  c = 1. - exp(-1.7 * c);
  o = vec4(pow(c, vec3(1. / 1.1)), 1.);
}`;

export function createWebGLRenderer(canvas: HTMLCanvasElement): ChaserRenderer | null {
  const maybe = canvas.getContext('webgl2', { antialias: false, premultipliedAlpha: false });
  if (!maybe) return null;
  const gl: WebGL2RenderingContext = maybe;
  const sh = (type: number, src: string) => {
    const s = gl.createShader(type)!; gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader error');
    return s;
  };
  const prog = gl.createProgram()!;
  gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) ?? 'link error');
  gl.useProgram(prog);
  const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, 'p'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  const U: Record<string, WebGLUniformLocation | null> = {};
  for (const n of ['A', 'Nz', 'res', 'L', 'ZT', 'cp', 'cr', 'cu', 'cf', 'th', 'bmax', 'sd']) U[n] = gl.getUniformLocation(prog, n);
  gl.uniform1i(U.A, 0); gl.uniform1i(U.Nz, 1);
  const tex = gl.createTexture();
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  const NN = 48, ntex = gl.createTexture();
  gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_3D, ntex);
  gl.texImage3D(gl.TEXTURE_3D, 0, gl.R8, NN, NN, NN, 0, gl.RED, gl.UNSIGNED_BYTE, cloudNoise(NN));
  for (const p of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_3D, p, gl.LINEAR);
  for (const p of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T, gl.TEXTURE_WRAP_R]) gl.texParameteri(gl.TEXTURE_3D, p, gl.REPEAT);
  let vol: VolumeData | null = null;
  function draw(cam: Camera, W: number, H: number) {
    if (!vol) return;
    if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
    gl.viewport(0, 0, W, H);
    const b = cameraBasis(cam);
    gl.uniform2f(U.res, W, H); gl.uniform3fv(U.cp, b.cp); gl.uniform3fv(U.cr, b.r); gl.uniform3fv(U.cu, b.u); gl.uniform3fv(U.cf, b.f);
    gl.uniform1f(U.th, b.th); gl.uniform1f(U.bmax, BMAX); gl.uniform1f(U.L, vol.Rv / 1000); gl.uniform1f(U.ZT, vol.ZT / 1000);
    gl.uniform3fv(U.sd, SUN_DIR);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_3D, tex);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_3D, ntex);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  return {
    kind: 'webgl2', canvas, needsCpuLighting: true,
    setVolume(v) {
      if (!v.lit) return;
      vol = v;
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_3D, tex);
      gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGBA8, v.NV, v.NV, v.NZv, 0, gl.RGBA, gl.UNSIGNED_BYTE, v.lit);
      for (const p of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_3D, p, gl.LINEAR);
      for (const p of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T, gl.TEXTURE_WRAP_R]) gl.texParameteri(gl.TEXTURE_3D, p, gl.CLAMP_TO_EDGE);
    },
    render(cam: Camera, scaleIn?: number) {
      const scale = scaleIn ?? Math.min(window.devicePixelRatio || 1, 1.25);
      draw(cam, Math.round(canvas.clientWidth * scale), Math.round(canvas.clientHeight * scale));
    },
    async capture(cam: Camera, W: number, H: number) {
      if (!vol) return null;
      const keepW = canvas.width, keepH = canvas.height;
      draw(cam, W, H);
      const px = new Uint8Array(W * H * 4);
      gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px);
      const out = new ImageData(W, H);
      for (let y = 0; y < H; y++) out.data.set(px.subarray((H - 1 - y) * W * 4, (H - y) * W * 4), y * W * 4);
      canvas.width = keepW; canvas.height = keepH;
      return out;
    },
    destroy() { gl.getExtension('WEBGL_lose_context')?.loseContext(); }
  };
}
