import postgres from "postgres";

type Handler = (data: unknown) => void;

export class PgPubSub {
  private sql: postgres.Sql;
  private channels = new Map<string, Set<Handler>>();
  private unlisteners = new Map<string, (() => Promise<void>)>();

  constructor(connectionString: string) {
    this.sql = postgres(connectionString, { max: 1 });
  }

  async publish(channel: string, data: unknown): Promise<void> {
    let payload = JSON.stringify(data);

    // pg_notify has an ~8 KB hard limit.  When the full payload exceeds the
    // safe threshold, strip `data` down to its scalar (non-object/array)
    // properties so routing fields like id / repoId / ideaId survive while
    // heavy blobs (e.g. plan proposals) are dropped.
    if (payload.length > 7500) {
      const record = data as Record<string, unknown>;
      const inner = record.data;
      if (inner && typeof inner === "object" && !Array.isArray(inner)) {
        const slim: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(inner as Record<string, unknown>)) {
          if (v === null || typeof v !== "object") slim[k] = v;
        }
        payload = JSON.stringify({ ...record, data: slim });
      }

      // If still too large after stripping, keep only the `id` field.
      if (payload.length > 7500) {
        const id = (record.data as Record<string, unknown>)?.id;
        payload = JSON.stringify({ ...record, data: id != null ? { id } : {} });
      }
    }

    await this.sql.notify(channel, payload);
  }

  async subscribe(channel: string, handler: Handler): Promise<() => void> {
    if (!this.channels.has(channel)) {
      this.channels.set(channel, new Set());
    }
    this.channels.get(channel)!.add(handler);

    if (!this.unlisteners.has(channel)) {
      const { unlisten } = await this.sql.listen(channel, (payload) => {
        const handlers = this.channels.get(channel);
        if (handlers) {
          const data = JSON.parse(payload);
          for (const h of handlers) {
            h(data);
          }
        }
      });
      this.unlisteners.set(channel, unlisten);
    }

    return () => {
      const handlers = this.channels.get(channel);
      if (handlers) {
        handlers.delete(handler);
        if (handlers.size === 0) {
          this.channels.delete(channel);
          const unlisten = this.unlisteners.get(channel);
          if (unlisten) {
            this.unlisteners.delete(channel);
            unlisten();
          }
        }
      }
    };
  }

  async close(): Promise<void> {
    for (const unlisten of this.unlisteners.values()) {
      await unlisten();
    }
    this.unlisteners.clear();
    this.channels.clear();
    await this.sql.end();
  }
}
