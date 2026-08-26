"use client";

/**
 * EquityCurve
 * SVG sparkline showing account equity trend, bull (up) or bear (down).
 */
export default function EquityCurve({ bull, data = [] }) {
  const bullPts = "0,52 20,46 40,48 60,36 80,38 100,24 120,28 140,14 160,18 180,8";
  const bearPts = "0,8  20,12 40,10 60,22 80,18 100,32 120,28 140,40 160,36 180,52";
  const bucketPnls = data
    .map((bucket) => Number(bucket?.net ?? bucket?.pnl))
    .filter(Number.isFinite);
  const balances = bucketPnls.reduce((values, pnl) => {
    values.push((values.at(-1) || 0) + pnl);
    return values;
  }, []);
  const min = Math.min(...balances);
  const max = Math.max(...balances);
  const range = max - min;
  const chartPoints = balances.length > 1
    ? balances.map((value, index) => {
        const x = (index / (balances.length - 1)) * 180;
        const y = range === 0 ? 30 : 56 - ((value - min) / range) * 52;
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
    : [];
  const pts = chartPoints.length > 1 ? chartPoints.join(" ") : (bull ? bullPts : bearPts);
  const [startPoint] = pts.split(" ");
  const endPoint = pts.split(" ").at(-1);
  const [, startY = "52"] = startPoint.split(",");
  const [, endY = bull ? "8" : "52"] = endPoint.split(",");
  const color = bull ? "#0D9E6E" : "#D63B3B";
  return (
    <svg width="100%" height="64" viewBox="0 0 180 60" preserveAspectRatio="none" fill="none">
      <defs>
        <linearGradient id="eqGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stopColor={color} stopOpacity="0.15" />
          <stop offset="100%" stopColor={color} stopOpacity="0.01" />
        </linearGradient>
      </defs>
      <polygon points={`0,60 ${pts} 180,60`} fill="url(#eqGrad)" />
      <polyline points={pts} stroke={color} strokeWidth="2.5" fill="none" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx="0" cy={startY} r="3" fill={color} opacity="0.4" />
      <circle cx="180" cy={endY} r="4" fill={color} />
    </svg>
  );
}
