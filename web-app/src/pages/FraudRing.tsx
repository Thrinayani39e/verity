import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from "d3-force";
import { api } from "../lib/api";
import type { FraudRing, FraudRingEdge } from "../lib/types";
import { fmtMoney } from "../lib/format";
import { STATUS_META } from "../lib/statusMeta";

interface ClaimNode extends SimulationNodeDatum {
  id: string;
  label: string;
  amountCents: number;
  status: keyof typeof STATUS_META;
  ringIndex: number;
}

interface GraphLink extends SimulationLinkDatum<ClaimNode> {
  kind: FraudRingEdge["kind"];
}

const WIDTH = 700;
const HEIGHT = 520;

const EDGE_STYLE: Record<FraudRingEdge["kind"], { stroke: string; dash?: string; label: string }> = {
  bank_account_last4: { stroke: "var(--color-status-flagged)", label: "Shared bank account" },
  claimant_address: { stroke: "var(--color-status-progress)", dash: "5 4", label: "Shared address" },
};

function radiusFor(amountCents: number, min: number, max: number): number {
  if (max === min) return 18;
  const t = (amountCents - min) / (max - min);
  return 13 + t * 13;
}

function edgeReasons(ring: FraudRing): { kind: FraudRingEdge["kind"]; value: string }[] {
  const seen = new Map<string, { kind: FraudRingEdge["kind"]; value: string }>();
  for (const e of ring.edges) seen.set(`${e.kind}:${e.value}`, { kind: e.kind, value: e.value });
  return [...seen.values()];
}

function useForceLayout(rings: FraudRing[] | null) {
  const [nodes, setNodes] = useState<ClaimNode[]>([]);
  const [links, setLinks] = useState<GraphLink[]>([]);

  useEffect(() => {
    if (!rings || rings.length === 0) {
      setNodes((prev) => (prev.length === 0 ? prev : []));
      setLinks((prev) => (prev.length === 0 ? prev : []));
      return;
    }

    const allAmounts = rings.flatMap((r) => r.claims.map((c) => c.amount_cents));
    const min = Math.min(...allAmounts);
    const max = Math.max(...allAmounts);

    const graphNodes: ClaimNode[] = [];
    const graphLinks: GraphLink[] = [];

    rings.forEach((ring, ringIndex) => {
      for (const claim of ring.claims) {
        graphNodes.push({
          id: claim.id,
          label: claim.claimant_name,
          amountCents: claim.amount_cents,
          status: claim.status,
          ringIndex,
          x: WIDTH / 2 + (Math.random() - 0.5) * 200,
          y: HEIGHT / 2 + (Math.random() - 0.5) * 200,
        });
      }
      for (const edge of ring.edges) {
        graphLinks.push({ source: edge.from, target: edge.to, kind: edge.kind });
      }
    });

    // Anchor each ring to its own grid cell instead of relying on emergent
    // repulsion alone - with only a handful of disconnected clusters, pure
    // charge + a single center force tends to fling them to opposite
    // extremes rather than distributing them across the canvas.
    const padding = 90;
    const cols = Math.ceil(Math.sqrt(rings.length));
    const rowCount = Math.ceil(rings.length / cols);
    const cellW = (WIDTH - padding * 2) / cols;
    const cellH = (HEIGHT - padding * 2) / rowCount;
    const anchorFor = (ringIndex: number) => ({
      x: padding + cellW * (ringIndex % cols) + cellW / 2,
      y: padding + cellH * Math.floor(ringIndex / cols) + cellH / 2,
    });

    const sim = forceSimulation<ClaimNode>(graphNodes)
      .force(
        "link",
        forceLink<ClaimNode, GraphLink>(graphLinks)
          .id((n) => n.id)
          .distance(85)
          .strength(0.8),
      )
      .force("charge", forceManyBody().strength(-160))
      .force("collide", forceCollide<ClaimNode>().radius((n) => radiusFor(n.amountCents, min, max) + 16))
      .force("x", forceX<ClaimNode>((n) => anchorFor(n.ringIndex).x).strength(0.1))
      .force("y", forceY<ClaimNode>((n) => anchorFor(n.ringIndex).y).strength(0.1))
      .on("tick", () => {
        const margin = 26;
        for (const n of graphNodes) {
          n.x = Math.max(margin, Math.min(WIDTH - margin, n.x ?? WIDTH / 2));
          n.y = Math.max(margin, Math.min(HEIGHT - margin, n.y ?? HEIGHT / 2));
        }
        setNodes([...graphNodes]);
      });

    setLinks(graphLinks);

    return () => {
      sim.stop();
    };
  }, [rings]);

  return { nodes, links };
}

export function FraudRingPage() {
  const [rings, setRings] = useState<FraudRing[] | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    api.fraudRings().then(setRings).catch(() => setRings([]));
  }, []);

  const { nodes, links } = useForceLayout(rings);
  const nodesById = new Map(nodes.map((n) => [n.id, n]));

  const allAmounts = (rings ?? []).flatMap((r) => r.claims.map((c) => c.amount_cents));
  const minAmount = Math.min(...allAmounts, 0);
  const maxAmount = Math.max(...allAmounts, 0);

  const totalClaims = rings?.reduce((sum, r) => sum + r.claims.length, 0) ?? 0;
  const totalExposure = rings?.reduce((sum, r) => sum + r.total_amount_cents, 0) ?? 0;

  return (
    <div className="animate-fade-up max-w-[1080px]">
      <h1 className="mb-2 text-2xl font-semibold tracking-tight text-[var(--color-ink)]">Fraud rings</h1>
      <p className="mb-6 max-w-[640px] text-[13.5px] leading-relaxed text-[rgb(20_23_26_/_0.55)]">
        Every claim below looks unremarkable on its own: different claimants, different dates, nothing a
        single-claim review would flag. This finds claims connected by a shared bank account or address,
        directly, or transitively through another claim that bridges the two, a pattern that only exists
        across claims and that no single-claim review, human or agent, can see.
      </p>

      {rings === null && <p className="text-sm text-[rgb(20_23_26_/_0.4)]">Loading…</p>}

      {rings !== null && rings.length === 0 && (
        <div className="rounded-[10px] border border-[var(--color-line)] bg-white px-5 py-10 text-center text-[13px] text-[rgb(20_23_26_/_0.4)]">
          No shared-attribute rings found in the current dataset.
        </div>
      )}

      {rings !== null && rings.length > 0 && (
        <>
          <div className="mb-6 grid grid-cols-3 gap-px overflow-hidden rounded-[10px] border border-[var(--color-line)] bg-[var(--color-line)]">
            <div className="bg-white px-5 py-4.5">
              <div className="mb-2 text-[10.5px] font-semibold tracking-[0.05em] text-[rgb(20_23_26_/_0.45)]">RINGS FOUND</div>
              <div className="text-[25px] font-semibold text-[var(--color-ink)]">{rings.length}</div>
            </div>
            <div className="bg-white px-5 py-4.5">
              <div className="mb-2 text-[10.5px] font-semibold tracking-[0.05em] text-[rgb(20_23_26_/_0.45)]">CLAIMS INVOLVED</div>
              <div className="text-[25px] font-semibold text-[var(--color-ink)]">{totalClaims}</div>
            </div>
            <div className="bg-white px-5 py-4.5">
              <div className="mb-2 text-[10.5px] font-semibold tracking-[0.05em] text-[var(--color-status-flagged)]">TOTAL EXPOSURE</div>
              <div className="text-[25px] font-semibold text-[var(--color-status-flagged)]">{fmtMoney(totalExposure)}</div>
            </div>
          </div>

          <div className="grid grid-cols-[1.5fr_1fr] items-start gap-6.5">
            <div className="overflow-hidden rounded-[10px] border border-[var(--color-line)] bg-white">
              <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} width="100%" height={HEIGHT}>
                <g>
                  {links.map((link, i) => {
                    const source = typeof link.source === "object" ? link.source : nodesById.get(link.source as string);
                    const target = typeof link.target === "object" ? link.target : nodesById.get(link.target as string);
                    if (!source || !target || source.x == null || target.x == null) return null;
                    const dimmed = selected !== null && selected !== source.ringIndex;
                    const style = EDGE_STYLE[link.kind];
                    return (
                      <line
                        key={i}
                        x1={source.x}
                        y1={source.y ?? 0}
                        x2={target.x}
                        y2={target.y ?? 0}
                        stroke={dimmed ? "rgb(20 23 26 / 0.08)" : style.stroke}
                        strokeDasharray={style.dash}
                        strokeWidth={1.75}
                      />
                    );
                  })}
                </g>
                <g>
                  {nodes.map((node) => {
                    if (node.x == null || node.y == null) return null;
                    const dimmed = selected !== null && selected !== node.ringIndex;
                    const r = radiusFor(node.amountCents, minAmount, maxAmount);
                    const meta = STATUS_META[node.status];
                    return (
                      <g
                        key={node.id}
                        transform={`translate(${node.x}, ${node.y})`}
                        onClick={() => navigate(`/claims/${node.id}`)}
                        onMouseEnter={() => setSelected(node.ringIndex)}
                        onMouseLeave={() => setSelected(null)}
                        style={{ cursor: "pointer" }}
                        opacity={dimmed ? 0.3 : 1}
                      >
                        <circle r={r} fill="white" stroke={meta.dot} strokeWidth={2.5} />
                        <circle r={3} fill={meta.dot} />
                        <text textAnchor="middle" y={r + 14} fontSize={10.5} fontWeight={600} fill="var(--color-ink)">
                          {node.label.split(" ")[0]}
                        </text>
                      </g>
                    );
                  })}
                </g>
              </svg>
              <div className="flex items-center gap-5 border-t border-[var(--color-line)] px-4 py-2.5 text-[11px] text-[rgb(20_23_26_/_0.55)]">
                <div className="flex items-center gap-1.5">
                  <svg width="18" height="2"><line x1="0" y1="1" x2="18" y2="1" stroke="var(--color-status-flagged)" strokeWidth={2} /></svg>
                  <span>Shared bank account</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <svg width="18" height="2"><line x1="0" y1="1" x2="18" y2="1" stroke="var(--color-status-progress)" strokeWidth={2} strokeDasharray="5 4" /></svg>
                  <span>Shared address</span>
                </div>
              </div>
            </div>

            <div className="flex flex-col gap-3">
              {rings.map((ring, i) => (
                <div
                  key={i}
                  onMouseEnter={() => setSelected(i)}
                  onMouseLeave={() => setSelected(null)}
                  className="rounded-[10px] border px-4 py-3.5"
                  style={{
                    borderColor: selected === i ? "var(--color-status-flagged)" : "var(--color-line)",
                    background: selected === i ? "var(--color-status-flagged-bg)" : "white",
                  }}
                >
                  <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] font-bold text-[var(--color-status-flagged)]">
                    <span>⚠ {ring.claims.length}-claim ring</span>
                  </div>
                  <div className="mb-2 flex flex-col gap-0.5 text-[10.5px] text-[rgb(20_23_26_/_0.5)]">
                    {edgeReasons(ring).map((r, j) => (
                      <span key={j}>
                        {r.kind === "bank_account_last4" ? `Bank account ···· ${r.value}` : `Address: ${r.value}`}
                      </span>
                    ))}
                  </div>
                  <div className="mb-2 text-[11px] font-semibold text-[rgb(20_23_26_/_0.65)]">
                    {fmtMoney(ring.total_amount_cents)} total exposure
                  </div>
                  {ring.claims.map((c) => (
                    <div
                      key={c.id}
                      onClick={() => navigate(`/claims/${c.id}`)}
                      className="flex cursor-pointer items-center justify-between py-1 text-[12.5px] text-[var(--color-ink)] hover:underline"
                    >
                      <span>{c.claimant_name}</span>
                      <span className="font-semibold">{fmtMoney(c.amount_cents)}</span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
