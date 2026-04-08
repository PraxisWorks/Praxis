import { describe, it, expect } from "vitest";
import { validateConfig, getRigInitOptions } from "./config.js";

describe("validateConfig", () => {
  const validEnv = {
    DATABASE_URL: "postgres://localhost:5432/praxis2",
    WORKSPACE_ROOT: "/tmp/workspaces",
  };

  it("validates a complete config with all fields", () => {
    const env = {
      ...validEnv,
      ANTHROPIC_API_KEY: "sk-ant-test-key",
      LOG_LEVEL: "debug",
      NODE_ENV: "production",
    };
    const config = validateConfig(env);
    expect(config.DATABASE_URL).toBe(env.DATABASE_URL);
    expect(config.WORKSPACE_ROOT).toBe(env.WORKSPACE_ROOT);
    expect(config.ANTHROPIC_API_KEY).toBe("sk-ant-test-key");
    expect(config.LOG_LEVEL).toBe("debug");
    expect(config.NODE_ENV).toBe("production");
  });

  it("rejects missing DATABASE_URL", () => {
    const env = { WORKSPACE_ROOT: "/tmp/workspaces" };
    expect(() => validateConfig(env)).toThrow();
  });

  it("defaults WORKSPACE_ROOT to ~/.praxis/workspaces", () => {
    const env = { DATABASE_URL: "postgres://localhost:5432/praxis2" };
    const config = validateConfig(env);
    expect(config.WORKSPACE_ROOT).toMatch(/\.praxis\/workspaces$/);
  });

  it("applies defaults for optional fields", () => {
    const config = validateConfig(validEnv);
    expect(config.LOG_LEVEL).toBe("info");
    expect(config.NODE_ENV).toBe("development");
  });

  it("allows absent ANTHROPIC_API_KEY", () => {
    const config = validateConfig(validEnv);
    expect(config.ANTHROPIC_API_KEY).toBeUndefined();
  });

  describe("CLAUDE_MODEL", () => {
    it("defaults to 'opus' when unset", () => {
      const config = validateConfig(validEnv);
      expect(config.CLAUDE_MODEL).toBe("opus");
    });

    it("accepts valid model identifiers", () => {
      for (const model of ["opus", "claude-sonnet-4-20250514", "haiku-3"]) {
        const config = validateConfig({ ...validEnv, CLAUDE_MODEL: model });
        expect(config.CLAUDE_MODEL).toBe(model);
      }
    });

    it("rejects model strings with special characters", () => {
      expect(() =>
        validateConfig({ ...validEnv, CLAUDE_MODEL: "opus; rm -rf /" }),
      ).toThrow();
    });

    it("rejects empty string", () => {
      expect(() =>
        validateConfig({ ...validEnv, CLAUDE_MODEL: "" }),
      ).toThrow();
    });

    it("rejects strings over 100 characters", () => {
      expect(() =>
        validateConfig({ ...validEnv, CLAUDE_MODEL: "a".repeat(101) }),
      ).toThrow();
    });
  });

  describe("RIG_INIT_CLAUDE_FLOW", () => {
    it("accepts 'true'", () => {
      const config = validateConfig({ ...validEnv, RIG_INIT_CLAUDE_FLOW: "true" });
      expect(config.RIG_INIT_CLAUDE_FLOW).toBe("true");
    });

    it("accepts 'false'", () => {
      const config = validateConfig({ ...validEnv, RIG_INIT_CLAUDE_FLOW: "false" });
      expect(config.RIG_INIT_CLAUDE_FLOW).toBe("false");
    });

    it("is undefined when absent", () => {
      const config = validateConfig(validEnv);
      expect(config.RIG_INIT_CLAUDE_FLOW).toBeUndefined();
    });

    it("rejects invalid values", () => {
      expect(() =>
        validateConfig({ ...validEnv, RIG_INIT_CLAUDE_FLOW: "yes" }),
      ).toThrow();
    });
  });

  describe("RIG_INIT_SCRIPTS", () => {
    it("accepts a valid JSON array string", () => {
      const scripts = JSON.stringify(["/usr/local/bin/setup.sh"]);
      const config = validateConfig({ ...validEnv, RIG_INIT_SCRIPTS: scripts });
      expect(config.RIG_INIT_SCRIPTS).toBe(scripts);
    });

    it("is undefined when absent", () => {
      const config = validateConfig(validEnv);
      expect(config.RIG_INIT_SCRIPTS).toBeUndefined();
    });
  });
});

describe("getRigInitOptions", () => {
  const validEnv = {
    DATABASE_URL: "postgres://localhost:5432/praxis2",
    WORKSPACE_ROOT: "/tmp/workspaces",
  };

  it("returns claudeFlow=false (opt-in) when env vars absent", () => {
    const config = validateConfig(validEnv);
    const opts = getRigInitOptions(config);
    expect(opts.claudeFlow).toBe(false);
    expect(opts.scripts).toEqual([]);
  });

  it("returns claudeFlow=true when RIG_INIT_CLAUDE_FLOW='true'", () => {
    const config = validateConfig({ ...validEnv, RIG_INIT_CLAUDE_FLOW: "true" });
    expect(getRigInitOptions(config).claudeFlow).toBe(true);
  });

  it("returns claudeFlow=false when RIG_INIT_CLAUDE_FLOW='false'", () => {
    const config = validateConfig({ ...validEnv, RIG_INIT_CLAUDE_FLOW: "false" });
    expect(getRigInitOptions(config).claudeFlow).toBe(false);
  });

  it("parses scripts from RIG_INIT_SCRIPTS JSON", () => {
    const scripts = ["/home/user/setup.sh", "/opt/bin/init.sh"];
    const config = validateConfig({ ...validEnv, RIG_INIT_SCRIPTS: JSON.stringify(scripts) });
    expect(getRigInitOptions(config).scripts).toEqual(scripts);
  });

  it("throws on invalid JSON in RIG_INIT_SCRIPTS", () => {
    const config = validateConfig({ ...validEnv, RIG_INIT_SCRIPTS: "not-json" });
    expect(() => getRigInitOptions(config)).toThrow();
  });

  it("throws when RIG_INIT_SCRIPTS is not an array of strings", () => {
    const config = validateConfig({ ...validEnv, RIG_INIT_SCRIPTS: JSON.stringify([123]) });
    expect(() => getRigInitOptions(config)).toThrow("RIG_INIT_SCRIPTS must be a JSON array of strings");
  });
});
