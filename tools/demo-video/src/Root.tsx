import React from "react";
import { Composition } from "remotion";
import { Demo, DURATION_FRAMES } from "./Demo";
import { FPS } from "./timeline";

export const Root: React.FC = () => (
  <Composition id="FabricDemo" component={Demo} durationInFrames={DURATION_FRAMES} fps={FPS} width={1920} height={1080} />
);
