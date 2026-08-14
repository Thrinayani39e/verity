import { useEffect, useRef, useState } from "react";
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
import type { FraudRing } from "../lib/types";
import { fmtMoney } from "../lib/format";
import { STATUS_META } from "../lib/statusMeta";

interface ClaimNode extends SimulationNodeDatum {
  kind: "claim";
  id: string;
  claimId: string;
  label: string;
  amountCents: number;
  status: keyof typeof STATUS_META;
  ringIndex: number;
}

interface HubNode extends SimulationNodeDatum {
  kind: "hub";
  id: string;
  label: string;
  ringIndex: number;
}

type GraphNode = ClaimNode | HubNode;
type GraphLink = SimulationLinkDatum<GraphNode>;

const WIDTH = 700;
const HEIGHT = 520;

function radiusFor(amountCents: number, min: number, max: number): number {
  if (max === min) return 18;
  const t = (amountCents - min) / (max - min);
  return 13 + t * 13;
}

function maskAttribute(kind: FraudRing["shared_attribute_kind"], value: string): string {
  if (kind === "bank_account") return `Account ···· ${value}`;
  return "Shared address";
}

function useForceLayout(rings: FraudRing[] | null) {
  const [nodes, setNodes] = useState<GraphNode[]>([]);
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

    const graphNodes: GraphNode[] = [];
    const graphLinks: GraphLink[] = [];

    rings.forEach((ring, ringIndex) => {
      const hubId = `hub-${ringIndex}`;
      graphNodes.push({
        kind: "hub",
        id: hubId,
        label: maskAttribute(ring.shared_attribute_kind, ring.shared_attribute_value),
        ringIndex,
        x: WIDTH / 2 + (Math.random() - 0.5) * 100,
        y: HEIGHT / 2 + (Math.random() - 0.5) * 100,
      });
      for (const claim of ring.claims) {
        const nodeId = `claim-${claim.id}`;
        graphNodes.push({
          kind: "claim",
          id: nodeId,
          claimId: claim.id,
          label: claim.claimant_name,
          amountCents: claim.amount_cents,
          status: claim.status,
          ringIndex,
          x: WIDTH / 2 + (Math.random() - 0.5) * 200,
          y: HEIGHT / 2 + (Math.random() - 0.5) * 200,
        });
        graphLinks.push({ source: nodeId, target: hubId });
      }
    });

    // Anchor each ring to its own grid cell instead of relying on emergent
    // repulsion alone - with only a handful of disconnected clusters, pure
    // charge + a single center force tends to fling them to opposite
    // extremes rather than distributing them across the canvas.
    const padding = 90;
    const cols = Math.ceil(Math.sqrt(rings.length));
    const rows = Math.ceil(rings.length / cols);
    const cellW = (WIDTH - padding * 2) / cols;
    const cellH = (HEIGHT - padding * 2) / rows;
    const anchorFor = (ringIndex: number) => ({
      x: padding + cellW * (ringIndex % cols) + cellW / 2,
      y: padding + cellH * Math.floor(ringIndex / cols) + cellH / 2,
    });

    const sim = forceSimulation<GraphNode>(graphNodes)
      .force(
        "link",
        forceLink<GraphNode, GraphLink>(graphLinks)
          .id((n) => n.id)
          .distance(70)
          .strength(0.9),
      )
      .force("charge", forceManyBody().strength(-140))
      .force("collide", forceCollide<GraphNode>().radius((n) => (n.kind === "hub" ? 36 : radiusFor(n.amountCents, min, max) + 14)))
      .force("x", forceX<GraphNode>((n) => anchorFor(n.ringIndex).x).strength(0.12))
      .force("y", forceY<GraphNode>((n) => anchorFor(n.ringIndex).y).strength(0.12))
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
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    api.fraudRings().then(setRings).catch(() => setRings([]));
  }, []);

  const { nodes, links } = useForceLayout(rings);

  const claimNodesById = new Map(nodes.filter((n): n is ClaimNode => n.kind === "claim").map((n) => [n.id, n]));
  const hubNodesById = new Map(nodes.filter((n): n is HubNode => n.kind === "hub").map((n) => [n.id, n]));
  const allAmounts = (rings ?? []).flatMap((r) => r.claims.map((c) => c.amount_cents));
  const minAmount = Math.min(...allAmounts, 0);
  const maxAmount = Math.max(...allAmounts, 0);

  const totalClaims = rings?.reduce((sum, r) => sum + r.claims.length, 0) ?? 0;
  const totalExposure = rings?.reduce((sum, r) => sum + r.total_amount_cents, 0) ?? 0;

  return (
    <div className="animate-fade-up max-w-[1080px]">
      <h1 className="mb-2 text-2xl font-semibold tracking-tight text-[var(--color-ink)]">Fraud rings</h1>
      <p className="mb-6 max-w-[640px] text-[13.5px] leading-relaxed text-[rgb(20_23_26_/_0.55)]">
        Every claim below looks unremarkable on its own — different claimants, different dates, nothing a
        single-claim review would flag. This view finds claims that share a bank account or address across
        otherwise-unrelated names: a pattern that only exists across claims, which is exactly what a
        persistent, queryable memory can see and a stateless, one-claim-at-a-time agent cannot.
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
              <svg ref={svgRef} viewBox={`0 0 ${WIDTH} ${HEIGHT}`} width="100%" height={HEIGHT}>
                <g>
                  {links.map((link, i) => {
                    const source = typeof link.source === "object" ? link.source : claimNodesById.get(link.source as string) ?? hubNodesById.get(link.source as string);
                    const target = typeof link.target === "object" ? link.target : claimNodesById.get(link.target as string) ?? hubNodesById.get(link.target as string);
                    if (!source || !target || source.x == null || target.x == null) return null;
                    const ringIndex = "ringIndex" in source ? source.ringIndex : 0;
                    const dimmed = selected !== null && selected !== ringIndex;
                    return (
                      <line
                        key={i}
                        x1={source.x}
                        y1={source.y ?? 0}
                        x2={target.x}
                        y2={target.y ?? 0}
                        stroke={dimmed ? "rgb(20 23 26 / 0.06)" : "var(--color-status-flagged-border)"}
                        strokeWidth={1.5}
                      />
                    );
                  })}
                </g>
                <g>
                  {nodes.map((node) => {
                    if (node.x == null || node.y == null) return null;
                    const dimmed = selected !== null && selected !== node.ringIndex;
                    if (node.kind === "hub") {
                      return (
                        <g
                          key={node.id}
                          transform={`translate(${node.x}, ${node.y})`}
                          onMouseEnter={() => setSelected(node.ringIndex)}
                          onMouseLeave={() => setSelected(null)}
                          style={{ cursor: "default" }}
                        >
                          <circle r={26} fill="var(--color-status-flagged-bg)" stroke="var(--color-status-flagged)" strokeWidth={2} opacity={dimmed ? 0.3 : 1} />
                          <text textAnchor="middle" dy={4} fontSize={16}>
                            ⚠
                          </text>
                        </g>
                      );
                    }
                    const r = radiusFor(node.amountCents, minAmount, maxAmount);
                    const meta = STATUS_META[node.status];
                    return (
                      <g
                        key={node.id}
                        transform={`translate(${node.x}, ${node.y})`}
                        onClick={() => navigate(`/claims/${node.claimId}`)}
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
                  <div className="mb-2 flex items-center gap-1.5 text-[11.5px] font-bold text-[var(--color-status-flagged)]">
                    <span>⚠</span>
                    <span>{maskAttribute(ring.shared_attribute_kind, ring.shared_attribute_value)}</span>
                  </div>
                  <div className="mb-2 text-[11px] text-[rgb(20_23_26_/_0.5)]">
                    {ring.claims.length} claims · {fmtMoney(ring.total_amount_cents)} total
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
