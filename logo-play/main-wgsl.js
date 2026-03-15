import * as THREE from 'three/webgpu';
import {
  wgslFn,
  uniform,
  vec2,
  vec3,
  float,
  time,
  uv,
  normalWorld,
  positionWorld,
  cameraPosition,
  attribute
} from 'three/tsl';

let camera, scene, renderer;
let playButton, glowRing, particles, volumetricGlow;
let mouseX = 0, mouseY = 0;
let timer;

const uniforms = {
  uTime: uniform(0),
  uHover: uniform(0),
  uMouse: uniform(vec2(0, 0))
};

async function init() {
  if (!navigator.gpu) {
    document.getElementById('error').style.display = 'block';
    return;
  }

  timer = new THREE.Timer();
  scene = new THREE.Scene();

  camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 100);
  camera.position.z = 5;

  renderer = new THREE.WebGPURenderer({ antialias: true, alpha: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  document.body.appendChild(renderer.domElement);
  await renderer.init();

  createPlayButton();
  createGlowRing();
  createVolumetricGlow();
  createParticles();

  window.addEventListener('resize', onWindowResize);
  window.addEventListener('mousemove', onMouseMove);
  window.addEventListener('click', onClick);

  renderer.setAnimationLoop(animate);
}

function createPlayButton() {
  const size = 1.2;
  const shape = new THREE.Shape();
  shape.moveTo(-size * 0.4, -size * 0.5);
  shape.lineTo(-size * 0.4, size * 0.5);
  shape.lineTo(size * 0.5, 0);
  shape.closePath();

  const geometry = new THREE.ShapeGeometry(shape, 32);

  const material = new THREE.MeshStandardNodeMaterial({
    side: THREE.DoubleSide
  });

  material.colorNode = wgslFn(`
    fn playColor(uvCoord: vec2f, t: f32, hover: f32) -> vec3f {
      let baseColor = vec3f(0.0, 0.83, 1.0);
      let hoverColor = vec3f(0.0, 1.0, 0.67);
      let pulse = sin(t * 2.0) * 0.15 + 0.85;
      return mix(baseColor, hoverColor, hover) * pulse;
    }
  `)(uv(), uniforms.uTime, uniforms.uHover);

  material.emissiveNode = wgslFn(`
    fn playEmissive(
      n: vec3f, 
      worldPos: vec3f, 
      camPos: vec3f, 
      t: f32, 
      hover: f32
    ) -> vec3f {
      let viewDir = normalize(camPos - worldPos);
      let nDotV = dot(n, viewDir);
      let fresnel = pow(1.0 - abs(nDotV), 3.0);
      
      let baseGlow = vec3f(0.0, 0.83, 1.0);
      let edgeGlow = vec3f(0.53, 0.33, 1.0);
      let pulse = sin(t * 3.0) * 0.3 + 0.5;
      
      return mix(baseGlow, edgeGlow, fresnel) * pulse * (1.0 + hover);
    }
  `)(
    normalWorld,
    positionWorld,
    cameraPosition,
    uniforms.uTime,
    uniforms.uHover
  );

  material.roughnessNode = float(0.2);
  material.metalnessNode = float(0.8);

  playButton = new THREE.Mesh(geometry, material);
  playButton.position.z = 0.1;
  scene.add(playButton);
}

function createGlowRing() {
  const geometry = new THREE.TorusGeometry(1.1, 0.03, 16, 64);

  const material = new THREE.MeshBasicNodeMaterial({
    transparent: true,
    side: THREE.DoubleSide
  });

  material.colorNode = wgslFn(`
    fn ringColor(uvCoord: vec2f, t: f32) -> vec3f {
      let angle = t * 0.5;
      let wave = sin(uvCoord.x * 6.28318 + angle) * 0.5 + 0.5;
      let baseColor = vec3f(0.0, 0.83, 1.0);
      let accentColor = vec3f(1.0, 0.27, 0.53);
      return mix(baseColor, accentColor, wave);
    }
  `)(uv(), uniforms.uTime);

  material.opacityNode = wgslFn(`
    fn ringOpacity(uvCoord: vec2f, t: f32) -> f32 {
      let wave = sin(uvCoord.x * 12.56636 - t * 2.0) * 0.3 + 0.7;
      return wave * 0.8;
    }
  `)(uv(), uniforms.uTime);

  glowRing = new THREE.Mesh(geometry, material);
  scene.add(glowRing);
}

function createVolumetricGlow() {
  const geometry = new THREE.PlaneGeometry(6, 6, 1, 1);

  const material = new THREE.MeshBasicNodeMaterial({
    transparent: true,
    side: THREE.DoubleSide,
    depthWrite: false
  });

  material.colorNode = wgslFn(`
    fn volumetricColor(uvCoord: vec2f, t: f32) -> vec3f {
      let center = vec2f(0.5, 0.5);
      let uvCenter = uvCoord - center;
      let dist = length(uvCenter);
      
      let color1 = vec3f(0.0, 0.83, 1.0);
      let color2 = vec3f(0.4, 0.13, 1.0);
      let color3 = vec3f(1.0, 0.13, 0.4);
      
      let wave = sin(dist * 8.0 - t * 0.3) * 0.5 + 0.5;
      let mixed = mix(color1, color2, wave);
      return mix(mixed, color3, wave * wave);
    }
  `)(uv(), uniforms.uTime);

  material.opacityNode = wgslFn(`
    fn volumetricOpacity(uvCoord: vec2f, t: f32) -> f32 {
      let center = vec2f(0.5, 0.5);
      let uvCenter = uvCoord - center;
      let dist = length(uvCenter);
      
      let falloff = smoothstep(0.5, 0.0, dist);
      let pulse = sin(t * 1.5) * 0.15 + 0.85;
      
      return falloff * pulse * 0.4;
    }
  `)(uv(), uniforms.uTime);

  volumetricGlow = new THREE.Mesh(geometry, material);
  volumetricGlow.position.z = -0.5;
  scene.add(volumetricGlow);
}

function createParticles() {
  const count = 150;
  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array(count * 3);
  const randoms = new Float32Array(count);

  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2;
    const radius = 1.5 + Math.random() * 1.5;
    positions[i * 3] = Math.cos(angle) * radius;
    positions[i * 3 + 1] = Math.sin(angle) * radius;
    positions[i * 3 + 2] = (Math.random() - 0.5) * 0.5;
    randoms[i] = Math.random();
  }

  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('aRandom', new THREE.BufferAttribute(randoms, 1));

  const material = new THREE.PointsNodeMaterial({
    transparent: true,
    depthWrite: false
  });

  const randomAttr = attribute('aRandom', 'float');

  material.colorNode = wgslFn(`
    fn particleColor(rand: f32) -> vec3f {
      let baseColor = vec3f(0.0, 0.83, 1.0);
      let accentColor = vec3f(1.0, 0.4, 0.67);
      return mix(baseColor, accentColor, rand);
    }
  `)(randomAttr);

  material.opacityNode = wgslFn(`
    fn particleOpacity(rand: f32, t: f32) -> f32 {
      let pulse = sin(t * 2.0 + rand * 3.14159) * 0.5 + 0.5;
      return pulse * 0.8;
    }
  `)(randomAttr, uniforms.uTime);

  material.sizeNode = wgslFn(`
    fn particleSize(rand: f32, t: f32) -> f32 {
      let pulse = sin(t * 1.5 + rand * 6.28318);
      return 3.0 + pulse * 2.0;
    }
  `)(randomAttr, uniforms.uTime);

  particles = new THREE.Points(geometry, material);
  scene.add(particles);
}

function onWindowResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

function onMouseMove(event) {
  mouseX = (event.clientX / window.innerWidth) * 2 - 1;
  mouseY = -(event.clientY / window.innerHeight) * 2 + 1;

  const targetHover = (Math.abs(mouseX) < 0.3 && Math.abs(mouseY) < 0.3) ? 1.0 : 0.0;
  uniforms.uHover.value += (targetHover - uniforms.uHover.value) * 0.1;
}

function onClick() {
  if (uniforms.uHover.value > 0.5) {
    console.log('Play clicked!');
  }
}

function animate() {
  timer.update();
  uniforms.uTime.value = timer.getElapsed();

  if (playButton) {
    playButton.rotation.y = Math.sin(timer.getElapsed() * 0.5) * 0.1;
    playButton.position.y = Math.sin(timer.getElapsed() * 1.2) * 0.05;
  }

  if (glowRing) {
    glowRing.rotation.z = timer.getElapsed() * 0.3;
    glowRing.scale.setScalar(1.0 + Math.sin(timer.getElapsed() * 2.0) * 0.02);
  }

  if (particles) {
    particles.rotation.z = timer.getElapsed() * 0.1;
  }

  camera.position.x += (mouseX * 0.3 - camera.position.x) * 0.05;
  camera.position.y += (mouseY * 0.2 - camera.position.y) * 0.05;
  camera.lookAt(0, 0, 0);

  renderer.render(scene, camera);
}

init().catch((err) => {
  console.error('Failed to initialize:', err);
  document.getElementById('error').style.display = 'block';
});
