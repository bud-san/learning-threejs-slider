import gsap from "gsap";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";

export type ThreeImageSlider2Props = {
  images?: string[];
  image1?: string;
  image2?: string;
  displacementImage?: string;
  width?: number;
  height?: number;
  imagesRatio?: number;
  intensity1?: number;
  intensity2?: number;
  angle?: number;
  angle1?: number;
  angle2?: number;
  speedIn?: number;
  speedOut?: number;
  hover?: boolean;
  easing?: string;
  video?: boolean;
  autoPlay?: boolean;
  autoPlayMs?: number;
  className?: string;
};

export function ThreeImageSlider2({
  images,
  image1,
  image2,
  displacementImage,
  width = 960,
  height = 540,
  imagesRatio = 1.0,
  intensity1 = 1,
  intensity2 = 1,
  angle = Math.PI / 4,
  angle1,
  angle2,
  speedIn = 1.6,
  speedOut = 1.2,
  hover = false,
  easing = "expo.out",
  video = false,
  autoPlay = false,
  autoPlayMs = 3000,
  className,
}: ThreeImageSlider2Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.OrthographicCamera | null>(null);
  const meshRef = useRef<THREE.Mesh<
    THREE.PlaneGeometry,
    THREE.ShaderMaterial
  > | null>(null);

  // 複数画像対応の状態管理
  const [currentIndex, setCurrentIndex] = useState(0);
  const [imageAspectRatios, setImageAspectRatios] = useState<number[]>([]);
  const imageList = images || (image1 && image2 ? [image1, image2] : []);
  const displacementImg = displacementImage || imageList[0] || "";

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

  const uniforms = useMemo(() => {
    return {
      intensity1: { value: intensity1 },
      intensity2: { value: intensity2 },
      dispFactor: { value: 0.0 },
      angle1: { value: angle1 ?? angle },
      angle2: { value: angle2 ?? -angle * 3 },
      texture1: { value: null as THREE.Texture | null },
      texture2: { value: null as THREE.Texture | null },
      disp: { value: null as THREE.Texture | null },
      res: { value: new THREE.Vector4(width, height, 1, 1) },
      dpr: {
        value: typeof window !== "undefined" ? window.devicePixelRatio : 1,
      },
      containerAspectRatio: { value: width / height },
      imageAspectRatio1: { value: 1.0 },
      imageAspectRatio2: { value: 1.0 },
      imageScale1: { value: new THREE.Vector2(1.0, 1.0) },
      imageScale2: { value: new THREE.Vector2(1.0, 1.0) },
      imageOffset1: { value: new THREE.Vector2(0.0, 0.0) },
      imageOffset2: { value: new THREE.Vector2(0.0, 0.0) },
    };
  }, [angle, angle1, angle2, height, intensity1, intensity2, width]);

  useEffect(() => {
    if (!containerRef.current || typeof window === "undefined") return;

    const renderer = new THREE.WebGLRenderer({ antialias: false, alpha: true });
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
      1,
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

    const fragmentShader = /* glsl */ `
      varying vec2 vUv;
      uniform float dispFactor;
      uniform sampler2D disp;
      uniform sampler2D texture1;
      uniform sampler2D texture2;
      uniform float angle1;
      uniform float angle2;
      uniform float intensity1;
      uniform float intensity2;
      uniform vec4 res;
      uniform float containerAspectRatio;
      uniform float imageAspectRatio1;
      uniform float imageAspectRatio2;
      uniform vec2 imageScale1;
      uniform vec2 imageScale2;
      uniform vec2 imageOffset1;
      uniform vec2 imageOffset2;

      mat2 getRotM(float angle) {
        float s = sin(angle);
        float c = cos(angle);
        return mat2(c, -s, s, c);
      }

      void main() {
        vec4 dispTex = texture2D(disp, vUv);
        vec2 dispVec = vec2(dispTex.r, dispTex.g);

        // 画像1のUV座標を計算（アスペクト比を保持してフィット）
        vec2 uv1 = (vUv - 0.5) * imageScale1 + 0.5 + imageOffset1;
        vec2 distortedPosition1 = uv1 + getRotM(angle1) * dispVec * intensity1 * dispFactor;

        // 画像2のUV座標を計算（アスペクト比を保持してフィット）
        vec2 uv2 = (vUv - 0.5) * imageScale2 + 0.5 + imageOffset2;
        vec2 distortedPosition2 = uv2 + getRotM(angle2) * dispVec * intensity2 * (1.0 - dispFactor);

        vec4 _texture1 = texture2D(texture1, distortedPosition1);
        vec4 _texture2 = texture2D(texture2, distortedPosition2);
        gl_FragColor = mix(_texture1, _texture2, dispFactor);
      }
    `;

    const material = new THREE.ShaderMaterial({
      uniforms,
      vertexShader,
      fragmentShader,
      transparent: true,
    });

    const mesh = new THREE.Mesh(geometry, material);
    scene.add(mesh);
    meshRef.current = mesh;

    const loader = new THREE.TextureLoader();

    // displacement 画像の読み込み
    if (displacementImg) {
      loader.load(displacementImg, (tx) => {
        tx.magFilter = THREE.LinearFilter;
        tx.minFilter = THREE.LinearFilter;
        uniforms.disp.value = tx;
      });
    }

    // 現在の画像と次の画像を読み込み
    const loadCurrentImages = async () => {
      if (imageList.length === 0) return;

      const currentImg = imageList[currentIndex];
      const nextImg = imageList[(currentIndex + 1) % imageList.length];

      // 画像のアスペクト比を取得
      const [aspectRatio1, aspectRatio2] = await Promise.all([
        getImageAspectRatio(currentImg),
        getImageAspectRatio(nextImg)
      ]);

      // フィットパラメータを計算
      const containerAspectRatio = width / height;
      const fitParams1 = calculateFitParams(aspectRatio1, containerAspectRatio);
      const fitParams2 = calculateFitParams(aspectRatio2, containerAspectRatio);

      // ユニフォームを更新
      uniforms.imageAspectRatio1.value = aspectRatio1;
      uniforms.imageAspectRatio2.value = aspectRatio2;
      uniforms.imageScale1.value.set(fitParams1.scaleX, fitParams1.scaleY);
      uniforms.imageScale2.value.set(fitParams2.scaleX, fitParams2.scaleY);
      uniforms.imageOffset1.value.set(fitParams1.offsetX, fitParams1.offsetY);
      uniforms.imageOffset2.value.set(fitParams2.offsetX, fitParams2.offsetY);

      loader.load(currentImg, (tx1) => {
        tx1.magFilter = THREE.LinearFilter;
        tx1.minFilter = THREE.LinearFilter;
        uniforms.texture1.value = tx1;
      });

      loader.load(nextImg, (tx2) => {
        tx2.magFilter = THREE.LinearFilter;
        tx2.minFilter = THREE.LinearFilter;
        uniforms.texture2.value = tx2;
      });
    };

    loadCurrentImages();

    let raf = 0;
    const renderLoop = () => {
      if (rendererRef.current && sceneRef.current && cameraRef.current) {
        rendererRef.current.render(sceneRef.current, cameraRef.current);
      }
      raf = requestAnimationFrame(renderLoop);
    };
    raf = requestAnimationFrame(renderLoop);

    // 自動再生ロジック（displacement エフェクト付き）
    let autoPlayTimer: NodeJS.Timeout | null = null;
    const startAutoPlay = () => {
      if (autoPlay && imageList.length > 1) {
        autoPlayTimer = setInterval(() => {
          // displacement エフェクトを開始
          gsap.to(uniforms.dispFactor, {
            duration: speedIn,
            value: 1,
            ease: easing,
            onComplete: () => {
              // エフェクト完了後に画像を切り替え
              setCurrentIndex((prev) => (prev + 1) % imageList.length);
            },
          });
        }, autoPlayMs);
      }
    };

    const stopAutoPlay = () => {
      if (autoPlayTimer) {
        clearInterval(autoPlayTimer);
        autoPlayTimer = null;
      }
    };

    startAutoPlay();

    return () => {
      cancelAnimationFrame(raf);
      stopAutoPlay();
      mesh.geometry.dispose();
      material.dispose();
      renderer.dispose();
      containerRef.current?.removeChild(renderer.domElement);
    };
  }, [
    displacementImage,
    easing,
    image1,
    image2,
    speedIn,
    speedOut,
    uniforms,
    width,
    height,
    autoPlay,
    autoPlayMs,
    imageList,
  ]);

  // currentIndex の変更時に画像を再読み込み
  useEffect(() => {
    if (imageList.length === 0) return;
  
    const loadImagesForCurrentIndex = async () => {
      const loader = new THREE.TextureLoader();
      const currentImg = imageList[currentIndex];
      const nextImg = imageList[(currentIndex + 1) % imageList.length];
  
      // 画像のアスペクト比を取得
      const [aspectRatio1, aspectRatio2] = await Promise.all([
        getImageAspectRatio(currentImg),
        getImageAspectRatio(nextImg)
      ]);
  
      // フィットパラメータを計算
      const containerAspectRatio = width / height;
      const fitParams1 = calculateFitParams(aspectRatio1, containerAspectRatio);
      const fitParams2 = calculateFitParams(aspectRatio2, containerAspectRatio);
  
      // ユニフォームを更新
      uniforms.imageAspectRatio1.value = aspectRatio1;
      uniforms.imageAspectRatio2.value = aspectRatio2;
      uniforms.imageScale1.value.set(fitParams1.scaleX, fitParams1.scaleY);
      uniforms.imageScale2.value.set(fitParams2.scaleX, fitParams2.scaleY);
      uniforms.imageOffset1.value.set(fitParams1.offsetX, fitParams1.offsetY);
      uniforms.imageOffset2.value.set(fitParams2.offsetX, fitParams2.offsetY);
  
      // 両方の画像の読み込み完了を待つ
      const loadPromises = [
        new Promise<THREE.Texture>((resolve) => {
          loader.load(currentImg, (tx1) => {
            tx1.magFilter = THREE.LinearFilter;
            tx1.minFilter = THREE.LinearFilter;
            uniforms.texture1.value = tx1;
            resolve(tx1);
          });
        }),
        new Promise<THREE.Texture>((resolve) => {
          loader.load(nextImg, (tx2) => {
            tx2.magFilter = THREE.LinearFilter;
            tx2.minFilter = THREE.LinearFilter;
            uniforms.texture2.value = tx2;
            resolve(tx2);
          });
        })
      ];
  
      // 両方の画像の読み込み完了を待ってからエフェクトをリセット
      Promise.all(loadPromises).then(() => {
        uniforms.dispFactor.value = 0;
      });
    };
  
    loadImagesForCurrentIndex();
  }, [currentIndex, imageList, uniforms, width, height]);

  return (
    <div ref={containerRef} className={className} style={{ width, height }} />
  );
}
