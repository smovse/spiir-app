import React, { useState } from "react";

/*
 * Small, dependency-free SVG chart building blocks used only in the
 * standalone iPad build (which has no access to recharts). They cover
 * exactly the three chart shapes the app needs:
 *   - AreaChartMini: single filled area (weekly spend trend)
 *   - ComboChartMini: paired up/down bars (income/expense) + a net line
 *   - LineChartMini: a single line with a zero reference line
 *
 * Layout approach: a fixed internal coordinate system (VB_W x height),
 * rendered into an <svg> with viewBox + width:100%, so it scales to its
 * container horizontally while keeping a fixed pixel height — the same
 * effect as recharts' ResponsiveContainer, without needing to measure
 * the DOM.
 */

const VB_W = 600;
const MARGIN = { top: 10, right: 8, bottom: 22, left: 46 };

function niceTicks(min, max, count = 4) {
  if (min === max) return [min];
  const step = (max - min) / count;
  return Array.from({ length: count + 1 }, (_, i) => min + step * i);
}

function formatK(v) {
  return `${Math.round(v / 1000)}k`;
}

function useHover() {
  const [hoverIdx, setHoverIdx] = useState(null);
  return [hoverIdx, setHoverIdx];
}

function AxisAndGrid({ height, yMin, yMax, xLabels, hairline, inkSoft, xAt }) {
  const plotH = height - MARGIN.top - MARGIN.bottom;
  const yScale = (v) => MARGIN.top + plotH * (1 - (v - yMin) / (yMax - yMin || 1));
  const ticks = niceTicks(yMin, yMax, 4);
  return (
    <>
      {ticks.map((t, i) => (
        <g key={i}>
          <line x1={MARGIN.left} x2={VB_W - MARGIN.right} y1={yScale(t)} y2={yScale(t)} stroke={hairline} strokeWidth={1} />
          <text x={MARGIN.left - 8} y={yScale(t) + 3} textAnchor="end" fontSize="10.5" fontFamily="IBM Plex Mono" fill={inkSoft}>
            {formatK(t)}
          </text>
        </g>
      ))}
      {xLabels.map((label, i) => (
        <text key={i} x={xAt(i)} y={height - 5} textAnchor="middle" fontSize="11" fontFamily="IBM Plex Sans" fill={inkSoft}>
          {label}
        </text>
      ))}
    </>
  );
}

export function AreaChartMini({ data, xKey, yKey, color, height = 190, hairline = "#DEE3DC", inkSoft = "#5C6E68", formatValue }) {
  const [hoverIdx, setHoverIdx] = useHover();
  const n = data.length;
  const plotW = VB_W - MARGIN.left - MARGIN.right;
  const plotH = height - MARGIN.top - MARGIN.bottom;
  const xAt = (i) => MARGIN.left + (n <= 1 ? plotW / 2 : (plotW * i) / (n - 1));
  const values = data.map((d) => d[yKey]);
  const yMax = Math.max(1, ...values) * 1.1;
  const yMin = 0;
  const yScale = (v) => MARGIN.top + plotH * (1 - (v - yMin) / (yMax - yMin || 1));

  const linePath = data.map((d, i) => `${i === 0 ? "M" : "L"}${xAt(i)},${yScale(d[yKey])}`).join(" ");
  const areaPath = `${linePath} L${xAt(n - 1)},${yScale(0)} L${xAt(0)},${yScale(0)} Z`;

  return (
    <svg viewBox={`0 0 ${VB_W} ${height}`} width="100%" height={height} preserveAspectRatio="none" style={{ overflow: "visible" }}>
      <defs>
        <linearGradient id="areaFillGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.28} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
      <AxisAndGrid height={height} yMin={yMin} yMax={yMax} xLabels={data.map((d) => d[xKey])} hairline={hairline} inkSoft={inkSoft} xAt={xAt} />
      <path d={areaPath} fill="url(#areaFillGrad)" />
      <path d={linePath} fill="none" stroke={color} strokeWidth={2} />
      {data.map((d, i) => (
        <g key={i}>
          <rect x={xAt(i) - plotW / n / 2} y={MARGIN.top} width={plotW / n} height={plotH} fill="transparent"
            onMouseEnter={() => setHoverIdx(i)} onMouseLeave={() => setHoverIdx(null)} />
          {hoverIdx === i && (
            <>
              <circle cx={xAt(i)} cy={yScale(d[yKey])} r={4} fill={color} />
              <text x={xAt(i)} y={yScale(d[yKey]) - 10} textAnchor="middle" fontSize="11" fontFamily="IBM Plex Mono" fill="#1B2B28">
                {formatValue ? formatValue(d[yKey]) : d[yKey]}
              </text>
            </>
          )}
        </g>
      ))}
    </svg>
  );
}

export function ComboChartMini({
  data, xKey, barPos, barPosColor, barNeg, barNegColor, lineKey, lineColor,
  height = 240, hairline = "#DEE3DC", inkSoft = "#5C6E68", formatValue,
}) {
  const [hoverIdx, setHoverIdx] = useHover();
  const n = data.length;
  const plotW = VB_W - MARGIN.left - MARGIN.right;
  const plotH = height - MARGIN.top - MARGIN.bottom;
  const xAt = (i) => MARGIN.left + plotW * ((i + 0.5) / n);
  const barW = (plotW / n) * 0.5;

  const posVals = data.map((d) => d[barPos] || 0);
  const negVals = data.map((d) => d[barNeg] || 0);
  const lineVals = data.map((d) => d[lineKey] || 0);
  const allVals = [...posVals, ...negVals, ...lineVals, 0];
  const yMax = Math.max(...allVals) * 1.15 || 1;
  const yMin = Math.min(...allVals) * 1.15;
  const yScale = (v) => MARGIN.top + plotH * (1 - (v - yMin) / (yMax - yMin || 1));
  const zeroY = yScale(0);

  const linePath = data.map((d, i) => `${i === 0 ? "M" : "L"}${xAt(i)},${yScale(d[lineKey] || 0)}`).join(" ");

  return (
    <svg viewBox={`0 0 ${VB_W} ${height}`} width="100%" height={height} preserveAspectRatio="none" style={{ overflow: "visible" }}>
      <AxisAndGrid height={height} yMin={yMin} yMax={yMax} xLabels={data.map((d) => d[xKey])} hairline={hairline} inkSoft={inkSoft} xAt={xAt} />
      <line x1={MARGIN.left} x2={VB_W - MARGIN.right} y1={zeroY} y2={zeroY} stroke={hairline} strokeWidth={1} />
      {data.map((d, i) => {
        const pos = d[barPos] || 0;
        const neg = d[barNeg] || 0;
        return (
          <g key={i}>
            <rect x={xAt(i) - barW / 2} y={Math.min(yScale(pos), zeroY)} width={barW} height={Math.abs(yScale(pos) - zeroY)} fill={barPosColor} rx={2} />
            <rect x={xAt(i) - barW / 2} y={Math.min(yScale(neg), zeroY)} width={barW} height={Math.abs(yScale(neg) - zeroY)} fill={barNegColor} rx={2} />
            <rect x={xAt(i) - plotW / n / 2} y={MARGIN.top} width={plotW / n} height={plotH} fill="transparent"
              onMouseEnter={() => setHoverIdx(i)} onMouseLeave={() => setHoverIdx(null)} />
          </g>
        );
      })}
      <path d={linePath} fill="none" stroke={lineColor} strokeWidth={2} />
      {data.map((d, i) => (
        <circle key={i} cx={xAt(i)} cy={yScale(d[lineKey] || 0)} r={hoverIdx === i ? 5 : 3.5} fill="#fff" stroke={lineColor} strokeWidth={2} />
      ))}
      {hoverIdx !== null && (
        <text x={xAt(hoverIdx)} y={MARGIN.top + 2} textAnchor="middle" fontSize="11" fontFamily="IBM Plex Mono" fill="#1B2B28">
          {formatValue ? formatValue(data[hoverIdx][lineKey] || 0) : data[hoverIdx][lineKey]}
        </text>
      )}
    </svg>
  );
}

export function LineChartMini({ data, xKey, yKey, color, height = 200, hairline = "#DEE3DC", inkSoft = "#5C6E68", formatValue }) {
  const [hoverIdx, setHoverIdx] = useHover();
  const n = data.length;
  const plotW = VB_W - MARGIN.left - MARGIN.right;
  const plotH = height - MARGIN.top - MARGIN.bottom;
  const xAt = (i) => MARGIN.left + (n <= 1 ? plotW / 2 : (plotW * i) / (n - 1));
  const values = data.map((d) => d[yKey] || 0);
  const yMax = Math.max(...values, 0) * 1.15 || 1;
  const yMin = Math.min(...values, 0) * 1.15;
  const yScale = (v) => MARGIN.top + plotH * (1 - (v - yMin) / (yMax - yMin || 1));
  const zeroY = yScale(0);

  const linePath = data.map((d, i) => `${i === 0 ? "M" : "L"}${xAt(i)},${yScale(d[yKey] || 0)}`).join(" ");

  return (
    <svg viewBox={`0 0 ${VB_W} ${height}`} width="100%" height={height} preserveAspectRatio="none" style={{ overflow: "visible" }}>
      <AxisAndGrid height={height} yMin={yMin} yMax={yMax} xLabels={data.map((d) => d[xKey])} hairline={hairline} inkSoft={inkSoft} xAt={xAt} />
      <line x1={MARGIN.left} x2={VB_W - MARGIN.right} y1={zeroY} y2={zeroY} stroke={hairline} strokeWidth={1} />
      <path d={linePath} fill="none" stroke={color} strokeWidth={2.5} />
      {data.map((d, i) => (
        <g key={i}>
          <circle cx={xAt(i)} cy={yScale(d[yKey] || 0)} r={hoverIdx === i ? 5.5 : 4} fill={color} />
          <rect x={xAt(i) - plotW / n / 2} y={0} width={plotW / n} height={height} fill="transparent"
            onMouseEnter={() => setHoverIdx(i)} onMouseLeave={() => setHoverIdx(null)} />
        </g>
      ))}
      {hoverIdx !== null && (
        <text x={xAt(hoverIdx)} y={yScale(data[hoverIdx][yKey] || 0) - 10} textAnchor="middle" fontSize="11" fontFamily="IBM Plex Mono" fill="#1B2B28">
          {formatValue ? formatValue(data[hoverIdx][yKey]) : data[hoverIdx][yKey]}
        </text>
      )}
    </svg>
  );
}
