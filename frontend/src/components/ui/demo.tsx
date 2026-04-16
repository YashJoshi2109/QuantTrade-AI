"use client";

import { Player } from "@remotion/player";
import { HeroDeviceAssemble } from "@/components/ui/hero-device-assemble";

function Scene() {
  return <HeroDeviceAssemble />;
}

export default function DemoDefault() {
  return (
    <div className="w-full min-h-screen overflow-hidden bg-background relative">
      <Player
        component={Scene}
        durationInFrames={120}
        fps={30}
        compositionWidth={1280}
        compositionHeight={720}
        style={{ width: "100vw", height: "100vh" }}
        controls={false}
        autoPlay
        loop
        clickToPlay={false}
        acknowledgeRemotionLicense
      />
    </div>
  );
}
