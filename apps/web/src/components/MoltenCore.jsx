import { useEffect, useRef } from 'react';
import * as THREE from 'three';

/**
 * The molten Ember core — WebGL port of the design handoff's hero object:
 * a noise-displaced icosahedron with fresnel heat shading, an additive glow
 * shell and rising ember particles. Falls back to a CSS orb if WebGL fails.
 */
const NOISE_GLSL = `
vec3 mod289(vec3 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 mod289(vec4 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 permute(vec4 x){return mod289(((x*34.0)+1.0)*x);}
vec4 taylorInvSqrt(vec4 r){return 1.79284291400159-0.85373472095314*r;}
float snoise(vec3 v){
  const vec2 C=vec2(1.0/6.0,1.0/3.0); const vec4 D=vec4(0.0,0.5,1.0,2.0);
  vec3 i=floor(v+dot(v,C.yyy)); vec3 x0=v-i+dot(i,C.xxx);
  vec3 g=step(x0.yzx,x0.xyz); vec3 l=1.0-g; vec3 i1=min(g.xyz,l.zxy); vec3 i2=max(g.xyz,l.zxy);
  vec3 x1=x0-i1+C.xxx; vec3 x2=x0-i2+C.yyy; vec3 x3=x0-D.yyy;
  i=mod289(i);
  vec4 p=permute(permute(permute(i.z+vec4(0.0,i1.z,i2.z,1.0))+i.y+vec4(0.0,i1.y,i2.y,1.0))+i.x+vec4(0.0,i1.x,i2.x,1.0));
  float n_=0.142857142857; vec3 ns=n_*D.wyz-D.xzx;
  vec4 j=p-49.0*floor(p*ns.z*ns.z);
  vec4 x_=floor(j*ns.z); vec4 y_=floor(j-7.0*x_);
  vec4 x=x_*ns.x+ns.yyyy; vec4 y=y_*ns.x+ns.yyyy; vec4 h=1.0-abs(x)-abs(y);
  vec4 b0=vec4(x.xy,y.xy); vec4 b1=vec4(x.zw,y.zw);
  vec4 s0=floor(b0)*2.0+1.0; vec4 s1=floor(b1)*2.0+1.0; vec4 sh=-step(h,vec4(0.0));
  vec4 a0=b0.xzyw+s0.xzyw*sh.xxyy; vec4 a1=b1.xzyw+s1.xzyw*sh.zzww;
  vec3 p0=vec3(a0.xy,h.x); vec3 p1=vec3(a0.zw,h.y); vec3 p2=vec3(a1.xy,h.z); vec3 p3=vec3(a1.zw,h.w);
  vec4 norm=taylorInvSqrt(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));
  p0*=norm.x; p1*=norm.y; p2*=norm.z; p3*=norm.w;
  vec4 m=max(0.6-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.0); m=m*m;
  return 42.0*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));
}`;

export default function MoltenCore({ opacity = 1 }) {
  const canvasRef = useRef(null);
  const fallbackRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
    } catch {
      return; // CSS fallback stays visible
    }
    if (fallbackRef.current) fallbackRef.current.style.display = 'none';
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
    camera.position.z = 4.2;

    const uniforms = {
      uTime: { value: 0 },
      uScroll: { value: 0 },
      uColA: { value: new THREE.Color('#2a0e02') },
      uColB: { value: new THREE.Color('#ff6a14') },
      uColC: { value: new THREE.Color('#ffe2a8') }
    };

    const mat = new THREE.ShaderMaterial({
      uniforms,
      vertexShader:
        NOISE_GLSL +
        `
        uniform float uTime; uniform float uScroll;
        varying float vDisp; varying vec3 vNormalW; varying vec3 vView;
        void main(){
          float t = uTime*0.45;
          float n = snoise(normal*1.6 + vec3(t));
          float n2 = snoise(position*2.6 - vec3(t*0.7))*0.5;
          float disp = (n + n2) * (0.34 + uScroll*0.18);
          vDisp = disp;
          vec3 pos = position + normal*disp;
          vec4 mv = modelViewMatrix * vec4(pos,1.0);
          vView = normalize(-mv.xyz);
          vNormalW = normalize(normalMatrix * normal);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        uniform vec3 uColA; uniform vec3 uColB; uniform vec3 uColC;
        varying float vDisp; varying vec3 vNormalW; varying vec3 vView;
        void main(){
          float fres = pow(1.0 - max(dot(vNormalW, vView),0.0), 2.2);
          float heat = smoothstep(-0.3, 0.4, vDisp);
          vec3 col = mix(uColA, uColB, heat);
          col = mix(col, uColC, fres*0.9 + heat*0.25);
          col += uColB * pow(heat,2.0) * 0.6;
          gl_FragColor = vec4(col, 1.0);
        }`
    });

    const core = new THREE.Mesh(new THREE.IcosahedronGeometry(1.25, 64), mat);
    scene.add(core);

    const glow = new THREE.Mesh(
      new THREE.SphereGeometry(1.7, 32, 32),
      new THREE.MeshBasicMaterial({ color: new THREE.Color('#ff7a1a'), transparent: true, opacity: 0.18, blending: THREE.AdditiveBlending, side: THREE.BackSide })
    );
    scene.add(glow);

    const N = 240;
    const pg = new THREE.BufferGeometry();
    const pos = new Float32Array(N * 3);
    const spd = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const r = 1.6 + Math.random() * 1.6;
      const a = Math.random() * 6.28;
      const b = Math.acos(2 * Math.random() - 1);
      pos[i * 3] = r * Math.sin(b) * Math.cos(a);
      pos[i * 3 + 1] = r * Math.cos(b);
      pos[i * 3 + 2] = r * Math.sin(b) * Math.sin(a);
      spd[i] = 0.2 + Math.random() * 0.6;
    }
    pg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const pts = new THREE.Points(
      pg,
      new THREE.PointsMaterial({ color: new THREE.Color('#ffb060'), size: 0.045, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false })
    );
    scene.add(pts);

    const mouse = { x: 0, y: 0, tx: 0, ty: 0 };
    const onMouse = (e) => {
      mouse.tx = e.clientX / window.innerWidth - 0.5;
      mouse.ty = e.clientY / window.innerHeight - 0.5;
    };
    window.addEventListener('mousemove', onMouse);

    const size = () => {
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    size();
    window.addEventListener('resize', size);

    const clock = new THREE.Clock();
    let raf;
    const tick = () => {
      const t = clock.getElapsedTime();
      const scroll = window.scrollY / window.innerHeight;
      uniforms.uTime.value = t;
      uniforms.uScroll.value = scroll;
      mouse.x += (mouse.tx - mouse.x) * 0.05;
      mouse.y += (mouse.ty - mouse.y) * 0.05;
      core.rotation.y = t * 0.18 + mouse.x * 0.6;
      core.rotation.x = mouse.y * 0.5 + Math.sin(t * 0.2) * 0.1;
      glow.rotation.copy(core.rotation);
      const s = 1 + scroll * 0.15;
      core.scale.setScalar(s);
      glow.scale.setScalar(s);
      const p = pg.attributes.position.array;
      for (let i = 0; i < N; i++) {
        p[i * 3 + 1] += spd[i] * 0.01;
        const ang = 0.002 * spd[i];
        const x = p[i * 3];
        const z = p[i * 3 + 2];
        p[i * 3] = x * Math.cos(ang) - z * Math.sin(ang);
        p[i * 3 + 2] = x * Math.sin(ang) + z * Math.cos(ang);
        if (p[i * 3 + 1] > 2.6) p[i * 3 + 1] = -2.0;
      }
      pg.attributes.position.needsUpdate = true;
      pts.rotation.y = t * 0.05;
      renderer.render(scene, camera);
      raf = requestAnimationFrame(tick);
    };
    tick();

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('mousemove', onMouse);
      window.removeEventListener('resize', size);
      renderer.dispose();
      pg.dispose();
      mat.dispose();
    };
  }, []);

  return (
    <div className="stage" style={{ opacity }}>
      <div className="stage-tint" />
      <div className="stage-glow" />
      <canvas ref={canvasRef} />
      <div ref={fallbackRef} className="stage-fallback" />
    </div>
  );
}
