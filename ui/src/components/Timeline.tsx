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

export function Timeline({ events, width = 800, height = 72 }: Props) {
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
    axisG
      .selectAll("path, line")
      .attr("stroke", "#30363D");
    axisG
      .selectAll("text")
      .attr("fill", "#8B949E")
      .attr("font-family", "monospace")
      .attr("font-size", 10);

    // 점: join 패턴으로 enter/update/exit 일괄 처리
    svg
      .selectAll<SVGCircleElement, TimelineEvent>("circle.evt")
      .data(visible)
      .join("circle")
      .attr("class", "evt")
      .attr("cx", (e) => x(new Date(e.ts)))
      .attr("cy", 28)
      .attr("r", (e) =>
        e.type === "verdict" && e.verdict === "ransomware"
          ? 6
          : 4
      )
      .attr("fill", (e) =>
        e.type === "verdict" && e.verdict === "ransomware"
          ? "#FF4D4F"
          : e.type === "verdict"
            ? "#00C2FF"
            : "#8B949E"
      )
  }, [events, width, height]);

  return (
    <svg
      ref={ref}
      width={width}
      height={height}
      style={{
        background: "#0F141B",

        display: "block",

        borderTop: "1px solid #1E2936",
      }}
    />
  );
}
