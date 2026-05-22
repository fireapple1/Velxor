// Timeline — 간단 리스트 뷰 (Deferral #2). D3 timeline은 시간 여유 시 후속.
// 최신 항목이 상단. verdict/gap/alert 색상 구분.

import type { TimelineEntry } from "../state/graph";

interface Props {
  entries: TimelineEntry[];
}

export function Timeline({ entries }: Props) {
  const reversed = entries.slice().reverse();
  return (
    <section className="timeline">
      <h3>Timeline</h3>
      <ol>
        {reversed.length === 0 && <li className="empty">(이벤트 없음)</li>}
        {reversed.map((e, idx) => (
          <li key={`${e.seq}-${idx}`} className={`tl-${e.kind}`}>
            <time>{new Date(e.ts).toLocaleTimeString()}</time>
            {e.pid != null && <span className="pid">pid {e.pid}</span>}
            <span className="label">{e.label}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
