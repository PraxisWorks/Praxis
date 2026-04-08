import type { Node, Edge } from "@xyflow/react";

type Task = {
  id: string;
  title: string;
  status: string;
  priority: string;
  isEpic: boolean;
  parentId: string | null;
  taskId: string | null;
  repoColor?: string | null;
  repoIcon?: string | null;
};

type Dependency = {
  taskId: string;
  dependsOnId: string;
};

type BuildGraphConfig = {
  repoColor?: boolean;
  onClickNode: (id: string) => void;
  onStartWork?: (id: string) => void;
  onStartDebug?: (id: string) => void;
};

/**
 * Builds React Flow nodes and edges from task data.
 *
 * Epics become group nodes; leaf tasks become task nodes parented to their
 * epic when applicable.  Only dependency edges are emitted -- parent/child
 * relationships are expressed via React Flow's built-in grouping.
 *
 * Group (parent) nodes are always placed before their children in the
 * returned array, as React Flow requires.
 */
export function buildGraphData(
  tasks: Task[],
  deps: Dependency[],
  config: BuildGraphConfig,
): { nodes: Node[]; edges: Edge[] } {
  const taskIdsInSet = new Set(tasks.map((b) => b.id));

  const epicMap = new Map<string, Task>();
  const leafTasks: Task[] = [];

  for (const task of tasks) {
    if (task.isEpic) {
      epicMap.set(task.id, task);
    } else {
      leafTasks.push(task);
    }
  }

  // -- Group nodes (epics) ----------------------------------------------------

  const groupNodes: Node[] = [];

  for (const epic of epicMap.values()) {
    const parentIsEpicInSet =
      epic.parentId !== null && epicMap.has(epic.parentId);

    groupNodes.push({
      id: epic.id,
      type: "group",
      position: { x: 0, y: 0 },
      ...(parentIsEpicInSet
        ? { parentId: epic.parentId!, extent: "parent" as const }
        : {}),
      data: {
        label: epic.title,
        taskId: epic.taskId,
        isTopLevel: epic.parentId === null || !taskIdsInSet.has(epic.parentId),
        onClickNode: config.onClickNode,
      },
    });
  }

  // -- Task nodes (leaves) ----------------------------------------------------

  const taskNodes: Node[] = [];

  for (const task of leafTasks) {
    const parentIsEpicInSet =
      task.parentId !== null && epicMap.has(task.parentId);

    taskNodes.push({
      id: task.id,
      type: "task",
      position: { x: 0, y: 0 },
      ...(parentIsEpicInSet
        ? { parentId: task.parentId!, extent: "parent" as const }
        : {}),
      data: {
        label: task.title,
        status: task.status,
        priority: task.priority,
        taskId: task.taskId,
        repoColor: config.repoColor ? (task.repoColor ?? undefined) : undefined,
        repoIcon: config.repoColor ? (task.repoIcon ?? undefined) : undefined,
        onClickNode: config.onClickNode,
        onStartWork: config.onStartWork,
        onStartDebug: config.onStartDebug,
      },
    });
  }

  // Groups first, then leaves -- React Flow requires parents before children.
  const nodes: Node[] = [...groupNodes, ...taskNodes];

  // -- Dependency edges -------------------------------------------------------

  const edges: Edge[] = [];

  for (const dep of deps) {
    if (taskIdsInSet.has(dep.taskId) && taskIdsInSet.has(dep.dependsOnId)) {
      edges.push({
        id: `dep-${dep.taskId}-${dep.dependsOnId}`,
        source: dep.dependsOnId,
        target: dep.taskId,
        animated: true,
        style: { stroke: "#6366F1" },
        type: "default",
      });
    }
  }

  return { nodes, edges };
}
