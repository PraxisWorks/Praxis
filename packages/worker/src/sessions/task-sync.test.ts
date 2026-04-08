import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const EXEC_ENV = {
  ...process.env,
  PATH: `/opt/homebrew/bin:/usr/local/bin:${process.env.PATH}`,
  BD_ACTOR: "test",
};

/** Check whether the `bd` CLI is available on PATH. */
function hasBd(): boolean {
  try {
    execSync("bd --version", { stdio: "pipe", timeout: 5_000, env: EXEC_ENV });
    return true;
  } catch {
    return false;
  }
}

function bd(cmd: string, cwd: string): string {
  return execSync(`bd ${cmd}`, {
    cwd,
    stdio: "pipe",
    timeout: 30_000,
    env: EXEC_ENV,
  }).toString();
}

/**
 * Integration tests verifying the task-sync pattern:
 *   1. Pre-delete via `bd sql DELETE`
 *   2. Import via `bd import -i <file>`
 *   3. Wire parent-child via `bd update --parent`
 *   4. Wire blocking deps via `bd dep --blocks`
 *
 * These tests exercise real `bd` commands against a temp directory.
 * Skipped when `bd` is not installed (e.g. CI).
 */
describe.skipIf(!hasBd())("task-sync: delete → import → parent → dep", { timeout: 30_000 }, () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "task-sync-test-"));
    execSync("git init", { cwd: tempDir, stdio: "pipe" });
    bd("init --prefix TST --force --quiet", tempDir);
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("imports a single task via JSONL", () => {
    const jsonl = JSON.stringify({
      id: "TST-abc01",
      title: "Fix login bug",
      description: "Users can't log in with email",
      status: "open",
      priority: 1,
      issue_type: "task",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    const tmpFile = join(tempDir, "import.jsonl");
    writeFileSync(tmpFile, jsonl);
    bd(`import -i ${tmpFile} --json`, tempDir);

    const output = bd("show TST-abc01", tempDir);
    expect(output).toContain("TST-abc01");
    expect(output).toContain("Fix login bug");
  });

  it("imports epic + children, wires parent-child, bd show --children works", () => {
    const now = new Date().toISOString();

    const lines = [
      { id: "TST-epic1", title: "Auth System", description: "Complete auth", status: "open", priority: 1, issue_type: "epic", created_at: now, updated_at: now },
      { id: "TST-task1", title: "Login endpoint", description: "POST /auth/login", status: "open", priority: 1, issue_type: "task", created_at: now, updated_at: now },
      { id: "TST-task2", title: "Logout endpoint", description: "POST /auth/logout", status: "open", priority: 2, issue_type: "task", created_at: now, updated_at: now },
    ];

    const tmpFile = join(tempDir, "import.jsonl");
    writeFileSync(tmpFile, lines.map((l) => JSON.stringify(l)).join("\n"));

    // Step 2: Import
    bd(`import -i ${tmpFile} --json`, tempDir);

    // Step 3: Wire parent-child
    bd("update TST-task1 --parent TST-epic1 --quiet", tempDir);
    bd("update TST-task2 --parent TST-epic1 --quiet", tempDir);

    // Verify children
    const childrenOutput = bd("show TST-epic1 --children", tempDir);
    expect(childrenOutput).toContain("TST-task1");
    expect(childrenOutput).toContain("TST-task2");
    expect(childrenOutput).toContain("Login endpoint");
    expect(childrenOutput).toContain("Logout endpoint");
  });

  it("wires blocking deps, bd ready excludes blocked tasks", () => {
    const now = new Date().toISOString();

    const lines = [
      { id: "TST-dep-e", title: "Deploy Feature", status: "open", priority: 1, issue_type: "epic", created_at: now, updated_at: now },
      { id: "TST-dep-a", title: "Write migrations", status: "open", priority: 1, issue_type: "task", created_at: now, updated_at: now },
      { id: "TST-dep-b", title: "Run migrations", status: "open", priority: 1, issue_type: "task", created_at: now, updated_at: now },
    ];

    const tmpFile = join(tempDir, "import.jsonl");
    writeFileSync(tmpFile, lines.map((l) => JSON.stringify(l)).join("\n"));

    // Step 2: Import
    bd(`import -i ${tmpFile} --json`, tempDir);

    // Step 3: Wire parent-child
    bd("update TST-dep-a --parent TST-dep-e --quiet", tempDir);
    bd("update TST-dep-b --parent TST-dep-e --quiet", tempDir);

    // Step 4: Wire blocking dep (task-a blocks task-b)
    bd("dep TST-dep-a --blocks TST-dep-b --quiet", tempDir);

    // bd ready should show task-a (not blocked) but NOT task-b (blocked by task-a)
    const readyOutput = bd("ready", tempDir);
    expect(readyOutput).toContain("TST-dep-a");
    expect(readyOutput).not.toContain("TST-dep-b");
  });

  it("is idempotent via delete-then-import", () => {
    const now = new Date().toISOString();
    const line = { id: "TST-idem1", title: "Idempotent task", status: "open", priority: 2, issue_type: "task", created_at: now, updated_at: now };

    const tmpFile = join(tempDir, "import.jsonl");
    writeFileSync(tmpFile, JSON.stringify(line));

    // First import
    bd(`import -i ${tmpFile} --json`, tempDir);

    // Pre-delete + re-import (idempotent)
    bd(`sql "DELETE FROM issues WHERE id IN ('TST-idem1')"`, tempDir);
    bd(`import -i ${tmpFile} --json`, tempDir);

    const output = bd("show TST-idem1", tempDir);
    expect(output).toContain("TST-idem1");
    expect(output).toContain("Idempotent task");
  });

  it("preserves parent-child after delete-then-reimport cycle", () => {
    const now = new Date().toISOString();

    const lines = [
      { id: "TST-re-e", title: "Re-epic", status: "open", priority: 1, issue_type: "epic", created_at: now, updated_at: now },
      { id: "TST-re-t", title: "Re-task", status: "open", priority: 2, issue_type: "task", created_at: now, updated_at: now },
    ];

    const tmpFile = join(tempDir, "import.jsonl");
    writeFileSync(tmpFile, lines.map((l) => JSON.stringify(l)).join("\n"));

    // First cycle: import + wire
    bd(`import -i ${tmpFile} --json`, tempDir);
    bd("update TST-re-t --parent TST-re-e --quiet", tempDir);

    let children = bd("show TST-re-e --children", tempDir);
    expect(children).toContain("TST-re-t");

    // Second cycle: delete + reimport + re-wire
    bd(`sql "DELETE FROM issues WHERE id IN ('TST-re-e', 'TST-re-t')"`, tempDir);
    bd(`import -i ${tmpFile} --json`, tempDir);
    bd("update TST-re-t --parent TST-re-e --quiet", tempDir);

    children = bd("show TST-re-e --children", tempDir);
    expect(children).toContain("TST-re-t");
    expect(children).toContain("Re-task");
  });
});
