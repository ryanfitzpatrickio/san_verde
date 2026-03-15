import * as THREE from 'three/webgpu';
import {
  Fn,
  float,
  vec2,
  vec3,
  vec4,
  color,
  uniform,
  uv,
  time,
  mix,
  smoothstep,
  step,
  max,
  pow,
  abs,
  length,
  floor,
  fract,
  mod,
  sin,
  cos,
  positionLocal,
  positionWorld,
  normalWorld,
  cameraPosition,
  attribute,
  oscSine
} from 'three/tsl';

let camera, scene, renderer;
let timer;
let gridMesh, sunMesh, mountainsMesh;

const uniforms = {
  speed: uniform(1.0)
};

async function init() {
  if (!navigator.gpu) {
    document.getElementById('error').style.display = 'block';
    return;
  }

  timer = new THREE.Timer();
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x050010);

  camera = new THREE.PerspectiveCamera(65, window.innerWidth / window.innerHeight, 0.1, 1000);
  camera.position.set(0, 3, 8);
  camera.lookAt(0, 2, -20);

  renderer = new THREE.WebGPURenderer({ antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  document.body.appendChild(renderer.domElement);
  await renderer.init();

  createBackgroundGradient();
  createSun();
  createSunRays();
  createGrid();
  createMountains();
  createStars();
  createParticles();
  createScanLines();
  createVignette();

  window.addEventListener('resize', onWindowResize);

  renderer.setAnimationLoop(animate);
}

function createBackgroundGradient() {
  const geometry = new THREE.PlaneGeometry(400, 200);
  
  const material = new THREE.MeshBasicNodeMaterial({
    side: THREE.DoubleSide,
    depthWrite: false
  });

  material.colorNode = Fn(() => {
    const vUv = uv();
    
    const color1 = color(0x0a001a);
    const color2 = color(0x1a0033);
    const color3 = color(0x330044);
    
    const gradient = smoothstep(float(0.0), float(0.5), vUv.y);
    const gradient2 = smoothstep(float(0.5), float(1.0), vUv.y);
    
    const bgColor = mix(color1, color2, gradient);
    const finalColor = mix(bgColor, color3, gradient2);
    
    return vec4(finalColor, float(1.0));
  })();

  const bg = new THREE.Mesh(geometry, material);
  bg.position.z = -80;
  bg.position.y = 20;
  scene.add(bg);
}

function createSun() {
  const geometry = new THREE.CircleGeometry(5, 128);
  
  const material = new THREE.MeshBasicNodeMaterial({
    side: THREE.DoubleSide
  });

  material.colorNode = Fn(() => {
    const vUv = uv();
    const centered = vUv.sub(vec2(0.5));
    const dist = length(centered).mul(2.0);
    
    const y = vUv.y;
    const stripeCount = float(15.0);
    
    const stripeY = floor(y.mul(stripeCount));
    const stripeMask = step(float(0.5), mod(stripeY, float(2.0)));
    
    const color1 = color(0xff0066);
    const color2 = color(0xff3300);
    const color3 = color(0xff6600);
    const color4 = color(0xffaa00);
    const color5 = color(0xffdd44);
    
    const gradientPos = smoothstep(float(0.0), float(1.0), y);
    const band1 = mix(color1, color2, smoothstep(float(0.0), float(0.25), gradientPos));
    const band2 = mix(band1, color3, smoothstep(float(0.25), float(0.5), gradientPos));
    const band3 = mix(band2, color4, smoothstep(float(0.5), float(0.75), gradientPos));
    const sunColor = mix(band3, color5, smoothstep(float(0.75), float(1.0), gradientPos));
    
    const wobble = sin(y.mul(float(30.0)).add(time.mul(float(2.0)))).mul(float(0.02));
    const distortedDist = dist.add(wobble);
    
    const edgeFade = smoothstep(float(1.0), float(0.8), distortedDist);
    
    const stripeIntensity = mix(float(0.4), float(1.0), stripeMask);
    const finalColor = sunColor.mul(stripeIntensity).mul(edgeFade);
    
    return vec4(finalColor, float(1.0));
  })();

  sunMesh = new THREE.Mesh(geometry, material);
  sunMesh.position.set(0, 6, -50);
  scene.add(sunMesh);
  
  const glowGeometry = new THREE.CircleGeometry(7, 128);
  const glowMaterial = new THREE.MeshBasicNodeMaterial({
    transparent: true,
    side: THREE.DoubleSide,
    depthWrite: false
  });

  glowMaterial.colorNode = Fn(() => {
    const vUv = uv();
    const centered = vUv.sub(vec2(0.5));
    const dist = length(centered).mul(2.0);
    
    const glowColor1 = color(0xff0066);
    const glowColor2 = color(0xff3300);
    const glowColor = mix(glowColor1, glowColor2, dist);
    
    const pulse = oscSine(time.mul(float(1.5))).mul(float(0.1)).add(float(0.9));
    const falloff = smoothstep(float(1.0), float(0.4), dist);
    
    return vec4(glowColor.mul(pulse), falloff.mul(float(0.4)));
  })();

  const glow = new THREE.Mesh(glowGeometry, glowMaterial);
  glow.position.set(0, 6, -50.1);
  scene.add(glow);
}

function createSunRays() {
  const count = 12;
  
  for (let i = 0; i < count; i++) {
    const geometry = new THREE.PlaneGeometry(0.15, 30);
    
    const material = new THREE.MeshBasicNodeMaterial({
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: false
    });

    material.colorNode = Fn(() => {
      const vUv = uv();
      const fadeY = smoothstep(float(0.0), float(0.3), vUv.y).mul(smoothstep(float(1.0), float(0.5), vUv.y));
      const fadeX = smoothstep(float(0.0), float(0.3), vUv.x).mul(smoothstep(float(1.0), float(0.7), vUv.x));
      
      const rayColor = color(0xff4400);
      const alpha = fadeY.mul(fadeX).mul(float(0.15));
      
      return vec4(rayColor, alpha);
    })();

    const ray = new THREE.Mesh(geometry, material);
    const angle = (i / count) * Math.PI * 0.8 - Math.PI * 0.4;
    ray.rotation.z = angle;
    ray.position.set(0, 6, -50.2);
    scene.add(ray);
  }
}

function createGrid() {
  const geometry = new THREE.PlaneGeometry(300, 400, 200, 200);
  
  const material = new THREE.MeshBasicNodeMaterial({
    transparent: true,
    side: THREE.DoubleSide,
    depthWrite: false
  });

  material.colorNode = Fn(() => {
    const pos = positionWorld;
    const x = pos.x;
    const z = pos.z;
    const t = time.mul(uniforms.speed);
    
    const gridSize = float(2.0);
    const lineWidth = float(0.08);
    
    const scrollZ = z.add(t.mul(float(10.0)));
    
    const gridX = abs(fract(x.div(gridSize)).sub(float(0.5))).mul(gridSize);
    const gridZ = abs(fract(scrollZ.div(gridSize)).sub(float(0.5))).mul(gridSize);
    
    const lineX = smoothstep(lineWidth, float(0.0), gridX);
    const lineZ = smoothstep(lineWidth, float(0.0), gridZ);
    const grid = max(lineX, lineZ);
    
    const dist = length(vec2(x, z));
    const fadeOut = smoothstep(float(150.0), float(30.0), dist);
    const heightFade = smoothstep(float(-100.0), float(-10.0), z);
    
    const color1 = color(0x00ffff);
    const color2 = color(0xff00ff);
    const color3 = color(0x00ff88);
    const colorMix = smoothstep(float(-80.0), float(0.0), z);
    const gridColor = mix(color1, color2, colorMix);
    const gridColor2 = mix(gridColor, color3, sin(z.mul(float(0.05)).add(t)).mul(float(0.5)).add(float(0.5)));
    
    const scanPulse = smoothstep(float(0.95), float(1.0), sin(scrollZ.mul(float(0.3))).mul(float(0.5)).add(float(0.5)));
    
    const finalColor = gridColor2.mul(grid.mul(fadeOut).mul(heightFade).add(scanPulse.mul(float(0.2))));
    
    return vec4(finalColor, grid.mul(fadeOut).mul(heightFade).mul(float(0.95)));
  })();

  gridMesh = new THREE.Mesh(geometry, material);
  gridMesh.rotation.x = -Math.PI / 2;
  gridMesh.position.y = 0;
  gridMesh.position.z = -100;
  scene.add(gridMesh);
}

function createMountains() {
  const geometry = new THREE.PlaneGeometry(300, 40, 300, 40);
  
  const material = new THREE.MeshBasicNodeMaterial({
    transparent: true,
    side: THREE.DoubleSide,
    depthWrite: false
  });

  material.colorNode = Fn(() => {
    const pos = positionLocal;
    const x = pos.x;
    const y = pos.y;
    const t = time.mul(float(0.5));
    
    const peak1 = sin(x.mul(float(0.15)).add(t)).mul(float(4.0));
    const peak2 = sin(x.mul(float(0.25)).add(float(2.0)).add(t.mul(float(0.7)))).mul(float(3.0));
    const peak3 = sin(x.mul(float(0.08)).add(float(5.0))).mul(float(5.0));
    const peak4 = sin(x.mul(float(0.4)).add(t.mul(float(1.2)))).mul(float(2.0));
    
    const mountainHeight = peak1.add(peak2).add(peak3).add(peak4).add(float(15.0));
    const isInMountain = step(y, mountainHeight);
    
    const gradientPos = y.div(float(40.0));
    const color1 = color(0x0a0015);
    const color2 = color(0x1a0030);
    const color3 = color(0x2a0045);
    const mountainColor = mix(color1, color2, gradientPos);
    const mountainColor2 = mix(mountainColor, color3, pow(gradientPos, float(2.0)));
    
    const edgeDist = mountainHeight.sub(y);
    const edgeGlow = smoothstep(float(2.0), float(0.0), edgeDist);
    const glowColor = color(0xff00ff);
    const glowColor2 = color(0xff0088);
    const animatedGlow = mix(glowColor, glowColor2, sin(t.mul(float(2.0))).mul(float(0.5)).add(float(0.5)));
    
    const finalColor = mix(mountainColor2, animatedGlow, edgeGlow.mul(float(0.8)));
    
    return vec4(finalColor, isInMountain);
  })();

  mountainsMesh = new THREE.Mesh(geometry, material);
  mountainsMesh.position.set(0, 0, -60);
  scene.add(mountainsMesh);
}

function createStars() {
  const count = 800;
  const positions = new Float32Array(count * 3);
  const randoms = new Float32Array(count);
  const sizes = new Float32Array(count);
  
  for (let i = 0; i < count; i++) {
    positions[i * 3] = (Math.random() - 0.5) * 300;
    positions[i * 3 + 1] = Math.random() * 50 + 5;
    positions[i * 3 + 2] = -Math.random() * 100 - 30;
    randoms[i] = Math.random();
    sizes[i] = Math.random() * 3 + 1;
  }
  
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('aRandom', new THREE.BufferAttribute(randoms, 1));
  geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
  
  const material = new THREE.PointsNodeMaterial({
    transparent: true,
    depthWrite: false,
    sizeAttenuation: true
  });
  
  const randomAttr = attribute('aRandom');
  const sizeAttr = attribute('aSize');
  
  material.colorNode = Fn(() => {
    const twinkle = sin(time.mul(float(4.0)).add(randomAttr.mul(float(20.0)))).mul(float(0.4)).add(float(0.6));
    const colorMix = randomAttr;
    const starColor1 = color(0xffffff);
    const starColor2 = color(0xaaddff);
    const starColor3 = color(0xffaaff);
    const baseColor = mix(starColor1, starColor2, colorMix);
    const finalColor = mix(baseColor, starColor3, pow(colorMix, float(2.0)));
    return finalColor.mul(twinkle);
  })();
  
  material.sizeNode = Fn(() => {
    const pulse = sin(time.mul(float(3.0)).add(randomAttr.mul(float(10.0)))).mul(float(0.5)).add(float(1.0));
    return sizeAttr.mul(pulse);
  })();
  
  const stars = new THREE.Points(geometry, material);
  scene.add(stars);
}

function createParticles() {
  const count = 300;
  const positions = new Float32Array(count * 3);
  const randoms = new Float32Array(count);
  const speeds = new Float32Array(count);
  
  for (let i = 0; i < count; i++) {
    positions[i * 3] = (Math.random() - 0.5) * 100;
    positions[i * 3 + 1] = Math.random() * 15;
    positions[i * 3 + 2] = -Math.random() * 80 - 10;
    randoms[i] = Math.random();
    speeds[i] = Math.random() * 0.5 + 0.5;
  }
  
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('aRandom', new THREE.BufferAttribute(randoms, 1));
  geometry.setAttribute('aSpeed', new THREE.BufferAttribute(speeds, 1));
  
  const material = new THREE.PointsNodeMaterial({
    transparent: true,
    depthWrite: false,
    sizeAttenuation: true
  });
  
  const randomAttr = attribute('aRandom');
  const speedAttr = attribute('aSpeed');
  
  material.colorNode = Fn(() => {
    const color1 = color(0x00ffff);
    const color2 = color(0xff00ff);
    const color3 = color(0xffff00);
    const mixedColor = mix(color1, color2, randomAttr);
    const finalColor = mix(mixedColor, color3, pow(randomAttr, float(3.0)));
    const pulse = sin(time.mul(float(2.0)).add(randomAttr.mul(float(6.28)))).mul(float(0.3)).add(float(0.7));
    return finalColor.mul(pulse);
  })();
  
  material.sizeNode = Fn(() => {
    const pulse = sin(time.mul(float(3.0)).add(randomAttr.mul(float(10.0)))).mul(float(1.0)).add(float(2.0));
    return pulse;
  })();
  
  material.opacityNode = Fn(() => {
    const pulse = sin(time.mul(float(2.0)).add(randomAttr.mul(float(6.28)))).mul(float(0.3)).add(float(0.7));
    return pulse.mul(float(0.8));
  })();
  
  const particles = new THREE.Points(geometry, material);
  scene.add(particles);
  
  const count2 = 150;
  const positions2 = new Float32Array(count2 * 3);
  const randoms2 = new Float32Array(count2);
  
  for (let i = 0; i < count2; i++) {
    const angle = (i / count2) * Math.PI * 2;
    const radius = 6 + Math.random() * 2;
    positions2[i * 3] = Math.cos(angle) * radius;
    positions2[i * 3 + 1] = 6 + (Math.random() - 0.5) * 2;
    positions2[i * 3 + 2] = -50 + (Math.random() - 0.5) * 2;
    randoms2[i] = Math.random();
  }
  
  const geometry2 = new THREE.BufferGeometry();
  geometry2.setAttribute('position', new THREE.BufferAttribute(positions2, 3));
  geometry2.setAttribute('aRandom', new THREE.BufferAttribute(randoms2, 1));
  
  const material2 = new THREE.PointsNodeMaterial({
    transparent: true,
    depthWrite: false,
    sizeAttenuation: true
  });
  
  const randomAttr2 = attribute('aRandom');
  
  material2.colorNode = Fn(() => {
    const color1 = color(0xff6600);
    const color2 = color(0xffaa00);
    return mix(color1, color2, randomAttr2);
  })();
  
  material2.sizeNode = Fn(() => {
    const pulse = sin(time.mul(float(4.0)).add(randomAttr2.mul(float(10.0)))).mul(float(1.5)).add(float(3.0));
    return pulse;
  })();
  
  material2.opacityNode = Fn(() => {
    const pulse = sin(time.mul(float(3.0)).add(randomAttr2.mul(float(8.0)))).mul(float(0.4)).add(float(0.6));
    return pulse.mul(float(0.7));
  })();
  
  const particles2 = new THREE.Points(geometry2, material2);
  scene.add(particles2);
}

function createScanLines() {
  const geometry = new THREE.PlaneGeometry(400, 200);
  
  const material = new THREE.MeshBasicNodeMaterial({
    transparent: true,
    side: THREE.DoubleSide,
    depthWrite: false
  });

  material.colorNode = Fn(() => {
    const vUv = uv();
    const lineY = fract(vUv.y.mul(float(400.0)));
    const line = step(float(0.5), lineY);
    return vec4(vec3(float(0.0)), float(1.0).sub(line).mul(float(0.03)));
  })();

  const scanLines = new THREE.Mesh(geometry, material);
  scanLines.position.z = 10;
  scene.add(scanLines);
}

function createVignette() {
  const geometry = new THREE.PlaneGeometry(400, 200);
  
  const material = new THREE.MeshBasicNodeMaterial({
    transparent: true,
    side: THREE.DoubleSide,
    depthWrite: false
  });

  material.colorNode = Fn(() => {
    const vUv = uv();
    const center = vec2(0.5, 0.5);
    const dist = length(vUv.sub(center));
    const vignette = smoothstep(float(0.3), float(0.9), dist);
    return vec4(vec3(float(0.0)), vignette.mul(float(0.5)));
  })();

  const vignette = new THREE.Mesh(geometry, material);
  vignette.position.z = 15;
  scene.add(vignette);
}

function onWindowResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

function animate() {
  timer.update();
  const t = timer.getElapsed();
  
  camera.position.x = Math.sin(t * 0.15) * 1.5;
  camera.position.y = 3 + Math.sin(t * 0.2) * 0.3;
  camera.lookAt(0, 2.5, -20);
  
  if (sunMesh) {
    sunMesh.position.y = 6 + Math.sin(t * 0.3) * 0.2;
  }
  
  renderer.render(scene, camera);
}

init().catch((err) => {
  console.error('Failed to initialize:', err);
  document.getElementById('error').style.display = 'block';
});
