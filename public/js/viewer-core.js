import * as THREE from 'https://esm.sh/three@0.160.0';
import { OrbitControls } from 'https://esm.sh/three@0.160.0/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'https://esm.sh/three@0.160.0/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'https://esm.sh/three@0.160.0/examples/jsm/loaders/DRACOLoader.js';
import { MeshoptDecoder } from 'https://esm.sh/three@0.160.0/examples/jsm/libs/meshopt_decoder.module.js';
import { CSS2DRenderer, CSS2DObject } from 'https://esm.sh/three@0.160.0/examples/jsm/renderers/CSS2DRenderer.js';
import { RoomEnvironment } from 'https://esm.sh/three@0.160.0/examples/jsm/environments/RoomEnvironment.js';

export function createViewer(container) {
  // 1. Scene, Camera, Renderer Setup
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x1a1b20);

  const camera = new THREE.PerspectiveCamera(45, container.clientWidth / container.clientHeight, 0.1, 1000);
  camera.position.set(0, 5, 10);

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  container.appendChild(renderer.domElement);

  // 2. CSS2D Renderer สำหรับทำป้ายพิกัด / Annotation
  const labelRenderer = new CSS2DRenderer();
  labelRenderer.setSize(container.clientWidth, container.clientHeight);
  labelRenderer.domElement.style.position = 'absolute';
  labelRenderer.domElement.style.top = '0px';
  labelRenderer.domElement.style.pointerEvents = 'none';
  container.appendChild(labelRenderer.domElement);

  // 3. Controls
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.05;

  // 4. Environment Lighting (แสงสมจริงแบบ Minimal)
  const pmremGenerator = new THREE.PMREMGenerator(renderer);
  scene.environment = pmremGenerator.fromScene(new RoomEnvironment(), 0.04).texture;

  // 5. Loaders Setup (GLTF + Draco + Meshopt)
  const gltfLoader = new GLTFLoader();
  const dracoLoader = new DRACOLoader();
  dracoLoader.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.6/');
  gltfLoader.setDRACOLoader(dracoLoader);
  gltfLoader.setMeshoptDecoder(MeshoptDecoder);

  let currentModel = null;
  const annotations = [];

  // ฟังก์ชันถอดรหัส AES-GCM ฝั่ง Client
  async function decryptStream(encryptedBuffer, keyBase64) {
    const rawKey = Uint8Array.from(atob(keyBase64), c => c.charCodeAt(0));
    const cryptoKey = await crypto.subtle.importKey(
      "raw",
      rawKey,
      { name: "AES-GCM" },
      false,
      ["decrypt"]
    );

    const iv = encryptedBuffer.slice(0, 12);
    const data = encryptedBuffer.slice(12);

    const decrypted = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: iv },
      cryptoKey,
      data
    );

    return decrypted;
  }

  // ฟังก์ชันเพิ่มป้าย Annotation แบบหรูหรา (Luxury 3D Pin)
  function addAnnotation(title, desc, positionArray, onClickCallback) {
    const div = document.createElement('div');
    div.className = 'luxury-pin';
    div.innerHTML = `
      <span>✦</span>
      <div class="pin-tooltip">${title}</div>
    `;

    div.addEventListener('click', () => {
      if (typeof onClickCallback === 'function') onClickCallback();
    });

    const label = new CSS2DObject(div);
    label.position.set(...positionArray);
    // secure-glb-viewer stores annotation positions in the model's local space.
    // Make each label a child of the model so model centering is applied to it too.
    if (!currentModel) throw new Error('ต้องโหลดโมเดลก่อนเพิ่ม Annotation');
    currentModel.add(label);

    annotations.push({ title, desc, position: positionArray, element: div, label });
    return label;
  }

  // ฟังก์ชันเคลียร์ป้ายทั้งหมด
  function clearAnnotations() {
    annotations.forEach(item => {
      item.label?.removeFromParent();
      if (item.label && item.label.element && item.label.element.parentNode) {
        item.label.element.parentNode.removeChild(item.label.element);
      }
    });
    annotations.length = 0;
  }

  // ฟังก์ชันหลักสำหรับโหลดโมเดลผ่าน Token และ Key
  async function load(token, key, onProgress) {
    try {
      const response = await fetch(`/api/stream/${token}`);
      if (!response.ok) throw new Error('ไม่สามารถดึงข้อมูลสตรีมโมเดลได้');

      const arrayBuffer = await response.arrayBuffer();
      const decryptedBuffer = await decryptStream(arrayBuffer, key);

      return new Promise((resolve, reject) => {
        gltfLoader.parse(
          decryptedBuffer,
          '',
          gltf => {
            if (currentModel) scene.remove(currentModel);
            currentModel = gltf.scene;
            scene.add(currentModel);

            // จัดกึ่งกลางโมเดลและปรับกล้องอัตโนมัติ
            const box = new THREE.Box3().setFromObject(currentModel);
            const center = box.getCenter(new THREE.Vector3());
            const size = box.getSize(new THREE.Vector3());

            currentModel.position.sub(center);
            
            const maxDim = Math.max(size.x, size.y, size.z);
            camera.position.set(maxDim * 1.5, maxDim * 1.0, maxDim * 1.5);
            controls.target.set(0, 0, 0);
            controls.update();

            resolve(currentModel);
          },
          error => reject(error)
        );
      });
    } catch (err) {
      console.error('Error loading encrypted model:', err);
      throw err;
    }
  }

  // Animation Loop
  function animate() {
    requestAnimationFrame(animate);
    controls.update();
    renderer.render(scene, camera);
    labelRenderer.render(scene, camera);
  }
  animate();

  // Responsive Resize
  window.addEventListener('resize', () => {
    const width = container.clientWidth;
    const height = container.clientHeight;
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height);
    labelRenderer.setSize(width, height);
  });

  return {
    load,
    addAnnotation,
    clearAnnotations,
    scene,
    camera,
    renderer,
    controls
  };
}
