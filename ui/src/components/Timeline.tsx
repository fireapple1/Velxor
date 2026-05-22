import * as d3 from "d3";
import { useEffect, useRef } from "react";

export type TimelineEvent = {
  ts: number;
  type: "node_add" | "verdict";
  verdict?: "benign" | "ransomware";
};

type Props = {
  events: TimelineEvent[];
  width?: number;
  height?: number;
};

const WINDOW_MS = 30_000;

export function Timeline({ events, width = 800, height = 60 }: Props) {
  const ref = useRef<SVGSVGElement>(null);

  useEffect(() => {
    if (!ref.current) return;
    const svg = d3.select(ref.current);

    const now = events.length ? Math.max(...events.map((e) => e.ts)) : Date.now();
    const start = now - WINDOW_MS;
    const visible = events.filter((e) => e.ts >= start);

    const x = d3
      .scaleTime()
      .domain([new Date(start), new Date(now)])
      .range([20, width - 20]);

    // 축
    const axis = svg.selectAll<SVGGElement, null>("g.axis").data([null]);
    const axisEnter = axis.enter().append("g").attr("class", "axis").attr("transform", `translate(0, ${height - 18})`);
    const axisMerged = axisEnter.merge(axis as d3.Selection<SVGGElement, null, null, undefined>);
    axisMerged.call(
      d3
        .axisBottom(x)
        .ticks(5)
        .tickFormat((d) => d3.timeFormat("%H:%M:%S")(d as Date)),
    );
    axisMerged.selectAll("path, line").attr("stroke", "#00ffcc55");
    axisMerged.selectAll("text").attr("fill", "#00ffcc99").attr("font-family", "monospace").attr("font-size", 10);

    // 점
    const dots = svg
      .selectAll<SVGCircleElement, TimelineEvent>("circle.evt")
      .data(visible, (_, i) => `${visible[i]?.ts}-${visible[i]?.type}-${i}`);

    dots
      .enter()
      .append("circle")
      .attr("class", "evt")
      .merge(dots as d3.Selection<SVGCircleElement, TimelineEvent, SVGSVGElement, unknown>)
      .attr("cx", (e) => x(new Date(e.ts)))
      .attr("cy", 24)
      .attr("r", (e) => (e.type === "verdict" && e.verdict === "ransomware" ? 5 : 3))
      .attr("fill", (e) =>
        e.type === "verdict" && e.verdict === "ransomware"
          ? "#ff3333"
          : e.type === "verdict"
            ? "#00ffcc"
            : "#666666",
      )
      .attr("filter", (e) =>
        e.type === "verdict" && e.verdict === "ransomware"
          ? "drop-shadow(0 0 4px #ff3333)"
          : "none",
      );

    dots.exit().remove();
  }, [events, width, height]);

  return (
    <svg
      ref={ref}
      width={width}
      height={height}
      style={{ background: "#0a0a0c", display: "block", borderTop: "1px solid #00ffcc22" }}
    />
  );
}
