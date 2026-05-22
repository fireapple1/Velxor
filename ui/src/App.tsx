// App — UI 조합. WS 입력 → graph reducer → ProcessTree + DetailPanel + Timeline.

import { useCallback, useMemo, useState } from "react";
import { useVelxorWs } from "./ws/client";
import { useGraphState } from "./state/graph";
import { ProcessTree } from "./components/ProcessTree";
import { DetailPanel } from "./components/DetailPanel";
import { Timeline } from "./components/Timeline";
import { StatusBar } from "./components/StatusBar";
import type { BlockOutcome, WsMessage } from "./types/wire";

export default function App() {
  const [state, dispatch] = useGraphState();
  const [selectedPid, setSelectedPid] = useState<number | null>(null);

  const onMessage = useCallback((msg: WsMessage) => {
    dispatch({ kind: "ws", msg });
  }, [dispatch]);

  const onStatusChange = useCallback((status: "connecting" | "open" | "closed") => {
    dispatch({ kind: "status", status });
  }, [dispatch]);

  useVelxorWs({ onMessage, onStatusChange });

  const onBlockResult = useCallback((pid: number, outcome: BlockOutcome) => {
    dispatch({ kind: "block_result", pid, outcome });
  }, [dispatch]);

  const processList = useMemo(
    () => state.order.map((id) => state.nodes[id]).filter((n) => n != null),
    [state.order, state.nodes],
  );
  const selectedNode = selectedPid != null ? (state.nodes[String(selectedPid)] ?? null) : null;

  return (
    <div className="app-shell">
      <StatusBar
        status={state.status}
        lastSeq={state.lastSeq}
        gapCount={state.gapCount}
        nodeCount={processList.length}
      />
      <main className="layout">
        <section className="tree-pane">
          <ProcessTree nodes={processList} selectedPid={selectedPid} onSelect={setSelectedPid} />
        </section>
        <DetailPanel node={selectedNode} onBlockResult={onBlockResult} />
      </main>
      <Timeline entries={state.timeline} />
    </div>
  );
}
