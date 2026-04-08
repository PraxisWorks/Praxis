#!/usr/bin/env node
export {};

console.error("Warning: px is deprecated, use praxis instead");

const [cmd, sub, ...rest] = process.argv.slice(2);

// Delegate to the same direct-DB handlers that praxis.ts uses
if (cmd === "plan" && sub === "create") {
  const { planCreate } = await import("./plan-create.js");
  await planCreate(rest);
} else if (cmd === "task" && sub === "start") {
  const { taskStart } = await import("./task-start.js");
  await taskStart(rest);
} else if (cmd === "task" && sub === "complete") {
  const { taskComplete } = await import("./task-complete.js");
  await taskComplete(rest);
} else if (cmd === "task" && sub === "show") {
  const { taskShow } = await import("./task-show.js");
  await taskShow(rest);
} else if (cmd === "task" && sub === "list") {
  const { taskList } = await import("./task-list.js");
  await taskList(rest);
} else if (cmd === "task" && sub === "ready") {
  const { taskReady } = await import("./task-ready.js");
  await taskReady(rest);
} else if (cmd === "task" && sub === "create") {
  const { taskCreate } = await import("./task-create.js");
  await taskCreate(rest);
} else if (cmd === "epic" && sub === "complete") {
  const { epicComplete } = await import("./epic-complete.js");
  await epicComplete(rest);
} else if (cmd === "phase" && sub === "save") {
  const { phaseSave } = await import("./phase-save.js");
  await phaseSave(rest);
} else if (cmd === "idea" && sub === "create") {
  const { ideaCreate } = await import("./idea-create.js");
  await ideaCreate(rest);
} else if (cmd === "idea" && sub === "reconcile") {
  const { ideaReconcile } = await import("./idea-reconcile.js");
  await ideaReconcile(rest);
} else if (cmd === "ask") {
  const { ask } = await import("./ask.js");
  await ask([sub, ...rest].filter(Boolean));
} else {
  console.error("Usage: praxis <command> (px is deprecated)");
  process.exit(1);
}
