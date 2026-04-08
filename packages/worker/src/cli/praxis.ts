#!/usr/bin/env node
import { praxisLogin } from "./praxis-login.js";
import { praxisStart } from "./praxis-start.js";
import { praxisStop } from "./praxis-stop.js";
import { praxisStatus } from "./praxis-status.js";
import { praxisUpdate } from "./praxis-update.js";
import { runLogout } from "./praxis-logout.js";

// Injected at build time by tsup `define`
declare const __PRAXIS_VERSION__: string;
const version = typeof __PRAXIS_VERSION__ !== "undefined" ? __PRAXIS_VERSION__ : "dev";

const [cmd, ...rest] = process.argv.slice(2);

// ── px-domain commands that require a worker session context ──────
const PX_DOMAINS = new Set(["task", "epic", "plan", "phase", "idea", "ask"]);

function printHelp(): void {
  console.log(`praxis v${version}`);
  console.log();
  console.log("Usage:");
  console.log("  User commands:");
  console.log("    praxis login --token <token> --name <name> --url <api-url>");
  console.log("    praxis logout");
  console.log("    praxis start");
  console.log("    praxis stop");
  console.log("    praxis status");
  console.log("    praxis update [--check]");
  console.log();
  console.log("  Session commands (require worker context):");
  console.log("    praxis task start|complete|show|list|ready|create [args]");
  console.log("    praxis epic complete <epicId>");
  console.log('    praxis plan create <ideaId> -f <proposal.json>');
  console.log("    praxis phase save <ideaId> --phase <N> --name <name> -f <file>");
  console.log("    praxis idea create|reconcile [args]");
  console.log('    praxis ask --question <text> --header <label> --option "Label::Desc" [...]');
  console.log();
  console.log("  praxis --version");
}

if (cmd === "login") {
  await praxisLogin(rest);
} else if (cmd === "logout") {
  await runLogout();
} else if (cmd === "start") {
  await praxisStart(rest);
} else if (cmd === "stop") {
  await praxisStop(rest);
} else if (cmd === "status") {
  await praxisStatus(rest);
} else if (cmd === "update") {
  await praxisUpdate(rest);
} else if (cmd === "--version" || cmd === "-v") {
  console.log(`praxis v${version}`);
} else if (cmd && PX_DOMAINS.has(cmd)) {
  // ── Auth guard ───────────────────────────────────────────────────
  if (!process.env.DATABASE_URL) {
    const { populateEnvFromConfig } = await import("./praxis-config.js");
    const result = await populateEnvFromConfig();
    if (!result.ok) {
      console.error("Not logged in. Run `praxis login` first.");
      process.exit(1);
    }
  }

  const [sub, ...subArgs] = rest;

  // ── px-domain dispatch (direct-DB only, lazy imports) ────────────
  if (cmd === "plan" && sub === "create") {
    const { planCreate } = await import("./plan-create.js");
    await planCreate(subArgs);
  } else if (cmd === "task" && sub === "start") {
    const { taskStart } = await import("./task-start.js");
    await taskStart(subArgs);
  } else if (cmd === "task" && sub === "complete") {
    const { taskComplete } = await import("./task-complete.js");
    await taskComplete(subArgs);
  } else if (cmd === "task" && sub === "show") {
    const { taskShow } = await import("./task-show.js");
    await taskShow(subArgs);
  } else if (cmd === "task" && sub === "list") {
    const { taskList } = await import("./task-list.js");
    await taskList(subArgs);
  } else if (cmd === "task" && sub === "ready") {
    const { taskReady } = await import("./task-ready.js");
    await taskReady(subArgs);
  } else if (cmd === "task" && sub === "create") {
    const { taskCreate } = await import("./task-create.js");
    await taskCreate(subArgs);
  } else if (cmd === "epic" && sub === "complete") {
    const { epicComplete } = await import("./epic-complete.js");
    await epicComplete(subArgs);
  } else if (cmd === "phase" && sub === "save") {
    const { phaseSave } = await import("./phase-save.js");
    await phaseSave(subArgs);
  } else if (cmd === "idea" && sub === "create") {
    const { ideaCreate } = await import("./idea-create.js");
    await ideaCreate(subArgs);
  } else if (cmd === "idea" && sub === "reconcile") {
    const { ideaReconcile } = await import("./idea-reconcile.js");
    await ideaReconcile(subArgs);
  } else if (cmd === "ask") {
    const { ask } = await import("./ask.js");
    await ask(rest); // ask takes raw args (no sub extraction)
  } else {
    printHelp();
    process.exit(1);
  }
} else {
  printHelp();
  if (cmd !== "--help" && cmd !== "-h" && cmd !== undefined) process.exit(1);
}
