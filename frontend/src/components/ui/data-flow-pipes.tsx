"use client";

import { interpolate, useCurrentFrame } from "remotion";

export interface DataFlowNode {
  id: string;
  x: number;
  y: number;
  label?: string;
  icon?: string;
}

export interface DataFlowEdge {
  from: string;
  to: string;
  /** Frame when the pulse on this edge starts. */
  startFrame?: number;
}

export interface DataFlowPipesProps {
  nodes?: DataFlowNode[];
  edges?: DataFlowEdge[];
  pipeColor?: string;
  pulseColor?: string;
  pulseLength?: number;
  pulseDuration?: number;
  background?: string;
  nodeColor?: string;
  textColor?: string;
  speed?: number;
  className?: string;
  nodeRadius?: number;
  viewBox?: string;
}

const DEFAULT_NODES: DataFlowNode[] = [
  { id: "client", x: 140, y: 360, label: "Client" },
  { id: "api", x: 460, y: 200, label: "API" },
  { id: "queue", x: 460, y: 520, label: "Queue" },
  { id: "db", x: 820, y: 360, label: "Database" },
  { id: "cdn", x: 1140, y: 200, label: "CDN" },
  { id: "log", x: 1140, y: 520, label: "Logs" },
];

const DEFAULT_EDGES: DataFlowEdge[] = [
  { from: "client", to: "api", startFrame: 0 },
  { from: "client", to: "queue", startFrame: 12 },
  { from: "api", to: "db", startFrame: 24 },
  { from: "queue", to: "db", startFrame: 36 },
  { from: "db", to: "cdn", startFrame: 48 },
  { from: "db", to: "log", startFrame: 56 },
];

function bezierPath(a: { x: number; y: number }, b: { x: number; y: number }) {
  const dx = b.x - a.x;
  const handle = Math.max(60, Math.abs(dx) * 0.5);
  const c1x = a.x + handle;
  const c1y = a.y;
  const c2x = b.x - handle;
  const c2y = b.y;
  return `M ${a.x} ${a.y} C ${c1x} ${c1y}, ${c2x} ${c2y}, ${b.x} ${b.y}`;
}

function bezierLength(
  a: { x: number; y: number },
  b: { x: number; y: number },
) {
  const handle = Math.max(60, Math.abs(b.x - a.x) * 0.5);
  const c1 = { x: a.x + handle, y: a.y };
  const c2 = { x: b.x - handle, y: b.y };
  let len = 0;
  let prev = a;
  const steps = 32;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const u = 1 - t;
    const p = {
      x:
        u * u * u * a.x +
        3 * u * u * t * c1.x +
        3 * u * t * t * c2.x +
        t * t * t * b.x,
      y:
        u * u * u * a.y +
        3 * u * u * t * c1.y +
        3 * u * t * t * c2.y +
        t * t * t * b.y,
    };
    len += Math.hypot(p.x - prev.x, p.y - prev.y);
    prev = p;
  }
  return len;
}

export function DataFlowPipes({
  nodes = DEFAULT_NODES,
  edges = DEFAULT_EDGES,
  pipeColor = "#1f1f23",
  pulseColor = "#22d3ee",
  pulseLength = 60,
  pulseDuration = 36,
  background = "transparent",
  nodeColor = "#0a0a0a",
  textColor = "#fafafa",
  speed = 1,
  className,
  viewBox = "0 0 1280 720",
}: DataFlowPipesProps) {
  const frame = useCurrentFrame() * speed;
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));

  return (
    <div
      className={className}
      style={{
        position: "absolute",
        inset: 0,
        background,
      }}
    >
      <svg
        width="100%"
        height="100%"
        viewBox={viewBox}
        preserveAspectRatio="xMidYMid meet"
        style={{ position: "absolute", inset: 0 }}
      >
        {/* Static pipes */}
        {edges.map((edge, i) => {
          const a = nodeMap.get(edge.from);
          const b = nodeMap.get(edge.to);
          if (!a || !b) return null;
          const path = bezierPath(a, b);
          return (
            <path
              key={`pipe-${i}`}
              d={path}
              fill="none"
              stroke={pipeColor}
              strokeWidth={2.5}
              strokeLinecap="round"
            />
          );
        })}

        {/* Pulses with trailing ghosts */}
        {edges.map((edge, i) => {
          const a = nodeMap.get(edge.from);
          const b = nodeMap.get(edge.to);
          if (!a || !b) return null;
          const path = bezierPath(a, b);
          const len = bezierLength(a, b);
          const startFrame = edge.startFrame ?? 0;
          const localFrame = frame - startFrame;

          const offset = interpolate(
            localFrame,
            [0, pulseDuration],
            [len + pulseLength, -pulseLength],
            { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
          );

          if (localFrame < 0 || localFrame > pulseDuration + 6) {
            return null;
          }

          return (
            <g key={`pulse-${i}`}>
              {[0.15, 0.3, 0.55].map((alpha, idx) => (
                <path
                  key={`trail-${idx}`}
                  d={path}
                  fill="none"
                  stroke={pulseColor}
                  strokeWidth={2.5}
                  strokeLinecap="round"
                  strokeDasharray={`${pulseLength} 9999`}
                  strokeDashoffset={offset + (idx + 1) * 8}
                  opacity={alpha}
                />
              ))}
              <path
                d={path}
                fill="none"
                stroke={pulseColor}
                strokeWidth={3}
                strokeLinecap="round"
                strokeDasharray={`${pulseLength} 9999`}
                strokeDashoffset={offset}
                style={{
                  filter: `drop-shadow(0 0 8px ${pulseColor})`,
                }}
              />
            </g>
          );
        })}

        {/* Node backgrounds as SVG rects for proper layering */}
        {nodes.map((node) => (
          <g key={`node-${node.id}`}>
            <rect
              x={node.x - 58}
              y={node.y - 22}
              width={116}
              height={44}
              rx={10}
              fill={nodeColor}
              stroke="rgba(255,255,255,0.08)"
              strokeWidth={1}
            />
            <text
              x={node.x}
              y={node.y + 5}
              textAnchor="middle"
              fill={textColor}
              fontSize={12}
              fontWeight={600}
              fontFamily="-apple-system, BlinkMacSystemFont, sans-serif"
              letterSpacing="-0.01em"
            >
              {node.label ?? node.id}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}
