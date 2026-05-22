// D3 또는 visx로 time axis + verdict markers
// 시간 부족 시 단순 리스트 뷰로 대체 — Deferral #2
import * as d3 from "d3";
import { useEffect, useRef } from "react";

export function Timeline({ events }: { events: { ts: number; verdict?: string }[] }) {
  const ref = useRef<SVGSVGElement>(null);
  useEffect(() => {
    if (!ref.current || !events.length) return;
    const svg = d3.select(ref.current);
    const x = d3.scaleTime().domain(d3.extent(events, e => new Date(e.ts)) as [Date, Date]).range([20, 780]);
    svg.selectAll("circle").data(events).join("circle")
      .attr("cx", e => x(new Date(e.ts))).attr("cy", 30).attr("r", 4)
      .attr("fill", e => e.verdict === "ransomware" ? "#e53935" : "#888");
  }, [events]);
  return <svg ref={ref} width={800} height={60} style={{ background: "#111" }} />;
}