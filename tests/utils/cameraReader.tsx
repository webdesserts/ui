import { useCamera } from "@/src";

/** Test component that exposes CameraState values as data attributes. */
export function CameraReader() {
  const camera = useCamera();
  return (
    <div
      data-testid="camera-reader"
      data-viewport-top={camera.viewport.top}
      data-viewport-left={camera.viewport.left}
      data-viewport-width={camera.viewport.width}
      data-viewport-height={camera.viewport.height}
      data-target-top={camera.target.top}
      data-target-left={camera.target.left}
      data-target-width={camera.target.width}
      data-target-height={camera.target.height}
      data-transitioning={String(camera.transitioning)}
    />
  );
}
