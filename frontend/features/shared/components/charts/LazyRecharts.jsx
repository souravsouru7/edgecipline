"use client";

import { useEffect, useState } from "react";

// Loads recharts on demand and hands the module namespace to a render prop.
//
// Why a render prop instead of next/dynamic per component: recharts finds
// its children by component *type* (findAllByType(children, Line)), so a
// lazily-wrapped <Line> is a different type and silently renders nothing.
// Passing the real namespace keeps identities intact, the page keeps its own
// state and tooltips, and every route that draws a chart shares ONE async
// chunk instead of bundling its own 356 kB copy.
//
// Usage:
//   <LazyRecharts height={160}>
//     {(R) => (
//       <R.ResponsiveContainer width="100%" height="100%">
//         <R.LineChart data={rows}>…</R.LineChart>
//       </R.ResponsiveContainer>
//     )}
//   </LazyRecharts>

let loaded = null;
let loading = null;

function loadRecharts() {
  if (loaded) return Promise.resolve(loaded);
  if (!loading) {
    loading = import("recharts").then((mod) => {
      loaded = mod;
      return mod;
    });
  }
  return loading;
}

export function ChartSkeleton({ height = "100%" }) {
  return (
    <div
      aria-hidden="true"
      className="skeleton"
      style={{ width: "100%", height, borderRadius: 10, opacity: 0.7 }}
    />
  );
}

export default function LazyRecharts({ children, height = "100%", fallback }) {
  const [R, setR] = useState(loaded);

  useEffect(() => {
    if (R) return undefined;
    let active = true;
    loadRecharts().then((mod) => {
      if (active) setR(mod);
    });
    return () => {
      active = false;
    };
  }, [R]);

  if (!R) return fallback ?? <ChartSkeleton height={height} />;
  return children(R);
}
