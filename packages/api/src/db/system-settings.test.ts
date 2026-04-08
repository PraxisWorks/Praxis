import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock getDb ──────────────────────────────────────────────────

const mockSelect = vi.fn();
const mockFrom = vi.fn();
const mockWhere = vi.fn();
const mockLimit = vi.fn();
const mockInsert = vi.fn();
const mockValues = vi.fn();
const mockOnConflictDoUpdate = vi.fn();

const mockDb = {
  select: mockSelect.mockReturnValue({
    from: mockFrom.mockReturnValue({
      where: mockWhere.mockReturnValue({
        limit: mockLimit,
      }),
    }),
  }),
  insert: mockInsert.mockReturnValue({
    values: mockValues.mockReturnValue({
      onConflictDoUpdate: mockOnConflictDoUpdate,
    }),
  }),
};

vi.mock("./index.js", () => ({
  getDb: () => mockDb,
}));

vi.mock("./schema.js", () => ({
  systemSettings: {
    key: "key",
    value: "value",
    updatedAt: "updated_at",
  },
}));

// ── Import after mocks ──────────────────────────────────────────

import { readSetting, readBooleanSetting, writeSetting, readAllSettings } from "./system-settings.js";

describe("system-settings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset chain mocks
    mockSelect.mockReturnValue({
      from: mockFrom.mockReturnValue({
        where: mockWhere.mockReturnValue({
          limit: mockLimit,
        }),
      }),
    });
    mockInsert.mockReturnValue({
      values: mockValues.mockReturnValue({
        onConflictDoUpdate: mockOnConflictDoUpdate,
      }),
    });
  });

  describe("readSetting", () => {
    it("returns stored value when key exists", async () => {
      mockLimit.mockResolvedValueOnce([{ value: "some-role-id" }]);

      const result = await readSetting("default_role_id");
      expect(result).toBe("some-role-id");
    });

    it("returns default value when key does not exist", async () => {
      mockLimit.mockResolvedValueOnce([]);

      const result = await readSetting("default_role_id");
      expect(result).toBe(""); // default
    });
  });

  describe("readBooleanSetting", () => {
    it("returns true when value is 'true'", async () => {
      mockLimit.mockResolvedValueOnce([{ value: "true" }]);

      const result = await readBooleanSetting("default_role_id");
      expect(result).toBe(true);
    });

    it("returns false when value is not 'true'", async () => {
      mockLimit.mockResolvedValueOnce([{ value: "false" }]);

      const result = await readBooleanSetting("default_role_id");
      expect(result).toBe(false);
    });

    it("returns false for default when key missing", async () => {
      mockLimit.mockResolvedValueOnce([]);

      const result = await readBooleanSetting("default_role_id");
      expect(result).toBe(false); // default is "" which is not "true"
    });
  });

  describe("writeSetting", () => {
    it("upserts value into system_settings", async () => {
      mockOnConflictDoUpdate.mockResolvedValueOnce(undefined);

      await writeSetting("default_role_id", "some-role-id");

      expect(mockInsert).toHaveBeenCalled();
      expect(mockValues).toHaveBeenCalledWith(
        expect.objectContaining({ key: "default_role_id", value: "some-role-id" }),
      );
      expect(mockOnConflictDoUpdate).toHaveBeenCalled();
    });
  });

  describe("readAllSettings", () => {
    it("returns defaults merged with stored values", async () => {
      // readAllSettings does db.select().from(systemSettings) — no where/limit chain
      mockFrom.mockResolvedValueOnce([
        { key: "default_role_id", value: "some-role-id" },
      ]);

      const result = await readAllSettings();
      expect(result).toEqual({ default_role_id: "some-role-id" });
    });

    it("returns defaults when no rows exist", async () => {
      mockFrom.mockResolvedValueOnce([]);

      const result = await readAllSettings();
      expect(result).toEqual({ default_role_id: "" });
    });
  });
});
