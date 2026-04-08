import { describe, it, expect, vi, beforeEach } from "vitest";
import { ProposalSchema } from "@praxis2/shared";
import {
  determineCurrentPhase,
  detectPhaseAdvancement,
  generateStubResponse,
  looksLikeProposalJson,
} from "./architectureSession.js";

// Mock external deps so the module can be imported without side effects
vi.mock("../../db/index.js", () => ({
  getConnectionString: vi.fn(() => "postgresql://mock"),
  getDb: vi.fn(() => ({})),
}));

vi.mock("../../lib/logger.js", () => ({
  getLogger: vi.fn(() => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn() })),
}));

vi.mock("../../pubsub.js", () => ({
  PgPubSub: vi.fn().mockImplementation(() => ({
    publish: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
  })),
}));

describe("architectureSession", () => {
  // --- determineCurrentPhase ---

  describe("determineCurrentPhase", () => {
    it("defaults to scope_and_requirements when no phase markers exist", () => {
      const messages = [
        { role: "assistant", content: "Hello" },
        { role: "user", content: "Hi" },
      ];
      expect(determineCurrentPhase(messages)).toBe("scope_and_requirements");
    });

    it("returns the phase from the last marker", () => {
      const messages = [
        { role: "system", content: "--- Phase: SCOPE AND REQUIREMENTS ---" },
        { role: "assistant", content: "..." },
        { role: "system", content: "--- Phase: ARCHITECTURE ---" },
        { role: "assistant", content: "..." },
      ];
      expect(determineCurrentPhase(messages)).toBe("architecture");
    });

    it("handles epic_breakdown phase", () => {
      const messages = [
        { role: "system", content: "--- Phase: EPIC BREAKDOWN ---" },
      ];
      expect(determineCurrentPhase(messages)).toBe("epic_breakdown");
    });

    it("handles task_breakdown phase", () => {
      const messages = [
        { role: "system", content: "--- Phase: TASK BREAKDOWN ---" },
      ];
      expect(determineCurrentPhase(messages)).toBe("task_breakdown");
    });

    it("handles review phase", () => {
      const messages = [
        { role: "system", content: "--- Phase: REVIEW ---" },
      ];
      expect(determineCurrentPhase(messages)).toBe("review");
    });

    it("defaults if marker text does not match any phase", () => {
      const messages = [
        { role: "system", content: "--- Phase: UNKNOWN ---" },
      ];
      expect(determineCurrentPhase(messages)).toBe("scope_and_requirements");
    });
  });

  // --- detectPhaseAdvancement ---

  describe("detectPhaseAdvancement", () => {
    it("detects 'Ready to move to' as advancement", () => {
      const result = detectPhaseAdvancement(
        "Great. Ready to move to Architecture phase.",
        "scope_and_requirements",
      );
      expect(result).toBe("architecture");
    });

    it("detects 'Let's proceed to' as advancement", () => {
      const result = detectPhaseAdvancement(
        "Let's proceed to the next phase.",
        "architecture",
      );
      expect(result).toBe("epic_breakdown");
    });

    it("detects 'Ready to generate the proposal' as advancement", () => {
      const result = detectPhaseAdvancement(
        "All confirmed. Ready to generate the proposal.",
        "task_breakdown",
      );
      expect(result).toBe("review");
    });

    it("returns null when no advancement signal is found", () => {
      const result = detectPhaseAdvancement(
        "Can you clarify what you mean?",
        "scope_and_requirements",
      );
      expect(result).toBeNull();
    });

    it("returns null when already at the last phase", () => {
      const result = detectPhaseAdvancement(
        "Ready to move to the next phase.",
        "review",
      );
      expect(result).toBeNull();
    });
  });

  // --- looksLikeProposalJson ---

  describe("looksLikeProposalJson", () => {
    it("detects a valid-looking proposal JSON", () => {
      const json = '{"epics":[{"key":"e1","title":"T","description":"D","tasks":[]}]}';
      expect(looksLikeProposalJson(json)).toBe(true);
    });

    it("returns false for non-JSON text", () => {
      expect(looksLikeProposalJson("This is just a sentence.")).toBe(false);
    });

    it("returns false for JSON without epics key", () => {
      expect(looksLikeProposalJson('{"tasks":[]}')).toBe(false);
    });
  });

  // --- generateStubResponse ---

  describe("generateStubResponse", () => {
    it("returns scope clarification on first message in scope phase", () => {
      const history = [
        { role: "system", content: "--- Phase: SCOPE AND REQUIREMENTS ---" },
        { role: "assistant", content: "Opening message" },
      ];
      const response = generateStubResponse(
        history,
        "I want to add auth",
        "scope_and_requirements",
      );
      expect(response).toContain("follow-up");
    });

    it("advances from scope after second user message", () => {
      const history = [
        { role: "system", content: "--- Phase: SCOPE AND REQUIREMENTS ---" },
        { role: "assistant", content: "Opening" },
        { role: "user", content: "First message" },
        { role: "assistant", content: "Follow-up" },
      ];
      const response = generateStubResponse(
        history,
        "Second message",
        "scope_and_requirements",
      );
      expect(response).toContain("Ready to move to Architecture phase");
    });

    it("produces proposal JSON in review phase", () => {
      const history = [
        { role: "system", content: "--- Phase: REVIEW ---" },
        { role: "assistant", content: "Generating..." },
      ];
      const response = generateStubResponse(
        history,
        "Looks good",
        "review",
      );

      // Should be parseable JSON containing a valid proposal
      expect(looksLikeProposalJson(response)).toBe(true);

      const match = response.match(/\{[\s\S]*\}/);
      expect(match).not.toBeNull();
      const parsed = JSON.parse(match![0]);
      expect(ProposalSchema.safeParse(parsed).success).toBe(true);
    });
  });

  // --- ProposalSchema validation ---

  describe("ProposalSchema", () => {
    it("validates a correct proposal", () => {
      const proposal = {
        epics: [
          {
            key: "e1",
            title: "Test Epic",
            description: "Test description",
            tasks: [
              {
                key: "b1",
                title: "Task 1",
                description: "Task 1",
                priority: "high",
                dependsOn: [],
              },
            ],
          },
        ],
      };
      expect(ProposalSchema.safeParse(proposal).success).toBe(true);
    });

    it("rejects a proposal missing required fields", () => {
      const bad = { epics: [{ title: "No key", tasks: [] }] };
      expect(ProposalSchema.safeParse(bad).success).toBe(false);
    });

    it("rejects an empty epics array", () => {
      const bad = { epics: [] };
      expect(ProposalSchema.safeParse(bad).success).toBe(false);
    });

    it("validates proposal with dependsOn references", () => {
      const proposal = {
        epics: [
          {
            key: "e1",
            title: "Epic",
            description: "Desc",
            tasks: [
              { key: "b1", title: "B1", description: "D", priority: "high", dependsOn: [] },
              { key: "b2", title: "B2", description: "D", priority: "medium", dependsOn: ["b1"] },
            ],
          },
        ],
      };
      expect(ProposalSchema.safeParse(proposal).success).toBe(true);
    });

    it("extracts JSON from markdown-fenced response", () => {
      const response =
        '```json\n{"epics":[{"key":"e1","title":"E","description":"D","tasks":[{"key":"b1","title":"B","description":"D","priority":"low"}]}]}\n```';
      const match = response.match(/\{[\s\S]*\}/);
      expect(match).not.toBeNull();
      const parsed = JSON.parse(match![0]);
      expect(ProposalSchema.safeParse(parsed).success).toBe(true);
    });
  });
});
