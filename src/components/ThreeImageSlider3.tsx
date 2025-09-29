import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";

export type ThreeImageSlider3Props = {
  images: string[];
  width?: number;
  height?: number;
  autoPlayMs?: number;
  crossfadeMs?: number;
  noiseScale?: number;
  noiseIntensity?: number;
  className?: string;
};

export function ThreeImageSlider3({
  images,
  width = 960,
  height = 540,
  autoPlayMs = 4000,
  crossfadeMs = 1000,
  noiseScale = 3,
  noiseIntensity = 0.1,
  className,
}: ThreeImageSlider3Props) {
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
      uNoiseScale: { value: noiseScale },
      uNoiseIntensity: { value: noiseIntensity },
      uContainerAspectRatio: { value: width / height },
      uImageAspectRatio1: { value: 1.0 },
      uImageAspectRatio2: { value: 1.0 },
      uImageScale1: { value: new THREE.Vector2(1.0, 1.0) },
      uImageScale2: { value: new THREE.Vector2(1.0, 1.0) },
      uImageOffset1: { value: new THREE.Vector2(0.0, 0.0) },
      uImageOffset2: { value: new THREE.Vector2(0.0, 0.0) },
    }),
    [width, height, noiseScale, noiseIntensity],
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

    // パーリンノイズ + クロスフェード（アスペクト比対応）
    const fragmentShader = /* glsl */ `
      precision highp float;
      varying vec2 vUv;
      uniform sampler2D uTex1;
      uniform sampler2D uTex2;
      uniform float uProgress;
      uniform vec2 uResolution;
      uniform float uTime;
      uniform float uNoiseScale;
      uniform float uNoiseIntensity;
      uniform float uContainerAspectRatio;
      uniform float uImageAspectRatio1;
      uniform float uImageAspectRatio2;
      uniform vec2 uImageScale1;
      uniform vec2 uImageScale2;
      uniform vec2 uImageOffset1;
      uniform vec2 uImageOffset2;

      // パーリンノイズ関数
      vec3 mod289(vec3 x) {
        return x - floor(x * (1.0 / 289.0)) * 289.0;
      }

      vec2 mod289(vec2 x) {
        return x - floor(x * (1.0 / 289.0)) * 289.0;
      }

      vec3 permute(vec3 x) {
        return mod289(((x*34.0)+1.0)*x);
      }

      float snoise(vec2 v) {
        const vec4 C = vec4(0.211324865405187, 0.366025403784439, -0.577350269189626, 0.024390243902439);
        vec2 i  = floor(v + dot(v, C.yy) );
        vec2 x0 = v -   i + dot(i, C.xx);
        vec2 i1;
        i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
        vec4 x12 = x0.xyxy + C.xxzz;
        x12.xy -= i1;
        i = mod289(i);
        vec3 p = permute( permute( i.y + vec3(0.0, i1.y, 1.0 )) + i.x + vec3(0.0, i1.x, 1.0 ));
        vec3 m = max(0.5 - vec3(dot(x0,x0), dot(x12.xy,x12.xy), dot(x12.zw,x12.zw)), 0.0);
        m = m*m ;
        m = m*m ;
        vec3 x = 2.0 * fract(p * C.www) - 1.0;
        vec3 h = abs(x) - 0.5;
        vec3 ox = floor(x + 0.5);
        vec3 a0 = x - ox;
        m *= 1.79284291400159 - 0.85373472095314 * ( a0*a0 + h*h );
        vec3 g;
        g.x  = a0.x  * x0.x  + h.x  * x0.y;
        g.yz = a0.yz * x12.xz + h.yz * x12.yw;
        return 130.0 * dot(m, g);
      }

      // フラクタルノイズ
      float fbm(vec2 p) {
        float value = 0.0;
        float amplitude = 0.5;
        float frequency = 1.0;
        
        for(int i = 0; i < 4; i++) {
          value += amplitude * snoise(p * frequency);
          amplitude *= 0.5;
          frequency *= 2.0;
        }
        
        return value;
      }
      
      
      // おためしイージング
      // Sine
      float easeInOutSine(float t) {
          return -0.5 * (cos(3.14159 * t) - 1.0);
      }

      // Quadratic
      float easeInOutQuad(float t) {
          return t < 0.5
              ? 2.0 * t * t
              : 1.0 - pow(-2.0 * t + 2.0, 2.0) / 2.0;
      }

      // Cubic
      float easeInOutCubic(float t) {
          return t < 0.5
              ? 4.0 * t * t * t
              : 1.0 - pow(-2.0 * t + 2.0, 3.0) / 2.0;
      }

      // Quartic
      float easeInOutQuart(float t) {
          return t < 0.5
              ? 8.0 * t * t * t * t
              : 1.0 - pow(-2.0 * t + 2.0, 4.0) / 2.0;
      }

      // Quintic
      float easeInOutQuint(float t) {
          return t < 0.5
              ? 16.0 * t * t * t * t * t
              : 1.0 - pow(-2.0 * t + 2.0, 5.0) / 2.0;
      }

      // Exponential
      float easeInOutExpo(float t) {
          if (t == 0.0) return 0.0;
          if (t == 1.0) return 1.0;
          return t < 0.5
              ? pow(2.0, 20.0 * t - 10.0) / 2.0
              : (2.0 - pow(2.0, -20.0 * t + 10.0)) / 2.0;
      }


      void main() {
        vec2 uv = vUv;
        
        // パーリンノイズを生成
        vec2 noiseCoord = uv * uNoiseScale + uTime * 0.1;
        float noise = fbm(noiseCoord);
        
        // ノイズベースの displacement（0→1→0の形で変化）        
        
        float maxStrength = 0.4; // ゆらぎの振幅最大値
        float displacementStrength = sin(uProgress * 3.14159);
        displacementStrength = easeInOutSine(displacementStrength) * maxStrength;
        vec2 displacement = vec2(noise) * uNoiseIntensity * displacementStrength;
        
        // 画像1のUV座標を計算（アスペクト比を保持してフィット）
        vec2 uv1 = (uv - 0.5) * uImageScale1 + 0.5 + uImageOffset1;
        vec2 distortedUV1 = uv1 + displacement;
        
        // 画像2のUV座標を計算（アスペクト比を保持してフィット）
        vec2 uv2 = (uv - 0.5) * uImageScale2 + 0.5 + uImageOffset2;
        vec2 distortedUV2 = uv2 + displacement;
        
        // クロスフェード
        vec4 c1 = texture2D(uTex1, distortedUV1);
        vec4 c2 = texture2D(uTex2, distortedUV2);
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

  // テクスチャのプリロードとアスペクト比の計算
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
      
      if (!isTransitioning && elapsed >= autoPlayMs - crossfadeMs) {
        // クロスフェード開始
        isTransitioning = true;
        const transitionStart = t;
        
        const transitionStep = (transitionTime: number) => {
          const transitionElapsed = transitionTime - transitionStart;
          const progress = Math.min(transitionElapsed / crossfadeMs, 1);
          uniforms.uProgress.value = progress;
          
          if (progress >= 1) {
            // クロスフェード完了
            uniforms.uProgress.value = 0;
            setIndex((i) => (i + 1) % images.length);
            isTransitioning = false;
            start = transitionTime;
            // 次のサイクルを開始
            raf = requestAnimationFrame(step);
          } else {
            raf = requestAnimationFrame(transitionStep);
          }
        };
        
        raf = requestAnimationFrame(transitionStep);
      } else if (!isTransitioning) {
        // 通常の待機時間
        uniforms.uProgress.value = 0;
        raf = requestAnimationFrame(step);
      }
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
