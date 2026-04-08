import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@praxis2/shared", () => ({}));

import { StructuredQuestion } from "./StructuredQuestion";

const singleSelectQuestion = {
  question: "Which approach do you prefer?",
  header: "Approach",
  options: [
    { label: "Option A", description: "First approach" },
    { label: "Option B", description: "Second approach" },
  ],
  multiSelect: false,
};

const multiSelectQuestion = {
  question: "Which features do you want?",
  header: "Features",
  options: [
    { label: "Auth", description: "Authentication system" },
    { label: "API", description: "REST API" },
    { label: "Dashboard", description: "Admin dashboard" },
  ],
  multiSelect: true,
};

describe("StructuredQuestion", () => {
  describe("Component rendering", () => {
    it("renders question text and all options", () => {
      render(
        <StructuredQuestion
          messageId="msg-1"
          questions={[singleSelectQuestion]}
          onAnswer={vi.fn()}
          isAnswered={false}
        />,
      );
      expect(
        screen.getByText("Which approach do you prefer?"),
      ).toBeInTheDocument();
      expect(screen.getByText("Option A")).toBeInTheDocument();
      expect(screen.getByText("Option B")).toBeInTheDocument();
      expect(screen.getByText("Approach")).toBeInTheDocument();
      expect(screen.getByText("Other")).toBeInTheDocument();
    });

    it("renders submit button disabled initially", () => {
      render(
        <StructuredQuestion
          messageId="msg-1"
          questions={[singleSelectQuestion]}
          onAnswer={vi.fn()}
          isAnswered={false}
        />,
      );
      const submitBtn = screen.getByRole("button", { name: /submit/i });
      expect(submitBtn).toBeDisabled();
    });
  });

  describe("Single-select behavior", () => {
    it("clicking option selects it and enables submit", () => {
      render(
        <StructuredQuestion
          messageId="msg-1"
          questions={[singleSelectQuestion]}
          onAnswer={vi.fn()}
          isAnswered={false}
        />,
      );

      fireEvent.click(screen.getByText("Option A"));
      const submitBtn = screen.getByRole("button", { name: /submit/i });
      expect(submitBtn).not.toBeDisabled();
    });

    it("clicking another option deselects previous", () => {
      const onAnswer = vi.fn();
      render(
        <StructuredQuestion
          messageId="msg-1"
          questions={[singleSelectQuestion]}
          onAnswer={onAnswer}
          isAnswered={false}
        />,
      );

      fireEvent.click(screen.getByText("Option A"));
      fireEvent.click(screen.getByText("Option B"));
      fireEvent.click(screen.getByRole("button", { name: /submit/i }));

      expect(onAnswer).toHaveBeenCalledWith("msg-1", "Selected: Option B", [
        "Option B",
      ]);
    });
  });

  describe("Multi-select behavior", () => {
    it("clicking options toggles independently", () => {
      const onAnswer = vi.fn();
      render(
        <StructuredQuestion
          messageId="msg-1"
          questions={[multiSelectQuestion]}
          onAnswer={onAnswer}
          isAnswered={false}
        />,
      );

      fireEvent.click(screen.getByText("Auth"));
      fireEvent.click(screen.getByText("API"));
      fireEvent.click(screen.getByRole("button", { name: /submit/i }));

      expect(onAnswer).toHaveBeenCalledWith(
        "msg-1",
        "Selected: Auth, API",
        ["Auth", "API"],
      );
    });
  });

  describe("Other text input", () => {
    it("typing text enables submit", () => {
      const onAnswer = vi.fn();
      render(
        <StructuredQuestion
          messageId="msg-1"
          questions={[singleSelectQuestion]}
          onAnswer={onAnswer}
          isAnswered={false}
        />,
      );

      const input = screen.getByPlaceholderText("Type your answer...");
      fireEvent.change(input, { target: { value: "Custom answer" } });
      fireEvent.click(screen.getByRole("button", { name: /submit/i }));

      expect(onAnswer).toHaveBeenCalledWith(
        "msg-1",
        "Selected: Custom answer",
        ["Custom answer"],
      );
    });
  });

  describe("Read-only mode", () => {
    it("shows Answered badge and disables options", () => {
      render(
        <StructuredQuestion
          messageId="msg-1"
          questions={[singleSelectQuestion]}
          onAnswer={vi.fn()}
          isAnswered={true}
          selectedOptions={["Option A"]}
        />,
      );

      expect(screen.getByText("Answered")).toBeInTheDocument();
      // Submit button should not be visible
      expect(
        screen.queryByRole("button", { name: /submit/i }),
      ).not.toBeInTheDocument();
      // All option buttons should be disabled
      const optionButtons = screen.getAllByRole("button");
      optionButtons.forEach((btn) => expect(btn).toBeDisabled());
    });
  });

  describe("Submit callback", () => {
    it("fires onAnswer with correct messageId, formatted string, and selectedOptions", () => {
      const onAnswer = vi.fn();
      render(
        <StructuredQuestion
          messageId="msg-123"
          questions={[singleSelectQuestion]}
          onAnswer={onAnswer}
          isAnswered={false}
        />,
      );

      fireEvent.click(screen.getByText("Option A"));
      fireEvent.click(screen.getByRole("button", { name: /submit/i }));

      expect(onAnswer).toHaveBeenCalledTimes(1);
      expect(onAnswer).toHaveBeenCalledWith(
        "msg-123",
        "Selected: Option A",
        ["Option A"],
      );
    });
  });
});
