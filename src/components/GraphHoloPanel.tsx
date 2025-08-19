// src/components/GraphHoloPanel.tsx
import React, { useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { Html } from "@react-three/drei";
import type { ThreeEvent, ThreeElements } from "@react-three/fiber";

// ⬅️ R3F types fix: define GroupProps from ThreeElements
type GroupProps = ThreeElements["group"];

/**
 * A draggable "hologram" panel that lives in 3D space.
 * We render regular DOM (your SimpleGraph) into it via <Html transform />.
 */
type Props = {
  title?: string;
  /** world position (xz plane) */
  position: [number, number, number];
  /** setter used by parent to store new position when dragging */
  setPosition: (p: [number, number, number]) => void;

  /** Euler rotation in world radians (default: a slight tilt) */
  rotation?: [number, number, number];

  /** plane size in world units */
  width?: number;
  height?: number;

  /** enable dragging (admin only) */
  draggable?: boolean;

  /** your <SimpleGraph> etc */
  children: React.ReactNode;
} & Omit<GroupProps, "position" | "rotation">;

export default function GraphHoloPanel({
  title,
  position,
  setPosition,
  rotation = [-Math.PI / 2 + 0.35, 0, 0],
  width = 3.4,
  height = 2.0,
  draggable = false,
  children,
  ...rest
}: Props) {
  const groupRef = useRef<THREE.Group>(null);
  const dragOffset = useRef(new THREE.Vector3());
  const dragY = useRef(position[1]);
  const [dragging, setDragging] = useState(false);

  // A plane parallel to the ground we use for ray–plane intersection while dragging
  const plane = useMemo(() => new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), []);

  const panelBaseColor = "#0b0f12";

  function onDown(e: ThreeEvent<PointerEvent>) {
    if (!draggable) return;
    e.stopPropagation();
    setDragging(true);

    // lock the plane at current Y level
    dragY.current = groupRef.current?.position.y ?? position[1];
    plane.constant = -dragY.current;

    const hit = e.ray.intersectPlane(plane, new THREE.Vector3());
    const current = new THREE.Vector3(...position);
    dragOffset.current.copy(hit ? current.sub(hit) : new THREE.Vector3());
  }

  function onMove(e: ThreeEvent<PointerEvent>) {
    if (!dragging || !draggable) return;
    const hit = e.ray.intersectPlane(plane, new THREE.Vector3());
    if (!hit) return;
    hit.add(dragOffset.current);
    setPosition([hit.x, dragY.current, hit.z]);
  }

  function onUp() {
    if (!draggable) return;
    setDragging(false);
  }

  return (
    <group
      ref={groupRef}
      position={position}
      rotation={rotation}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      {...rest}
    >
      {/* Faint glassy plane */}
      <mesh>
        <planeGeometry args={[width, height]} />
        <meshBasicMaterial transparent opacity={0.18} color={panelBaseColor} />
      </mesh>

      {/* Border frame */}
      <mesh>
        <planeGeometry args={[width, height]} />
        <meshBasicMaterial transparent color={"rgba(208,210,224,0.18)"} wireframe />
      </mesh>

      {/* Lift DOM graph a hair above the plane to avoid z-fighting */}
      <group position={[0, 0.001, 0]}>
        <Html
          transform
          scale={(1 / 350) * width * 2.2}
          occlude={false}
          pointerEvents="auto"
          style={{ userSelect: "none" }}
        >
          <div
            style={{
              width: 680,
              height: 360,
              background: "rgba(12,16,22,0.72)",
              border: "1px solid rgba(255,255,255,0.12)",
              boxShadow:
                "0 6px 22px rgba(0,0,0,0.55), inset 0 0 0 1px rgba(255,255,255,0.05)",
              borderRadius: 12,
              backdropFilter: "blur(6px)",
              padding: 12,
            }}
          >
            {title && (
              <div
                style={{
                  fontSize: 14,
                  letterSpacing: "0.02em",
                  color: "#cfd6e2",
                  marginBottom: 6,
                }}
              >
                {title}
              </div>
            )}
            {children}
          </div>
        </Html>
      </group>
    </group>
  );
}
