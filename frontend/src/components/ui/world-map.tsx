"use client";

import { useMemo } from "react";
import DottedMap from "dotted-map";
import Image from "next/image";

interface EventMarker {
  lat: number;
  lng: number;
  color: string;
  label?: string;
  id?: string;
  pulse?: boolean;
}

interface MapProps {
  eventMarkers?: EventMarker[];
  onMarkerClick?: (marker: EventMarker) => void;
  dark?: boolean;
}

export function WorldMap({
  eventMarkers = [],
  onMarkerClick,
  dark = true,
}: MapProps) {
  const map = useMemo(
    () => new DottedMap({ height: 100, grid: "diagonal" }),
    []
  );

  const svgMap = useMemo(
    () =>
      map.getSVG({
        radius: 0.22,
        color: dark ? "#94a3b860" : "#00000040",
        shape: "circle",
        backgroundColor: dark ? "black" : "white",
      }),
    [map, dark]
  );

  const projectPoint = (lat: number, lng: number) => {
    const x = (lng + 180) * (800 / 360);
    const y = (90 - lat) * (400 / 180);
    return { x, y };
  };

  return (
    <div className="w-full aspect-[2/1] md:aspect-[2.5/1] lg:aspect-[2/1] rounded-lg relative font-sans overflow-hidden"
      style={{ background: dark ? 'black' : 'white' }}>
      <Image
        src={`data:image/svg+xml;utf8,${encodeURIComponent(svgMap)}`}
        className="h-full w-full [mask-image:linear-gradient(to_bottom,transparent,white_10%,white_90%,transparent)] pointer-events-none select-none object-cover"
        alt="world map"
        height="495"
        width="1056"
        draggable={false}
        priority
      />
      <svg
        viewBox="0 0 800 400"
        className="w-full h-full absolute inset-0 pointer-events-auto select-none"
        preserveAspectRatio="xMidYMid meet"
      >
        <defs>
          <filter id="marker-glow">
            <feMorphology operator="dilate" radius="0.5" />
            <feGaussianBlur stdDeviation="1.5" result="coloredBlur" />
            <feMerge>
              <feMergeNode in="coloredBlur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {eventMarkers.map((marker, i) => {
          const pt = projectPoint(marker.lat, marker.lng);
          return (
            <g
              key={marker.id || `marker-${i}`}
              className="cursor-pointer"
              onClick={() => onMarkerClick?.(marker)}
            >
              <circle
                cx={pt.x}
                cy={pt.y}
                r="3.5"
                fill={marker.color}
                filter="url(#marker-glow)"
              />
              {marker.pulse && (
                <circle
                  cx={pt.x}
                  cy={pt.y}
                  r="3.5"
                  fill={marker.color}
                  opacity="0.5"
                >
                  <animate attributeName="r" from="3.5" to="14" dur="2s" repeatCount="indefinite" />
                  <animate attributeName="opacity" from="0.5" to="0" dur="2s" repeatCount="indefinite" />
                </circle>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
