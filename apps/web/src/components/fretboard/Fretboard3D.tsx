"use client";

import { fretFraction, fretSlotFraction, type Fretboard as FretboardModel } from "@fretlight/core";
import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { TONE_STYLES } from "@/lib/ui/tone";
import type { FretMarker } from "./Fretboard";

export interface Fretboard3DProps {
  readonly board: FretboardModel;
  readonly markers: readonly FretMarker[];
  readonly lowStringOnTop?: boolean;
  readonly onSelect?: (position: { string: number; fret: number; midi: number }) => void;
  readonly className?: string;
}

/** World units per fret-length along the neck — arbitrary, just a scale. */
const NECK_LENGTH = 10;
const STRING_SPACING = 0.5;
const MARKER_RADIUS = 0.14;

/** "rgba(r, g, b, a)" -> a THREE.Color plus its own alpha, since Color drops it. */
function parseRgba(css: string): { color: THREE.Color; opacity: number } {
  const match = css.match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+))?\)/);
  if (!match) return { color: new THREE.Color("white"), opacity: 1 };
  const [, r, g, b, a] = match;
  return {
    color: new THREE.Color(Number(r) / 255, Number(g) / 255, Number(b) / 255),
    opacity: a === undefined ? 1 : Number(a),
  };
}

/**
 * A real, rotatable 3D neck — not a static illustration. Fret and marker
 * positions come from the same `fretFraction`/`fretSlotFraction` math the
 * camera overlay projects onto a real neck with (see `vision/homography.ts`),
 * so this agrees with the 2D fretboard and the live camera view on where
 * every fret actually falls, rather than a hand-tuned second layout.
 *
 * Three.js only — no physical holography. Orbit, pan and zoom with the mouse
 * or touch (`OrbitControls`, shipped inside the `three` package itself, not
 * an extra dependency).
 */
export function Fretboard3D({ board, markers, lowStringOnTop = false, onSelect, className }: Fretboard3DProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const markersRef = useRef(markers);
  markersRef.current = markers;
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const scene = new THREE.Scene();
    scene.background = null;

    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
    camera.position.set(NECK_LENGTH * 0.35, 4.5, 6);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    container.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(NECK_LENGTH / 2, 0, 0);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.minDistance = 3;
    controls.maxDistance = 20;
    // The neck is a thin slab lit from above: swinging the camera under it
    // shows an unlit, featureless underside, which reads as broken rather
    // than as "the back of the guitar". Nobody looks at a fretboard from
    // directly below anyway, so the orbit stays in the range that's actually
    // useful — generous enough to see it edge-on or from above, never upside
    // down.
    controls.minPolarAngle = Math.PI * 0.12;
    controls.maxPolarAngle = Math.PI * 0.62;
    controls.update();

    scene.add(new THREE.AmbientLight(0xffffff, 0.55));
    const key = new THREE.DirectionalLight(0xffffff, 0.9);
    key.position.set(4, 8, 6);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0x66e0ff, 0.35);
    rim.position.set(-4, 2, -6);
    scene.add(rim);
    // Fill from underneath — the orbit range still allows dipping below the
    // neck's plane, and that face would otherwise read as pure black.
    const fill = new THREE.DirectionalLight(0x8899bb, 0.25);
    fill.position.set(2, -6, 4);
    scene.add(fill);

    const stringCount = board.stringCount;
    const width = (stringCount - 1) * STRING_SPACING;
    const stringZ = (index: number) => {
      const visual = lowStringOnTop ? index : stringCount - 1 - index;
      return visual * STRING_SPACING - width / 2;
    };

    // The neck itself.
    const neckGeometry = new THREE.BoxGeometry(NECK_LENGTH, 0.22, width + STRING_SPACING);
    const neckMaterial = new THREE.MeshStandardMaterial({ color: 0x1a1410, roughness: 0.75, metalness: 0.1 });
    const neck = new THREE.Mesh(neckGeometry, neckMaterial);
    neck.position.set(NECK_LENGTH / 2, -0.15, 0);
    scene.add(neck);

    // Fret wires.
    const fretMaterial = new THREE.MeshStandardMaterial({ color: 0xc7cfd6, roughness: 0.35, metalness: 0.7 });
    for (let fret = 0; fret <= board.fretCount; fret++) {
      const x = fretFraction(fret, board.fretCount) * NECK_LENGTH;
      const wireGeometry = new THREE.BoxGeometry(fret === 0 ? 0.09 : 0.035, 0.05, width + STRING_SPACING);
      const wire = new THREE.Mesh(wireGeometry, fret === 0 ? neckMaterial.clone() : fretMaterial);
      if (fret === 0) (wire.material as THREE.MeshStandardMaterial).color.set(0xe8e4da);
      wire.position.set(x, -0.03, 0);
      scene.add(wire);
    }

    // Strings.
    const stringMaterial = new THREE.MeshStandardMaterial({ color: 0xb8bec9, roughness: 0.3, metalness: 0.85 });
    for (let s = 0; s < stringCount; s++) {
      const thickness = 0.012 + (s / Math.max(1, stringCount - 1)) * 0.02;
      const geometry = new THREE.CylinderGeometry(thickness, thickness, NECK_LENGTH, 8);
      const mesh = new THREE.Mesh(geometry, stringMaterial);
      mesh.rotation.z = Math.PI / 2;
      mesh.position.set(NECK_LENGTH / 2, 0.02, stringZ(s));
      scene.add(mesh);
    }

    // Markers live in their own group so they can be rebuilt independently of
    // the neck whenever the `markers` prop changes.
    const markerGroup = new THREE.Group();
    scene.add(markerGroup);
    const markerMeshes: { mesh: THREE.Mesh; marker: FretMarker }[] = [];

    const rebuildMarkers = () => {
      for (const { mesh } of markerMeshes) {
        markerGroup.remove(mesh);
        mesh.geometry.dispose();
        (mesh.material as THREE.Material).dispose();
      }
      markerMeshes.length = 0;

      for (const marker of markersRef.current) {
        if (marker.string >= stringCount || marker.fret > board.fretCount) continue;
        const style = TONE_STYLES[marker.tone];
        const { color, opacity } = parseRgba(style.fill);
        const radius = MARKER_RADIUS * (marker.emphasis ? 1.5 : 1);
        const geometry = new THREE.SphereGeometry(radius, 20, 16);
        const material = new THREE.MeshStandardMaterial({
          color,
          transparent: opacity < 1,
          opacity,
          emissive: style.glow ? color : 0x000000,
          emissiveIntensity: style.glow ? (marker.emphasis ? 0.9 : 0.4) : 0,
          roughness: 0.4,
          metalness: 0.1,
        });
        const mesh = new THREE.Mesh(geometry, material);
        const x = fretSlotFraction(marker.fret, board.fretCount) * NECK_LENGTH;
        mesh.position.set(x, 0.16, stringZ(marker.string));
        markerGroup.add(mesh);
        markerMeshes.push({ mesh, marker });
      }
    };
    rebuildMarkers();

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const handleClick = (event: MouseEvent) => {
      if (!onSelectRef.current) return;
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const hit = raycaster.intersectObjects(markerMeshes.map((m) => m.mesh))[0];
      if (!hit) return;
      const found = markerMeshes.find((m) => m.mesh === hit.object);
      if (!found) return;
      const midi = board.openMidi[found.marker.string]! + found.marker.fret;
      onSelectRef.current({ string: found.marker.string, fret: found.marker.fret, midi });
    };
    renderer.domElement.addEventListener("click", handleClick);

    let frame = 0;
    const resize = () => {
      const w = container.clientWidth;
      const h = container.clientHeight;
      if (w === 0 || h === 0) return;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(container);

    const loop = () => {
      frame = requestAnimationFrame(loop);
      controls.update();
      renderer.render(scene, camera);
    };
    frame = requestAnimationFrame(loop);

    let disposed = false;
    const rebuildOnMarkersChange = () => {
      if (disposed) return;
      rebuildMarkers();
    };
    // Exposed so the outer effect (keyed only on board/lowStringOnTop) can
    // still react to a markers-only update without tearing down the scene.
    (container as HTMLDivElement & { __rebuildMarkers?: () => void }).__rebuildMarkers = rebuildOnMarkersChange;

    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      renderer.domElement.removeEventListener("click", handleClick);
      controls.dispose();
      for (const { mesh } of markerMeshes) {
        mesh.geometry.dispose();
        (mesh.material as THREE.Material).dispose();
      }
      neckGeometry.dispose();
      neckMaterial.dispose();
      fretMaterial.dispose();
      stringMaterial.dispose();
      renderer.dispose();
      container.removeChild(renderer.domElement);
    };
    // Rebuilding the whole scene on every marker change (e.g. a live note
    // lighting up several times a second) would be wasteful; markers are
    // instead re-synced imperatively below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [board, lowStringOnTop]);

  // Re-sync markers without tearing down the renderer/camera/controls.
  useEffect(() => {
    const container = containerRef.current as (HTMLDivElement & { __rebuildMarkers?: () => void }) | null;
    container?.__rebuildMarkers?.();
  }, [markers]);

  return <div ref={containerRef} className={className} style={{ touchAction: "none" }} />;
}
