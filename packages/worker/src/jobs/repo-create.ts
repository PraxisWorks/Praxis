import { spawn } from "node:child_process";
import { existsSync, rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { syncChannel } from "@praxis2/shared";
import { rigs, organizations } from "@praxis2/api/schema";
import { getLogger } from "../logger.js";
import { getConfig } from "../config.js";
import { getDb } from "../db.js";
import { buildChildEnv } from "../child-env.js";
import type { WorkerConnection } from "../connection/index.js";

/** Lazy — evaluated after config is initialized, not at import time. */
const getExecEnv = () => buildChildEnv();

interface CommandResult {
  success: boolean;
  output: string;
  error?: string;
  exitCode: number;
}

export function executeCommand(
  executable: string,
  args: string[],
  opts: { cwd: string; env?: NodeJS.ProcessEnv; timeout?: number; label?: string },
): Promise<CommandResult> {
  const logger = getLogger();
  const label = opts.label ?? executable;

  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd: opts.cwd,
      env: opts.env ?? getExecEnv(),
      stdio: ["ignore", "pipe", "pipe"],
    });

    const stdout: string[] = [];
    const stderr: string[] = [];
    let killed = false;

    const timer = opts.timeout
      ? setTimeout(() => {
          killed = true;
          child.kill("SIGTERM");
        }, opts.timeout)
      : null;

    child.stdout.on("data", (chunk: Buffer) => {
      const lines = chunk.toString().split("\n").filter(Boolean);
      for (const line of lines) {
        stdout.push(line);
        logger.info({ label }, `[${label}] ${line}`);
      }
    });

    child.stderr.on("data", (chunk: Buffer) => {
      const lines = chunk.toString().split("\n").filter(Boolean);
      for (const line of lines) {
        stderr.push(line);
        logger.warn({ label }, `[${label}] ${line}`);
      }
    });

    child.on("error", (err) => {
      if (timer) clearTimeout(timer);
      reject(err);
    });

    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      const exitCode = code ?? 1;
      const result: CommandResult = {
        success: exitCode === 0,
        output: stdout.join("\n"),
        error: stderr.length ? stderr.join("\n") : undefined,
        exitCode,
      };

      if (killed) {
        reject(new Error(`${label} timed out after ${opts.timeout}ms`));
      } else if (exitCode !== 0) {
        const err = new Error(`${label} exited with code ${exitCode}: ${result.error ?? result.output}`);
        reject(err);
      } else {
        resolve(result);
      }
    });
  });
}

/**
 * Poll until a newly-created template repo has at least one commit.
 * GitHub copies template files asynchronously; cloning too early yields an empty repo.
 * We check for commits (not .size, which GitHub computes lazily and stays 0).
 */
async function waitForRepo(
  nwo: string,
  logger: ReturnType<typeof getLogger>,
  maxAttempts = 30,
  intervalMs = 2_000,
): Promise<void> {
  for (let i = 1; i <= maxAttempts; i++) {
    try {
      // List commits on default branch — returns non-empty array once template is copied
      await executeCommand("gh", [
        "api", `repos/${nwo}/commits`, "--jq", ".[0].sha",
      ], { cwd: "/tmp", timeout: 10_000, label: "gh-poll" });

      // If we got here without throwing, there's at least one commit
      logger.info({ nwo, attempt: i }, "Template repo ready");
      return;
    } catch {
      // 409 Conflict (empty repo) or other error — not ready yet
    }

    logger.info({ nwo, attempt: i, maxAttempts }, "Template repo not ready, waiting...");
    await new Promise((r) => setTimeout(r, intervalMs));
  }

  throw new Error(`Template repo ${nwo} not ready after ${maxAttempts} attempts`);
}

export async function registerRepoCreateHandler(
  connection: WorkerConnection,
  queueName: string,
): Promise<void> {
  const logger = getLogger();

  await connection.onJob<{ repoId: string }>(queueName, async (job) => {
    const { repoId } = job.data;
    const db = getDb();
    logger.info({ repoId, jobId: job.id }, "Processing repo.create job");

    try {
      // 1. Load repo from DB
      const [repo] = await db
        .select()
        .from(rigs)
        .where(eq(rigs.id, repoId))
        .limit(1);

      if (!repo) {
        throw new Error(`Repo ${repoId} not found`);
      }

      // Load org to check for template overrides
      const [org] = await db
        .select()
        .from(organizations)
        .where(eq(organizations.id, repo.orgId))
        .limit(1);

      const config = getConfig();
      const { WORKSPACE_ROOT } = config;
      const repoName = repo.name;
      // Canonical clone layout: WORKSPACE_ROOT/{repoId}/repo
      // Must match getRepoCloneDir() in workspace-manager.ts so that
      // session-start finds the existing clone instead of re-cloning.
      const repoBaseDir = join(WORKSPACE_ROOT, repoId);
      const repoDir = join(repoBaseDir, "repo");

      // 3. Clean up stale directory from a previous failed attempt
      if (existsSync(repoBaseDir)) {
        logger.warn({ repoId, repoBaseDir }, "Removing stale workspace directory");
        rmSync(repoBaseDir, { recursive: true, force: true });
      }
      mkdirSync(repoBaseDir, { recursive: true });

      // Determine code path: repo.repo set = adding existing repo (+Add),
      // repo.repo null = new project from template (+New).
      // Template + init-script resolution only happens for +New. +Add
      // never needs a template because the user's providing the repo
      // URL directly.
      const isExistingRepo = !!repo.repo;
      let nwo: string;
      let initScripts: string[] = [];

      if (isExistingRepo) {
        // Normalize: strip GitHub URL prefix and trailing slash
        nwo = repo.repo!
          .replace(/^https?:\/\/github\.com\//, "")
          .replace(/\/+$/, "");
        logger.info({ repoId, repo: nwo }, "Adding existing repo");
      } else {
        // Resolve template repo: org override -> worker env fallback -> error
        let ghOrg: string;
        let templateRepo: string;
        if (org?.templateRepo) {
          const parts = org.templateRepo.split("/");
          ghOrg = parts[0];
          templateRepo = parts[1];
          logger.info({ repoId, source: "org" }, `Using org template: ${org.templateRepo}`);
        } else if (config.GH_ORG && config.TEMPLATE_REPO) {
          ghOrg = config.GH_ORG;
          templateRepo = config.TEMPLATE_REPO;
          logger.info({ repoId, source: "worker-env" }, `Using worker-env template: ${ghOrg}/${templateRepo}`);
        } else {
          throw new Error(
            "No template configured for this organization. Set a template repo in Org Settings, or use +Add to connect an existing repo instead.",
          );
        }

        // Resolve init scripts for template-based creation. Templates that
        // want a post-clone script must set it at the org level explicitly —
        // there is no hardcoded default, so templates with no init script
        // just work.
        initScripts = (org?.initScripts as string[] | null) ?? [];

        // 4. Create repo from template
        nwo = `${ghOrg}/${repoName}`;
        logger.info({ repoId, repo: nwo }, "Creating GitHub repo from template");
        await executeCommand("gh", [
          "repo", "create", nwo,
          "--template", `${ghOrg}/${templateRepo}`,
          "--private",
        ], { cwd: repoBaseDir, timeout: 60_000, label: "gh" });

        // 4b. Wait for GitHub to finish copying template contents
        logger.info({ repoId }, "Waiting for template to be ready");
        await waitForRepo(nwo, logger);
      }

      // 5. Clone via SSH into the canonical {repoId}/repo path. Cloning
      // with cwd=repoBaseDir and target="repo" creates {repoId}/repo/.git,
      // matching what workspace-manager.ts:getRepoCloneDir expects so
      // session-start can find this clone instead of re-cloning.
      const sshUrl = `git@github.com:${nwo}.git`;
      logger.info({ repoId, sshUrl }, "Cloning repo via SSH");
      await executeCommand("git", ["clone", sshUrl, "repo"], {
        cwd: repoBaseDir,
        timeout: 120_000,
        label: "git-clone",
      });

      // 6. Run init scripts — only for new projects created from template
      if (!isExistingRepo) {
        for (const script of initScripts) {
          if (!script.startsWith("./scripts/") || script.includes("..")) {
            logger.warn({ repoId, script }, "Skipping unsafe init script path");
            continue;
          }
          // Skip (with a warning) if the template doesn't contain the
          // script. This makes "bring your own template" forgiving —
          // a template that doesn't happen to ship scripts/init.sh
          // won't fail the whole repo-create job.
          const resolvedScript = join(repoDir, script);
          if (!existsSync(resolvedScript)) {
            logger.warn(
              { repoId, script, resolvedScript },
              "Init script not found in template; skipping",
            );
            continue;
          }
          logger.info({ repoId, repoDir, script }, `Running init script: ${script}`);
          await executeCommand(script, [repoName], {
            cwd: repoDir,
            timeout: 300_000,
            label: script,
          });
        }
      }

      // 7. Run build-device.sh if present (non-fatal — repo still goes active)
      const buildDeviceSh = join(repoDir, "scripts", "build-device.sh");
      if (existsSync(buildDeviceSh)) {
        try {
          logger.info({ repoId, repoDir }, "Running build-device.sh");
          await executeCommand("./scripts/build-device.sh", [], {
            cwd: repoDir,
            timeout: 300_000,
            label: "build-device",
          });
        } catch (err) {
          logger.warn({ repoId, err }, "build-device.sh failed (non-fatal)");
        }
      }

      // 8. Update repo record
      const [updated] = await db
        .update(rigs)
        .set({
          repo: nwo,
          // Informational only — consumers must compute paths from
          // WORKSPACE_ROOT + repo.name, not read this value.
          workspacePath: repoDir,
          status: "active",
          updatedAt: new Date(),
        })
        .where(eq(rigs.id, repoId))
        .returning();

      // 9. Publish sync event with full repo object
      await connection.publishSync(syncChannel("repo"), {
        action: "updated",
        data: updated,
        timestamp: Date.now(),
      });

      logger.info({ repoId, repo: nwo }, "Repo creation completed");
    } catch (error) {
      logger.error({ repoId, err: error }, "Repo creation failed");

      await db
        .update(rigs)
        .set({ status: "error", updatedAt: new Date() })
        .where(eq(rigs.id, repoId));

      await connection.publishSync(syncChannel("repo"), {
        action: "updated",
        data: { id: repoId, status: "error" },
        timestamp: Date.now(),
      });

      throw error;
    }
  });
}
