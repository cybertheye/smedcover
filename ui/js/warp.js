// A picture drawn through a projective map (a layer turned in 3D, see tilt.js): the one thing a canvas's 2D context
// cannot do. WebGL2 draws it — each pixel of the result sampled where the map's inverse takes it, from the picture's
// mipmaps (and anisotropic filtering where there is some), so the side turned away stays smooth rather than
// sparkling — and, where there is no WebGL, the same is done in script, sampled bilinearly.
import { TILT, inv3, mul3, shift3, scale3 } from "./tilt.js";

const VS = `#version 300 es
in vec2 p;
void main() { gl_Position = vec4(p, 0.0, 1.0); }`;
// back: a pixel of the result (its centre, from the top left) to the picture's pixels, divided by depth z — 1 over the
// depth the turn gave that point: at or below 0 behind the eye, past `far` too near it to draw
const FS = `#version 300 es
precision highp float;
uniform sampler2D tex;
uniform mat3 back;
uniform vec2 size;
uniform vec2 src;
uniform float far;
out vec4 color;
void main() {
  vec3 q = back * vec3(gl_FragCoord.x, size.y - gl_FragCoord.y, 1.0);
  float z = abs(q.z) < 1e-9 ? 1e-9 : q.z;
  vec2 uv = q.xy / z / src;
  vec4 c = textureGrad(tex, uv, dFdx(uv), dFdy(uv));
  float inside = step(0.0, uv.x) * step(0.0, uv.y) * step(uv.x, 1.0) * step(uv.y, 1.0) * step(1e-9, q.z) * step(q.z, far);
  color = c * inside;
}`;

/** The WebGL side, made once: its canvas, context, program, texture; `broken` once it cannot be had. */
const GL = { c: null, gl: null, prog: null, tex: null, loc: null, max: 0, aniso: null, broken: false };
function gl() {
  if (GL.gl || GL.broken || typeof document === "undefined") return GL.gl;
  try {
    const c = document.createElement("canvas");
    const g = c.getContext("webgl2", { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false, preserveDrawingBuffer: true });
    if (!g) { GL.broken = true; return null; }
    const shader = (type, text) => { const s = g.createShader(type); g.shaderSource(s, text); g.compileShader(s); if (!g.getShaderParameter(s, g.COMPILE_STATUS)) throw new Error(g.getShaderInfoLog(s)); return s; };
    const prog = g.createProgram();
    g.attachShader(prog, shader(g.VERTEX_SHADER, VS)); g.attachShader(prog, shader(g.FRAGMENT_SHADER, FS)); g.linkProgram(prog);
    if (!g.getProgramParameter(prog, g.LINK_STATUS)) throw new Error(g.getProgramInfoLog(prog));
    g.useProgram(prog);
    const buf = g.createBuffer();   // one triangle over the whole view
    g.bindBuffer(g.ARRAY_BUFFER, buf); g.bufferData(g.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), g.STATIC_DRAW);
    const at = g.getAttribLocation(prog, "p");
    g.enableVertexAttribArray(at); g.vertexAttribPointer(at, 2, g.FLOAT, false, 0, 0);
    const tex = g.createTexture();
    g.bindTexture(g.TEXTURE_2D, tex);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MIN_FILTER, g.LINEAR_MIPMAP_LINEAR); g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MAG_FILTER, g.LINEAR);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_S, g.CLAMP_TO_EDGE); g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_T, g.CLAMP_TO_EDGE);
    const aniso = g.getExtension("EXT_texture_filter_anisotropic");
    if (aniso) g.texParameterf(g.TEXTURE_2D, aniso.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(8, g.getParameter(aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT)));
    g.pixelStorei(g.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);   // a canvas's pixels are premultiplied as they are drawn, and are filtered so
    g.pixelStorei(g.UNPACK_FLIP_Y_WEBGL, false);
    g.uniform1i(g.getUniformLocation(prog, "tex"), 0);
    c.addEventListener("webglcontextlost", (e) => { e.preventDefault(); GL.gl = null; });   // made again at the next turn
    Object.assign(GL, { c, gl: g, prog, tex, aniso, max: Math.min(g.getParameter(g.MAX_TEXTURE_SIZE), g.getParameter(g.MAX_RENDERBUFFER_SIZE)),
      loc: { back: g.getUniformLocation(prog, "back"), size: g.getUniformLocation(prog, "size"), src: g.getUniformLocation(prog, "src"), far: g.getUniformLocation(prog, "far") } });
    return g;
  } catch (e) {
    console.warn("WebGL is not to be had for turning pictures in 3D; they are turned in script", e);
    GL.broken = true;
    return null;
  }
}
/** For the tests and the self-test: whether pictures are turned on the graphics card. */
export const warpsOnCard = () => !!gl();
let small = null, byScript = null;

/**
 * Draws canvas `src` onto context `dst` through map `m` (3×3, row by row: from `src`'s pixels to `dst`'s canvas's
 * pixels), within box `to` ({x0, y0, x1, y1} in whole pixels of `dst`'s canvas) and at opacity `alpha`. Nothing is
 * drawn where the map takes the picture behind the eye or too near it (see TILT.least).
 */
export function warpOnto(dst, src, m, to, alpha = 1) {
  const w = to.x1 - to.x0, h = to.y1 - to.y0;
  if (w <= 0 || h <= 0 || !src.width || !src.height) return;
  const out = warped(src, mul3(shift3(-to.x0, -to.y0), m), w, h);
  if (!out) return;
  dst.save(); dst.setTransform(1, 0, 0, 1, 0, 0); dst.globalAlpha *= alpha;
  dst.drawImage(out, 0, 0, w, h, to.x0, to.y0, w, h);
  dst.restore();
  if (w * h > BIG_PX) letGo();
}
/** Canvases past this many pixels (an export's) are let go after use, as render.js lets go of its work canvases: WebKit stops drawing new canvases past its total. */
const BIG_PX = 5e6;
function letGo() {
  for (const c of [small, byScript]) if (c) c.width = c.height = 0;
  if (GL.gl && GL.c.width * GL.c.height > BIG_PX) {
    GL.c.width = GL.c.height = 1;
    try { GL.gl.bindTexture(GL.gl.TEXTURE_2D, GL.tex); GL.gl.texImage2D(GL.gl.TEXTURE_2D, 0, GL.gl.RGBA, 1, 1, 0, GL.gl.RGBA, GL.gl.UNSIGNED_BYTE, null); } catch {}
  }
}

/** `src` through map `m` (to a w × h result), on a canvas whose top left w × h holds it; null when the map has no inverse. */
function warped(src, m, w, h) {
  const g = gl();
  if (g && w <= GL.max && h <= GL.max) {
    // a picture larger than the card takes goes on it smaller (the map then from those pixels)
    const f = Math.min(1, GL.max / src.width, GL.max / src.height);
    if (f < 1) {
      small = small || document.createElement("canvas");
      small.width = Math.max(1, Math.floor(src.width * f)); small.height = Math.max(1, Math.floor(src.height * f));
      small.getContext("2d").drawImage(src, 0, 0, small.width, small.height);
      m = mul3(m, scale3(src.width / small.width, src.height / small.height)); src = small;
    }
    const back = inv3(m);
    if (!back) return null;
    try {
      if (GL.c.width !== w || GL.c.height !== h) { GL.c.width = w; GL.c.height = h; }
      g.viewport(0, 0, w, h);
      g.bindTexture(g.TEXTURE_2D, GL.tex);
      g.texImage2D(g.TEXTURE_2D, 0, g.RGBA, g.RGBA, g.UNSIGNED_BYTE, src);
      g.generateMipmap(g.TEXTURE_2D);
      // the result's pixel centres (x + 0.5, from the top) — gl_FragCoord gives them so
      g.uniformMatrix3fv(GL.loc.back, true, new Float32Array(back));
      g.uniform2f(GL.loc.size, w, h); g.uniform2f(GL.loc.src, src.width, src.height); g.uniform1f(GL.loc.far, 1 / TILT.least);
      g.clearColor(0, 0, 0, 0); g.clear(g.COLOR_BUFFER_BIT);
      g.drawArrays(g.TRIANGLES, 0, 3);
      if (!g.isContextLost()) return GL.c;
    } catch (e) { console.warn("Turning a picture on the graphics card failed; it is turned in script", e); }
  }
  const back = inv3(m);
  return back && inScript(src, back, w, h);
}

/** The same in script: each pixel of the w × h result sampled bilinearly (premultiplied, as the card filters) where `back` takes it. */
function inScript(src, back, w, h) {
  const sw = src.width, sh = src.height;
  let px;
  try { px = src.getContext("2d").getImageData(0, 0, sw, sh).data; } catch { return null; }
  byScript = byScript || document.createElement("canvas");
  byScript.width = w; byScript.height = h;
  const g = byScript.getContext("2d"), img = g.createImageData(w, h), d = img.data, far = 1 / TILT.least;
  const at = (x, y, k) => px[(y * sw + x) * 4 + k];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const X = x + 0.5, Y = y + 0.5, z = back[6] * X + back[7] * Y + back[8];
      if (!(z > 0 && z <= far)) continue;
      const u = (back[0] * X + back[1] * Y + back[2]) / z - 0.5, v = (back[3] * X + back[4] * Y + back[5]) / z - 0.5;
      if (u < -0.5 || v < -0.5 || u > sw - 0.5 || v > sh - 0.5) continue;
      const x0 = Math.max(0, Math.min(sw - 1, Math.floor(u))), y0 = Math.max(0, Math.min(sh - 1, Math.floor(v))), x1 = Math.min(sw - 1, x0 + 1), y1 = Math.min(sh - 1, y0 + 1);
      const fx = Math.min(1, Math.max(0, u - x0)), fy = Math.min(1, Math.max(0, v - y0));
      const wts = [(1 - fx) * (1 - fy), fx * (1 - fy), (1 - fx) * fy, fx * fy], ps = [[x0, y0], [x1, y0], [x0, y1], [x1, y1]];
      let a = 0, r = 0, gg = 0, b = 0;
      for (let i = 0; i < 4; i++) { const [px0, py0] = ps[i], al = at(px0, py0, 3) * wts[i]; a += al; r += at(px0, py0, 0) * al; gg += at(px0, py0, 1) * al; b += at(px0, py0, 2) * al; }
      if (a <= 0) continue;
      const o = (y * w + x) * 4;
      d[o] = r / a; d[o + 1] = gg / a; d[o + 2] = b / a; d[o + 3] = a;
    }
  }
  g.putImageData(img, 0, 0);
  return byScript;
}
