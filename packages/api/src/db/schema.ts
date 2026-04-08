import { boolean, pgTable, pgEnum, uuid, varchar, timestamp, uniqueIndex, text, integer, jsonb, primaryKey, type AnyPgColumn } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// ── Organizations ─────────────────────────────────────────────────

export const orgRoleEnum = pgEnum("org_role", ["owner", "admin", "member"]);

export const invitationStatusEnum = pgEnum("invitation_status", ["pending", "accepted", "revoked", "expired"]);

export const workerPolicyEnum = pgEnum("worker_policy", ["user_default", "require_local", "central_worker"]);

export const organizations = pgTable("organizations", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: varchar("name", { length: 100 }).notNull(),
  slug: varchar("slug", { length: 50 }).notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  workerPolicy: workerPolicyEnum("worker_policy").default("user_default").notNull(),
  centralWorkerId: uuid("central_worker_id")
    .references((): AnyPgColumn => workers.id, { onDelete: "set null" }),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  aiInstructionsWorking: text("ai_instructions_working"),
  aiInstructionsSpec: text("ai_instructions_spec"),
  aiInstructionsArchitecture: text("ai_instructions_architecture"),
  aiInstructionsDebug: text("ai_instructions_debug"),
  aiInstructionsRepo: text("ai_instructions_repo"),
  systemInstructionsWorking: text("system_instructions_working"),
  systemInstructionsSpec: text("system_instructions_spec"),
  systemInstructionsArchitecture: text("system_instructions_architecture"),
  systemInstructionsDebug: text("system_instructions_debug"),
  systemInstructionsRepo: text("system_instructions_repo"),
  templateRepo: varchar("template_repo", { length: 500 }),
  initScripts: jsonb("init_scripts"),
});

export const orgMembers = pgTable("org_members", {
  orgId: uuid("org_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  role: orgRoleEnum("role").notNull().default("member"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
}, (table) => ({
  pk: primaryKey({ columns: [table.orgId, table.userId] }),
}));

export const orgMemberWorkers = pgTable("org_member_workers", {
  orgId: uuid("org_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  userId: uuid("user_id")
    .notNull()
    .references((): AnyPgColumn => users.id, { onDelete: "cascade" }),
  workerId: uuid("worker_id")
    .references((): AnyPgColumn => workers.id, { onDelete: "set null" }),
}, (table) => ({
  pk: primaryKey({ columns: [table.orgId, table.userId] }),
}));

export const orgInvitations = pgTable("org_invitations", {
  id: uuid("id").defaultRandom().primaryKey(),
  orgId: uuid("org_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  email: varchar("email", { length: 255 }).notNull(),
  role: orgRoleEnum("role").notNull().default("member"),
  invitedBy: uuid("invited_by")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  status: invitationStatusEnum("status").notNull().default("pending"),
  expiresAt: timestamp("expires_at", { withTimezone: true })
    .notNull()
    .default(sql`now() + interval '7 days'`),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

// ── Users ─────────────────────────────────────────────────────────

export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  sub: varchar("sub", { length: 255 }).unique(),
  name: varchar("name", { length: 255 }).notNull(),
  email: varchar("email", { length: 255 }).notNull().unique(),
  role: varchar("role", { length: 50 }).notNull().default("user"),
  avatarUrl: varchar("avatar_url", { length: 500 }),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  pushOptOut: boolean("push_opt_out").notNull().default(false),
  theme: varchar("theme", { length: 10 }).notNull().default("light"),
  apiKeyHash: varchar("api_key_hash", { length: 255 }),
  roleId: uuid("role_id")
    .references((): AnyPgColumn => roles.id, { onDelete: "set null" }),
  activeWorkerId: uuid("active_worker_id")
    .references((): AnyPgColumn => workers.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const notifications = pgTable("notifications", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  repoId: uuid("repo_id")
    .references(() => repos.id, { onDelete: "cascade" }),
  title: varchar("title", { length: 255 }).notNull(),
  body: varchar("body", { length: 2000 }).notNull(),
  actionUrl: varchar("action_url", { length: 500 }),
  read: boolean("read").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const pushTokens = pgTable("push_tokens", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  token: varchar("token", { length: 255 }).notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

// ── Repos ────────────────────────────────────────────────────────────

export const repoStatusEnum = pgEnum("repo_status", [
  "creating",
  "active",
  "archived",
  "error",
]);

export const repos = pgTable("repos", {
  id: uuid("id").defaultRandom().primaryKey(),
  orgId: uuid("org_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 100 }).notNull(),
  repo: varchar("repo", { length: 500 }),
  bdPrefix: varchar("bd_prefix", { length: 4 }).notNull(),
  color: varchar("color", { length: 7 }).notNull(),
  icon: varchar("icon", { length: 50 }),
  description: varchar("description", { length: 1000 }),
  workspacePath: varchar("workspace_path", { length: 1000 }),
  status: repoStatusEnum("status").notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
}, (table) => ({
  uniqueOrgBdPrefix: uniqueIndex("uq_repos_org_bd_prefix").on(
    table.orgId,
    table.bdPrefix,
  ),
}));

// ── Specs ───────────────────────────────────────────────────────────

export const specs = pgTable("specs", {
  id: uuid("id").defaultRandom().primaryKey(),
  repoId: uuid("repo_id")
    .notNull()
    .references(() => repos.id, { onDelete: "cascade" })
    .unique(),
  title: varchar("title", { length: 255 }).notNull(),
  content: text("content").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

// ── Ideas ───────────────────────────────────────────────────────────

export const ideaStatusEnum = pgEnum("idea_status", [
  "new",
  "planning",
  "planned",
  "in_progress",
  "complete",
  "dismissed",
  "archived",
]);

export const ideaSourceEnum = pgEnum("idea_source", ["human", "ai"]);

export const ideaSizeEnum = pgEnum("idea_size", ["xs", "s", "m", "l", "xl"]);

export const ideas = pgTable("ideas", {
  id: uuid("id").defaultRandom().primaryKey(),
  repoId: uuid("repo_id")
    .notNull()
    .references(() => repos.id, { onDelete: "cascade" }),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  title: varchar("title", { length: 255 }).notNull(),
  description: text("description").notNull(),
  status: ideaStatusEnum("status").notNull().default("new"),
  source: ideaSourceEnum("source").notNull().default("human"),
  size: ideaSizeEnum("size"),
  tags: text("tags")
    .array()
    .notNull()
    .default([]),
  order: integer("order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

// ── Sessions ───────────────────────────────────────────────────────

export const sessionTypeEnum = pgEnum("session_type", [
  "spec",
  "architecture",
  "working",
  "debug",
  "repo",
]);

export const sessionStatusEnum = pgEnum("session_status", [
  "active",
  "paused",
  "completed",
  "error",
  "scheduled",
]);

export const sessionEntityTypeEnum = pgEnum("session_entity_type", [
  "repo",
  "idea",
  "epic",
  "task",
]);

export const messageRoleEnum = pgEnum("message_role", [
  "user",
  "assistant",
  "system",
]);

export const sessions = pgTable("sessions", {
  id: uuid("id").defaultRandom().primaryKey(),
  repoId: uuid("repo_id")
    .notNull()
    .references(() => repos.id, { onDelete: "cascade" }),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  type: sessionTypeEnum("type").notNull(),
  entityType: sessionEntityTypeEnum("entity_type"),
  entityId: uuid("entity_id"),
  // NOTE: entityId intentionally has no FK constraint. This is deliberate
  // denormalization — the target table varies by entityType (repos, ideas,
  // epics, tasks). Referential integrity is enforced at the application layer.
  title: varchar("title", { length: 255 }).notNull(),
  prompt: text("prompt"),
  status: sessionStatusEnum("status").notNull().default("active"),
  workerId: uuid("worker_id")
    .references(() => workers.id, { onDelete: "set null" }),
  claimedBy: uuid("claimed_by"),
  metadata: jsonb("metadata"),
  scheduledFor: timestamp("scheduled_for", { withTimezone: true }),
  jobId: text("job_id"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

// ── Session Messages ───────────────────────────────────────────────

export const sessionMessages = pgTable("session_messages", {
  id: uuid("id").defaultRandom().primaryKey(),
  sessionId: uuid("session_id")
    .notNull()
    .references(() => sessions.id, { onDelete: "cascade" }),
  role: messageRoleEnum("role").notNull(),
  content: text("content").notNull(),
  workerName: varchar("worker_name", { length: 100 }),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

// ── Session Attachments ───────────────────────────────────────────

export const sessionAttachments = pgTable("session_attachments", {
  id: uuid("id").defaultRandom().primaryKey(),
  sessionId: uuid("session_id")
    .notNull()
    .references(() => sessions.id, { onDelete: "cascade" }),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  filename: varchar("filename", { length: 255 }).notNull(),
  mimeType: varchar("mime_type", { length: 100 }).notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  storageKey: varchar("storage_key", { length: 1000 }).notNull(),
  messageId: uuid("message_id")
    .references(() => sessionMessages.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

// ── Idea Attachments ─────────────────────────────────────────────
export const ideaAttachments = pgTable("idea_attachments", {
  id: uuid("id").defaultRandom().primaryKey(),
  ideaId: uuid("idea_id")
    .notNull()
    .references(() => ideas.id, { onDelete: "cascade" }),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  filename: varchar("filename", { length: 255 }).notNull(),
  mimeType: varchar("mime_type", { length: 100 }).notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  storageKey: varchar("storage_key", { length: 1000 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

// ── Idea Phases ─────────────────────────────────────────────────
export const ideaPhases = pgTable("idea_phases", {
  id: uuid("id").defaultRandom().primaryKey(),
  ideaId: uuid("idea_id")
    .notNull()
    .references(() => ideas.id, { onDelete: "cascade" }),
  sessionId: uuid("session_id")
    .notNull()
    .references(() => sessions.id, { onDelete: "cascade" }),
  phaseNumber: integer("phase_number").notNull(),
  phaseName: varchar("phase_name", { length: 100 }).notNull(),
  content: text("content").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
}, (table) => ({
  uniqueIdeaSessionPhase: uniqueIndex("uq_idea_phases_idea_session_phase").on(
    table.ideaId,
    table.sessionId,
    table.phaseNumber,
  ),
}));

// ── Plans ─────────────────────────────────────────────────────────

export const planStatusEnum = pgEnum("plan_status", [
  "draft",
  "accepted",
  "rejected",
]);

export const plans = pgTable("plans", {
  id: uuid("id").defaultRandom().primaryKey(),
  ideaId: uuid("idea_id")
    .notNull()
    .references(() => ideas.id, { onDelete: "cascade" }),
  repoId: uuid("repo_id")
    .notNull()
    .references(() => repos.id, { onDelete: "cascade" }),
  sessionId: uuid("session_id")
    .notNull()
    .references(() => sessions.id, { onDelete: "cascade" }),
  proposal: jsonb("proposal").notNull(),
  status: planStatusEnum("status").notNull().default("draft"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

// ── Tasks ─────────────────────────────────────────────────────────

export const taskStatusEnum = pgEnum("task_status", [
  "draft",
  "approved",
  "in_progress",
  "blocked",
  "complete",
  "archived",
]);

export const taskPriorityEnum = pgEnum("task_priority", [
  "low",
  "medium",
  "high",
]);

export const tasks = pgTable("tasks", {
  id: uuid("id").defaultRandom().primaryKey(),
  repoId: uuid("repo_id")
    .notNull()
    .references(() => repos.id, { onDelete: "cascade" }),
  parentId: uuid("parent_id")
    .references((): AnyPgColumn => tasks.id, { onDelete: "set null" }),
  ideaId: uuid("idea_id")
    .references(() => ideas.id, { onDelete: "set null" }),
  title: varchar("title", { length: 500 }).notNull(),
  description: text("description").notNull(),
  notes: text("notes"),
  status: taskStatusEnum("status").notNull().default("draft"),
  priority: taskPriorityEnum("priority").notNull().default("medium"),
  isEpic: boolean("is_epic").notNull().default(false),
  taskId: varchar("task_id", { length: 50 }).unique(),
  statusChangedAt: timestamp("status_changed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

// ── Task Dependencies (join table) ────────────────────────────────

export const taskDependencies = pgTable("task_dependencies", {
  taskId: uuid("task_id")
    .notNull()
    .references(() => tasks.id, { onDelete: "cascade" }),
  dependsOnId: uuid("depends_on_id")
    .notNull()
    .references(() => tasks.id, { onDelete: "cascade" }),
}, (table) => ({
  pk: primaryKey({ columns: [table.taskId, table.dependsOnId] }),
}));

// ── Deployments ─────────────────────────────────────────────────────
export const deployments = pgTable("deployments", {
  id: uuid("id").defaultRandom().primaryKey(),
  service: varchar("service", { length: 20 }).notNull().unique(),
  gitSha: varchar("git_sha", { length: 40 }).notNull(),
  deployedAt: timestamp("deployed_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

// ── GitHub Webhook Configs ──────────────────────────────────────────
export const ghWebhookConfigs = pgTable("gh_webhook_configs", {
  id: uuid("id").defaultRandom().primaryKey(),
  repoId: uuid("repo_id")
    .notNull()
    .references(() => repos.id, { onDelete: "cascade" })
    .unique(),
  githubWebhookId: integer("github_webhook_id").notNull(),
  webhookSecret: varchar("webhook_secret", { length: 255 }).notNull(),
  repoOwner: varchar("repo_owner", { length: 255 }).notNull(),
  repoName: varchar("repo_name", { length: 255 }).notNull(),
  lastEtag: varchar("last_etag", { length: 255 }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

// ── GitHub Deployments ──────────────────────────────────────────────
export const ghDeployments = pgTable("gh_deployments", {
  id: uuid("id").defaultRandom().primaryKey(),
  repoId: uuid("repo_id")
    .notNull()
    .references(() => repos.id, { onDelete: "cascade" }),
  githubDeploymentId: varchar("github_deployment_id", { length: 50 }).notNull(),
  environment: varchar("environment", { length: 100 }).notNull(),
  status: varchar("status", { length: 50 }).notNull(),
  ref: varchar("ref", { length: 255 }).notNull(),
  description: varchar("description", { length: 1000 }),
  url: varchar("url", { length: 2000 }),
  creatorLogin: varchar("creator_login", { length: 255 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
}, (table) => ({
  uniqueRepoDeployment: uniqueIndex("uq_gh_deployments_repo_deployment").on(
    table.repoId,
    table.githubDeploymentId,
  ),
}));

// ── Workers ──────────────────────────────────────────────────────────

export const workerStatusEnum = pgEnum("worker_status", ["online", "offline"]);

export const workers = pgTable("workers", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 100 }).notNull(),
  status: workerStatusEnum("status").notNull().default("offline"),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  apiKeyId: uuid("api_key_id")
    .references((): AnyPgColumn => apiKeys.id, { onDelete: "set null" }),
  repoInitSettings: jsonb("repo_init_settings"),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const workerTokens = pgTable("worker_tokens", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  tokenHash: varchar("token_hash", { length: 255 }).notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  used: boolean("used").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

// ── API Keys (BYOK) ─────────────────────────────────────────────────
export const apiKeyStatusEnum = pgEnum("api_key_status", ["active", "provisioning", "error", "revoked"]);

export const apiKeys = pgTable("api_keys", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  label: varchar("label", { length: 100 }).notNull(),
  encryptedKey: text("encrypted_key").notNull(),
  keyLastFour: varchar("key_last_four", { length: 4 }).notNull(),
  status: apiKeyStatusEnum("status").notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

// ── Permission System ──────────────────────────────────────────────

export const roles = pgTable("roles", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: varchar("name", { length: 100 }).notNull().unique(),
  description: varchar("description", { length: 500 }),
  isSystem: boolean("is_system").notNull().default(false),
  maxActiveSessions: integer("max_active_sessions"),
  maxOrgMemberships: integer("max_org_memberships"),
  maxReposPerOrg: integer("max_repos_per_org"),
  maxIdeasPerRepo: integer("max_ideas_per_repo"),
  maxWorkers: integer("max_workers"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const permissions = pgTable("permissions", {
  id: uuid("id").defaultRandom().primaryKey(),
  key: varchar("key", { length: 100 }).notNull().unique(),
  description: varchar("description", { length: 500 }),
  category: varchar("category", { length: 50 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const rolePermissions = pgTable("role_permissions", {
  roleId: uuid("role_id")
    .notNull()
    .references(() => roles.id, { onDelete: "cascade" }),
  permissionKey: varchar("permission_key", { length: 100 })
    .notNull(),
}, (table) => ({
  pk: primaryKey({ columns: [table.roleId, table.permissionKey] }),
}));

export const userPermissionOverrides = pgTable("user_permission_overrides", {
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  permissionKey: varchar("permission_key", { length: 100 })
    .notNull(),
  granted: boolean("granted").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  pk: primaryKey({ columns: [table.userId, table.permissionKey] }),
}));


// ── System Settings ──────────────────────────────────────────────
export const systemSettings = pgTable("system_settings", {
  key: varchar("key", { length: 100 }).primaryKey(),
  value: text("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

// Partial unique index: only one non-rejected plan per idea.
// Drizzle does not support partial indexes natively -- add via raw SQL migration:
// CREATE UNIQUE INDEX plans_idea_id_non_rejected ON plans(idea_id) WHERE status != 'rejected';

// Partial unique index: only one pending invitation per (org, email).
// Drizzle does not support partial indexes natively -- add via raw SQL migration:
// CREATE UNIQUE INDEX org_invitations_org_email_pending ON org_invitations(org_id, email) WHERE status = 'pending';

// ── Backward compat alias ───────────────────────────────────────
export { repos as rigs };
