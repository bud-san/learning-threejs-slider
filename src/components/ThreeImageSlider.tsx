import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";

export type ThreeImageSliderProps = {
  images: string[];
  width?: number;
  height?: number;
  autoPlayMs?: number;
  crossfadeMs?: number;
  className?: string;
};

export function ThreeImageSlider({
  images,
  width = 960,
  height = 540,
  autoPlayMs = 4000,
  crossfadeMs = 1000,
  className,
}: ThreeImageSliderProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.OrthographicCamera | null>(null);
  const planeRef = useRef<THREE.Mesh<
    THREE.PlaneGeometry,
    THREE.ShaderMaterial
  > | null>(null);
  const [index, setIndex] = useState(0);
  
  // 画像のアスペクト比を取得する関数
  const getImageAspectRatio = (imageUrl: string): Promise<number> => {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        resolve(img.width / img.height);
      };
      img.onerror = () => {
        resolve(1.0); // エラーの場合は正方形として扱う
      };
      img.src = imageUrl;
    });
  };

  // 画像をコンテナにフィットさせるためのスケールとオフセットを計算
  const calculateFitParams = (imageAspectRatio: number, containerAspectRatio: number) => {
    let scaleX = 1.0;
    let scaleY = 1.0;
    let offsetX = 0.0;
    let offsetY = 0.0;

    if (imageAspectRatio > containerAspectRatio) {
      // 画像が横長の場合、高さに合わせる
      scaleY = 1.0;
      scaleX = containerAspectRatio / imageAspectRatio;
    } else {
      // 画像が縦長の場合、幅に合わせる
      scaleX = 1.0;
      scaleY = imageAspectRatio / containerAspectRatio;
    }

    return { scaleX, scaleY, offsetX, offsetY };
  };

  const uniforms = useMemo(
    () => ({
      uTex1: { value: null as THREE.Texture | null },
      uTex2: { value: null as THREE.Texture | null },
      uProgress: { value: 0 },
      uResolution: { value: new THREE.Vector2(width, height) },
      uTime: { value: 0 },
      uCrossfadeMs: { value: crossfadeMs },
      uContainerAspectRatio: { value: width / height },
      uImageAspectRatio1: { value: 1.0 },
      uImageAspectRatio2: { value: 1.0 },
      uImageScale1: { value: new THREE.Vector2(1.0, 1.0) },
      uImageScale2: { value: new THREE.Vector2(1.0, 1.0) },
      uImageOffset1: { value: new THREE.Vector2(0.0, 0.0) },
      uImageOffset2: { value: new THREE.Vector2(0.0, 0.0) },
    }),
    [width, height, crossfadeMs],
  );

  useEffect(() => {
    if (!containerRef.current) return;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    containerRef.current.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    const scene = new THREE.Scene();
    sceneRef.current = scene;

    const camera = new THREE.OrthographicCamera(
      -width / 2,
      width / 2,
      height / 2,
      -height / 2,
      -1000,
      1000,
    );
    camera.position.z = 1;
    cameraRef.current = camera;

    const geometry = new THREE.PlaneGeometry(width, height, 1, 1);

    const vertexShader = /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `;

    // シンプルなクロスフェード
    const fragmentShader = /* glsl */ `
      precision highp float;
      varying vec2 vUv;
      uniform sampler2D uTex1;
      uniform sampler2D uTex2;
      uniform float uProgress;
      uniform float uContainerAspectRatio;
      uniform float uImageAspectRatio1;
      uniform float uImageAspectRatio2;
      uniform vec2 uImageScale1;
      uniform vec2 uImageScale2;
      uniform vec2 uImageOffset1;
      uniform vec2 uImageOffset2;

      void main() {
        // 画像1のUV座標を計算（アスペクト比を保持してフィット）
        vec2 uv1 = (vUv - 0.5) * uImageScale1 + 0.5 + uImageOffset1;
        
        // 画像2のUV座標を計算（アスペクト比を保持してフィット）
        vec2 uv2 = (vUv - 0.5) * uImageScale2 + 0.5 + uImageOffset2;
        
        vec4 c1 = texture2D(uTex1, uv1);
        vec4 c2 = texture2D(uTex2, uv2);
        gl_FragColor = mix(c1, c2, smoothstep(0.0, 1.0, uProgress));
      }
    `;

    const material = new THREE.ShaderMaterial({
      uniforms,
      vertexShader,
      fragmentShader,
    });

    const plane = new THREE.Mesh(geometry, material);
    scene.add(plane);
    planeRef.current = plane;

    let raf = 0;
    let start = performance.now();

    const tick = () => {
      uniforms.uTime.value = (performance.now() - start) / 1000;
      renderer.render(scene, camera);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    const onResize = () => {
      const w = width;
      const h = height;
      renderer.setSize(w, h);
      camera.left = -w / 2;
      camera.right = w / 2;
      camera.top = h / 2;
      camera.bottom = -h / 2;
      camera.updateProjectionMatrix();
      uniforms.uResolution.value.set(w, h);
      uniforms.uContainerAspectRatio.value = w / h;
    };
    window.addEventListener("resize", onResize);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
      plane.geometry.dispose();
      material.dispose();
      renderer.dispose();
      containerRef.current?.removeChild(renderer.domElement);
    };
  }, [height, uniforms, width]);

  // テクスチャのプリロード
  useEffect(() => {
    const loadCurrentImages = async () => {
      const loader = new THREE.TextureLoader();
      const nextIndex = (index + 1) % images.length;
      
      // 画像のアスペクト比を取得
      const [aspectRatio1, aspectRatio2] = await Promise.all([
        getImageAspectRatio(images[index]),
        getImageAspectRatio(images[nextIndex])
      ]);

      // フィットパラメータを計算
      const containerAspectRatio = width / height;
      const fitParams1 = calculateFitParams(aspectRatio1, containerAspectRatio);
      const fitParams2 = calculateFitParams(aspectRatio2, containerAspectRatio);

      // ユニフォームを更新
      uniforms.uImageAspectRatio1.value = aspectRatio1;
      uniforms.uImageAspectRatio2.value = aspectRatio2;
      uniforms.uImageScale1.value.set(fitParams1.scaleX, fitParams1.scaleY);
      uniforms.uImageScale2.value.set(fitParams2.scaleX, fitParams2.scaleY);
      uniforms.uImageOffset1.value.set(fitParams1.offsetX, fitParams1.offsetY);
      uniforms.uImageOffset2.value.set(fitParams2.offsetX, fitParams2.offsetY);

      loader.load(images[index], (tx1) => {
        uniforms.uTex1.value = tx1;
        loader.load(images[nextIndex], (tx2) => {
          uniforms.uTex2.value = tx2;
        });
      });
    };

    loadCurrentImages();
  }, [images, index, uniforms, width, height]);

  // 自動再生と進捗アニメーション
  useEffect(() => {
    let raf = 0;
    let start = 0;
    let isTransitioning = false;

    const step = (t: number) => {
      if (!start) start = t;
      const elapsed = t - start;
      
      if (!isTransitioning) {
        // 通常の表示時間
        if (elapsed >= autoPlayMs - crossfadeMs) {
          isTransitioning = true;
          start = t;
        }
      } else {
        // クロスフェード時間
        const progress = Math.min(elapsed / crossfadeMs, 1);
        uniforms.uProgress.value = progress;
        
        if (elapsed >= crossfadeMs) {
          start = t;
          uniforms.uProgress.value = 0;
          setIndex((i) => (i + 1) % images.length);
          isTransitioning = false;
        }
      }
      
      raf = requestAnimationFrame(step);
    };

    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [autoPlayMs, crossfadeMs, images.length, uniforms]);

  return (
    <div
      ref={containerRef}
      className={className}
      style={{ width: `${width}px`, height: `${height}px` }}
    />
  );
}
