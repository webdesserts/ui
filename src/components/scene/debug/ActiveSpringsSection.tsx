import { useState, useCallback, useLayoutEffect, useEffect, useRef } from "react";
import type { DebugMotionRecorder } from "./motionRecorder";

/**
 * Debug overlay section listing every currently-registered MotionValue on
 * Scene's motion seam (cameraX, scrollY/topOffset/z per column,
 * height/marginBottom per within-column depth-deck object — ui#21's
 * height/margin channels, replacing the retired withinColumnTop key) with
 * its live
 * value, target (when the driving animate() call reported one — an
 * inertia/fling deceleration has no fixed target and reads "—"), and
 * velocity. Registered keys are corrected via a useLayoutEffect (same
 * commit-stale rationale as SceneDebugOverlay.tsx's own `objects` list —
 * a brand new key registering elsewhere doesn't otherwise trigger a
 * re-render here) but the per-row NUMBERS are updated via a continuously
 * running requestAnimationFrame loop that mutates each row's text nodes
 * directly (SceneObjectOutlines' pattern) — a MotionValue changes every
 * frame off React's own render cycle, so reading it only at commit time
 * would show it permanently stale mid-spring. Runs for as long as this
 * component is mounted (i.e. for as long as `debug` is enabled) rather than
 * gating on SceneViewport's animatingRef counter, which only tracks the
 * stage/column motion.div's own WAAPI animations — not these imperative
 * animate(motionValue, ...) calls, which have no such correlated signal.
 */
export function ActiveSpringsSection({ recorder }: { recorder: DebugMotionRecorder }) {
  const [keys, setKeys] = useState<string[]>([]);
  useLayoutEffect(() => {
    const fresh = Array.from(recorder.values.keys());
    setKeys((prev) => {
      const same = prev.length === fresh.length && prev.every((k, i) => k === fresh[i]);
      return same ? prev : fresh;
    });
  });

  const valueRefs = useRef<Map<string, HTMLElement>>(new Map());
  const targetRefs = useRef<Map<string, HTMLElement>>(new Map());
  const velocityRefs = useRef<Map<string, HTMLElement>>(new Map());

  const updateRows = useCallback(() => {
    for (const key of keys) {
      const mv = recorder.values.get(key);
      if (!mv) continue;
      const valueEl = valueRefs.current.get(key);
      const targetEl = targetRefs.current.get(key);
      const velocityEl = velocityRefs.current.get(key);
      const target = recorder.targets.get(key);
      if (valueEl) valueEl.textContent = mv.get().toFixed(1);
      if (targetEl) targetEl.textContent = target === undefined ? "—" : target.toFixed(1);
      if (velocityEl) velocityEl.textContent = mv.getVelocity().toFixed(1);
    }
  }, [keys, recorder]);

  // Paint-synchronous pass so the very first frame isn't blank before the
  // first rAF tick below (mirrors SceneObjectOutlines' equivalent
  // useLayoutEffect measureAndUpdate pass).
  useLayoutEffect(() => {
    updateRows();
  });

  useEffect(() => {
    let rafId = requestAnimationFrame(function loop() {
      updateRows();
      rafId = requestAnimationFrame(loop);
    });
    return () => cancelAnimationFrame(rafId);
  }, [updateRows]);

  if (keys.length === 0) return null;

  return (
    <>
      <div style={{ fontWeight: "bold", marginTop: 8, marginBottom: 4 }}>
        Active springs
      </div>
      {keys.map((key) => (
        <div key={key} data-ui-scene-debug-spring={key}>
          <span style={{ color: "#fbbf24" }}>{key}</span>
          {": "}
          <span
            ref={(el) => {
              if (el) valueRefs.current.set(key, el);
              else valueRefs.current.delete(key);
            }}
            data-ui-scene-debug-spring-value
          />
          {" → "}
          <span
            ref={(el) => {
              if (el) targetRefs.current.set(key, el);
              else targetRefs.current.delete(key);
            }}
            data-ui-scene-debug-spring-target
          />
          {" (v="}
          <span
            ref={(el) => {
              if (el) velocityRefs.current.set(key, el);
              else velocityRefs.current.delete(key);
            }}
            data-ui-scene-debug-spring-velocity
          />
          {")"}
        </div>
      ))}
    </>
  );
}
