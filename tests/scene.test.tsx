import { describe, test, expect } from "vitest";
import { useState } from "react";
import { render, cleanup } from "vitest-browser-react";
import { Scene, SceneObject, SceneColumn } from "../src";
import { MotionSeamContext } from "../src/components/scene/motionSeam";
import { TestWrapper } from "./test-wrapper";
import {
  waitForAnimationFrame,
  wait,
  createMotionSeamRecorder,
  waitForAnimationsToSettle,
  awaitStyleFlush,
  waitForSceneSettled,
} from "./utils/animation";
import { parseTranslateY } from "./utils/transform";
import { captureFlipCommit, findGbcrOutliers, gbcrDeltasOf, type GBCRBox } from "./utils/gbcrSampling";

