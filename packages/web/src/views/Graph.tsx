import { useState, useMemo, useCallback } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useTasks, trpc } from "@praxis2/hooks";
import { TaskNode } from "../components/graph/TaskNode.js";
import { EpicGroupNode } from "../components/graph/EpicGroupNode.js";
import { buildGraphData } from "../components/graph/buildGraphData.js";
import { useGraphLayout } from "../components/graph/useGraphLayout.js";
import { TaskEditorModal } from "../components/TaskEditorModal.js";
import { TaskCreatorModal } from "../components/TaskCreatorModal.js";
import { FilterBar } from "../components/FilterBar.js";
import { useTaskFilters, applyTaskFilters } from "../contexts/TaskFilterContext.js";
import { STATUS_COLORS } from "../lib/taskConstants.js";

const nodeTypes = { task: TaskNode, group: EpicGroupNode };

type GraphProps = {
  repoId: string | null;
};

export function Graph({ repoId }: GraphProps) {
  const { tasks, isLoading, error } = useTasks(repoId);
  const depsQuery = trpc.task.listDependencies.useQuery({ repoId });
  const filters = useTaskFilters();
  const filteredTasks = useMemo(
    () => applyTaskFilters(tasks, filters),
    [tasks, filters.status, filters.type, filters.epicId, filters.ideaId],
  );
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [showCreator, setShowCreator] = useState(false);
  const [creatorIsEpic, setCreatorIsEpic] = useState(false);

  const handleClickNode = useCallback((id: string) => setSelectedTaskId(id), []);

  const isAllRepos = repoId === null;

  const { rawNodes, rawEdges } = useMemo(() => {
    const { nodes, edges } = buildGraphData(
      filteredTasks,
      depsQuery.data ?? [],
      {
        repoColor: isAllRepos,
        onClickNode: handleClickNode,
      },
    );
    return { rawNodes: nodes, rawEdges: edges };
  }, [filteredTasks, depsQuery.data, handleClickNode, isAllRepos]);

  const { nodes, edges } = useGraphLayout(rawNodes, rawEdges);

  if (error) {
    return (
      <div className="bg-red-50 text-red-600 p-3 rounded m-4">{error}</div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border-primary)]">
        <h1 className="text-lg font-bold">Graph</h1>
        <div className="flex gap-2">
          <button
            className="px-3 py-1.5 text-xs bg-[var(--accent)] text-white rounded hover:bg-[var(--accent-hover)] cursor-pointer disabled:opacity-60"
            disabled={!repoId}
            onClick={() => {
              setCreatorIsEpic(true);
              setShowCreator(true);
            }}
          >
            + Epic
          </button>
          <button
            className="px-3 py-1.5 text-xs border border-[var(--border-secondary)] rounded hover:bg-[var(--bg-secondary)] cursor-pointer disabled:opacity-60"
            disabled={!repoId}
            onClick={() => {
              setCreatorIsEpic(false);
              setShowCreator(true);
            }}
          >
            + Task
          </button>
        </div>
      </div>

      <FilterBar tasks={tasks} />

      {/* Graph */}
      {isLoading ? (
        <p className="text-[var(--text-faint)] text-center p-8">Loading...</p>
      ) : tasks.length === 0 ? (
        <p className="text-[var(--text-faint)] text-center p-8">
          No tasks yet. Create an epic or task to get started.
        </p>
      ) : filteredTasks.length === 0 ? (
        <p className="text-[var(--text-faint)] text-center p-8">
          No tasks match the current filters.
        </p>
      ) : (
        <div className="flex-1">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            fitView
            colorMode="light"
            proOptions={{ hideAttribution: true }}
          >
            <Background />
            <Controls />
            <MiniMap
              nodeColor={(node) => {
                const data = node.data as Record<string, unknown>;
                if (node.type === "group") return "#A5B4FC";
                if (isAllRepos && data?.repoColor) {
                  return data.repoColor as string;
                }
                const status = data?.status;
                return STATUS_COLORS[status as string] ?? "#9CA3AF";
              }}
            />
          </ReactFlow>
        </div>
      )}

      {/* Task editor modal */}
      {selectedTaskId && (
        <TaskEditorModal
          taskId={selectedTaskId}
          repoId={repoId}
          onClose={() => setSelectedTaskId(null)}
        />
      )}

      {/* Task creator modal */}
      {showCreator && repoId && (
        <TaskCreatorModal
          repoId={repoId}
          isEpic={creatorIsEpic}
          onClose={() => setShowCreator(false)}
        />
      )}
    </div>
  );
}
