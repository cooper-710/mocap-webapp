import { useEffect, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { useFBX } from "@react-three/drei";
import * as THREE from "three";

export default function FBXModel({
  url,
  scale = 0.01,
  position = [0, 0, 0] as [number, number, number],
  rotation = [0, 0, 0] as [number, number, number],
  time = 0,                          // absolute time (seconds)
  onReadyDuration,
}: {
  url: string | null;
  scale?: number;
  position?: [number, number, number];
  rotation?: [number, number, number];
  time?: number;
  onReadyDuration?: (duration: number) => void;
}) {
  const fbx = url ? useFBX(url) : null;

  const mixerRef = useRef<THREE.AnimationMixer | null>(null);
  const actionRef = useRef<THREE.AnimationAction | null>(null);
  const durationRef = useRef<number>(0);

  useEffect(() => {
    if (!fbx) return;

    // Ensure meshes are visible and have reasonable materials
    fbx.traverse((obj: any) => {
      if (obj.isMesh) {
        obj.castShadow = true;
        obj.receiveShadow = true;

        // If the imported material is unlit/black, use a neutral PBR fallback
        const m = obj.material as THREE.Material | undefined;
        const needsFallback =
          !m ||
          // @ts-ignore
          (m.color && (m as any).color.equals?.(new THREE.Color(0x000000)));

        if (needsFallback) {
          obj.material = new THREE.MeshStandardMaterial({
            color: new THREE.Color("#c8ccd4"),
            roughness: 0.9,
            metalness: 0.05,
          });
        }
      }
    });

    fbx.scale.setScalar(scale);
    fbx.position.set(position[0], position[1], position[2]);
    fbx.rotation.set(rotation[0], rotation[1], rotation[2]);

    if (fbx.animations && fbx.animations.length > 0) {
      const clip = fbx.animations[0];
      durationRef.current = clip.duration;

      const mixer = new THREE.AnimationMixer(fbx);
      const action = mixer.clipAction(clip);
      action.enabled = true;
      action.setLoop(THREE.LoopRepeat, Infinity);
      action.setEffectiveWeight(1);
      action.play();

      mixerRef.current = mixer;
      actionRef.current = action;

      onReadyDuration?.(clip.duration);
    } else {
      mixerRef.current = null;
      actionRef.current = null;
      durationRef.current = 0;
      onReadyDuration?.(0);
    }

    return () => {
      actionRef.current?.stop();
      mixerRef.current?.stopAllAction();
      if (fbx) mixerRef.current?.uncacheRoot(fbx as THREE.Object3D);
      actionRef.current = null;
      mixerRef.current = null;
      durationRef.current = 0;
    };
  }, [fbx, scale, position, rotation, onReadyDuration]);

  // Drive to exact time (scrub/play controlled by parent)
  useFrame(() => {
    const mixer = mixerRef.current;
    const action = actionRef.current;
    const dur = durationRef.current;
    if (!mixer || !action) return;

    const t = dur > 0 ? (time % dur + dur) % dur : 0;
    mixer.setTime(t);
  });

  if (!fbx) return null;
  return <primitive object={fbx} />;
}
