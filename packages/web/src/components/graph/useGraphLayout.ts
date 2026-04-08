import { useState, useEffect } from "react";
import ELK from "elkjs/lib/elk.bundled.js";
import type { ElkNode, ElkExtendedEdge } from "elkjs";
import type { Node, Edge } from "@xyflow/react";

const elk = new ELK();

const NODE_WIDTH = 200;
const NODE_HEIGHT = 80;
const GROUP_PADDING = "[top=60,left=30,bottom=30,right=30]";

type LayoutResult = {
  nodes: Node[];
  edges: Edge[];
};

/**
 * Returns true when the node represents a group (epic bounding box).
 */
const isGroupNode = (node: Node): boolean =>
  node.type === "group" || (node.data?.isEpic === true && node.type !== "task");

/**
 * Convert flat React Flow nodes and edges into ELK's nested tree format.
 */
function flatToElkGraph(nodes: Node[], edges: Edge[]): ElkNode {
  const nodeIdSet = new Set(nodes.map((n) => n.id));

  // Build ElkNode for each React Flow node
  const elkNodeMap = new Map<string, ElkNode>();

  for (const node of nodes) {
    if (isGroupNode(node)) {
      elkNodeMap.set(node.id, {
        id: node.id,
        children: [],
        layoutOptions: {
          "elk.padding": GROUP_PADDING,
          "elk.algorithm": "layered",
          "elk.direction": "DOWN",
          "elk.spacing.nodeNode": "40",
          "elk.layered.spacing.nodeNodeBetweenLayers": "60",
        },
      });
    } else {
      elkNodeMap.set(node.id, {
        id: node.id,
        width: NODE_WIDTH,
        height: NODE_HEIGHT,
      });
    }
  }

  // Nest children into their parent's children array
  const topLevelNodes: ElkNode[] = [];

  for (const node of nodes) {
    const elkNode = elkNodeMap.get(node.id)!;
    const parentId = node.parentId;

    if (parentId && nodeIdSet.has(parentId)) {
      const parent = elkNodeMap.get(parentId);
      if (parent) {
        parent.children!.push(elkNode);
        continue;
      }
    }

    topLevelNodes.push(elkNode);
  }

  // Build edges at root level using ELK's sources/targets format
  const elkEdges: ElkExtendedEdge[] = [];
  for (const edge of edges) {
    if (nodeIdSet.has(edge.source) && nodeIdSet.has(edge.target)) {
      elkEdges.push({
        id: edge.id,
        sources: [edge.source],
        targets: [edge.target],
      });
    }
  }

  return {
    id: "root",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": "DOWN",
      "elk.spacing.nodeNode": "60",
      "elk.layered.spacing.nodeNodeBetweenLayers": "80",
      "elk.hierarchyHandling": "INCLUDE_CHILDREN",
    },
    children: topLevelNodes,
    edges: elkEdges,
  };
}

/**
 * Walk the ELK result tree and produce flat React Flow nodes with
 * positioned coordinates and group sizing.
 */
function elkResultToFlat(
  elkRoot: ElkNode,
  originalNodes: Node[],
): Node[] {
  const originalMap = new Map(originalNodes.map((n) => [n.id, n]));
  const nodeIdSet = new Set(originalNodes.map((n) => n.id));
  const result: Node[] = [];

  function walk(elkNode: ElkNode, isChild: boolean, parentId?: string): void {
    const original = originalMap.get(elkNode.id);

    if (original) {
      const x = elkNode.x ?? 0;
      const y = elkNode.y ?? 0;

      if (isGroupNode(original)) {
        const w = elkNode.width ?? 0;
        const h = elkNode.height ?? 0;

        result.push({
          ...original,
          position: { x, y },
          zIndex: 0,
          style: { width: w, height: h },
          ...(isChild && parentId
            ? { parentId, extent: "parent" as const }
            : {}),
        });
      } else if (isChild && parentId) {
        result.push({
          ...original,
          position: { x, y },
          zIndex: 10,
          parentId,
          extent: "parent" as const,
        });
      } else {
        result.push({
          ...original,
          position: { x, y },
        });
      }
    }

    if (elkNode.children) {
      for (const child of elkNode.children) {
        const childOriginal = originalMap.get(child.id);
        const childParentId =
          childOriginal && original ? original.id : parentId;
        const childIsChild =
          childOriginal?.parentId !== undefined &&
          nodeIdSet.has(childOriginal.parentId ?? "");

        walk(child, childIsChild, childParentId);
      }
    }
  }

  if (elkRoot.children) {
    for (const topChild of elkRoot.children) {
      walk(topChild, false);
    }
  }

  return result;
}

/**
 * Applies ELK layered layout to React Flow nodes and edges.
 * Supports nested epic bounding boxes: group nodes (epics) contain
 * child nodes, and ELK computes their sizes and positions automatically.
 *
 * Because elk.layout() is async, this hook uses useState/useEffect
 * internally but preserves the original synchronous return signature.
 */
export function useGraphLayout(
  rawNodes: Node[],
  rawEdges: Edge[],
): LayoutResult {
  const [result, setResult] = useState<LayoutResult>({
    nodes: [],
    edges: [],
  });

  useEffect(() => {
    if (rawNodes.length === 0) {
      setResult({ nodes: [], edges: [] });
      return;
    }

    let cancelled = false;

    const elkGraph = flatToElkGraph(rawNodes, rawEdges);
    elk
      .layout(elkGraph)
      .then((layoutResult) => {
        if (cancelled) return;
        const nodes = elkResultToFlat(layoutResult, rawNodes);
        setResult({ nodes, edges: rawEdges });
      })
      .catch((err) => {
        console.error("ELK layout failed:", err);
      });

    return () => {
      cancelled = true;
    };
  }, [rawNodes, rawEdges]);

  return result;
}
