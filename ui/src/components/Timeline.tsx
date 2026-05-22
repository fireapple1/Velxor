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

    // 축: 매번 selectAll().remove() 로 재생성 (60 height 작은 SVG라 비용 무시 가능)
    svg.selectAll("g.axis").remove();
    const axisG = svg
      .append("g")
      .attr("class", "axis")
      .attr("transform", `translate(0, ${height - 18})`);
    axisG.call(
      d3
        .axisBottom<Date>(x)
        .ticks(5)
        .tickFormat((d) => d3.timeFormat("%H:%M:%S")(d as Date)),
    );
    axisG.selectAll("path, line").attr("stroke", "#00ffcc55");
    axisG
      .selectAll("text")
      .attr("fill", "#00ffcc99")
      .attr("font-family", "monospace")
      .attr("font-size", 10);

    // 점: join 패턴으로 enter/update/exit 일괄 처리
    svg
      .selectAll<SVGCircleElement, TimelineEvent>("circle.evt")
      .data(visible)
      .join("circle")
      .attr("class", "evt")
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
