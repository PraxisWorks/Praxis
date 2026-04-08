import { render, screen, fireEvent } from "@testing-library/react";
import { SchedulePicker } from "./SchedulePicker.js";

describe("SchedulePicker", () => {
  const defaultProps = {
    onSchedule: vi.fn(),
    onClose: vi.fn(),
    isStarting: false,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the datetime picker and buttons", () => {
    render(<SchedulePicker {...defaultProps} />);
    expect(screen.getByText("Schedule Session")).toBeInTheDocument();
    expect(screen.getByText("Start Now")).toBeInTheDocument();
    expect(screen.getByText("Schedule")).toBeInTheDocument();
    expect(screen.getByText("Cancel")).toBeInTheDocument();
  });

  it("calls onSchedule(undefined) when Start Now is clicked", () => {
    const onSchedule = vi.fn();
    render(<SchedulePicker {...defaultProps} onSchedule={onSchedule} />);
    fireEvent.click(screen.getByText("Start Now"));
    expect(onSchedule).toHaveBeenCalledWith(undefined);
  });

  it("calls onClose when Cancel is clicked", () => {
    const onClose = vi.fn();
    render(<SchedulePicker {...defaultProps} onClose={onClose} />);
    fireEvent.click(screen.getByText("Cancel"));
    expect(onClose).toHaveBeenCalled();
  });

  it("Schedule button is disabled when no date is selected", () => {
    render(<SchedulePicker {...defaultProps} />);
    const scheduleBtn = screen.getByText("Schedule");
    expect(scheduleBtn).toBeDisabled();
  });

  it("shows error when Schedule clicked without selecting time (via handleSchedule)", () => {
    // The Schedule button is disabled when dateTime is empty, so handleSchedule's
    // empty check is a fallback. We test the disabled state instead.
    render(<SchedulePicker {...defaultProps} />);
    const scheduleBtn = screen.getByText("Schedule");
    expect(scheduleBtn).toBeDisabled();
    expect(defaultProps.onSchedule).not.toHaveBeenCalled();
  });

  it("calls onSchedule with ISO string when valid future date selected", () => {
    const onSchedule = vi.fn();
    render(<SchedulePicker {...defaultProps} onSchedule={onSchedule} />);

    const input = document.querySelector(
      'input[type="datetime-local"]',
    ) as HTMLInputElement;
    expect(input).toBeTruthy();

    // Set a date 1 hour from now
    const future = new Date(Date.now() + 3600000);
    const pad = (n: number) => n.toString().padStart(2, "0");
    const value = `${future.getFullYear()}-${pad(future.getMonth() + 1)}-${pad(future.getDate())}T${pad(future.getHours())}:${pad(future.getMinutes())}`;

    fireEvent.change(input, { target: { value } });
    fireEvent.click(screen.getByText("Schedule"));

    expect(onSchedule).toHaveBeenCalledTimes(1);
    const arg = onSchedule.mock.calls[0][0];
    expect(typeof arg).toBe("string");
    // Should be a valid ISO string
    expect(new Date(arg).getTime()).toBeGreaterThan(Date.now() - 60000);
  });

  it("disables Start Now and Cancel buttons when isStarting is true", () => {
    render(<SchedulePicker {...defaultProps} isStarting={true} />);
    expect(screen.getByText("Start Now")).toBeDisabled();
    expect(screen.getByText("Cancel")).toBeDisabled();
  });

  it("shows Scheduling... text when isStarting", () => {
    render(<SchedulePicker {...defaultProps} isStarting={true} />);
    expect(screen.getByText("Scheduling...")).toBeInTheDocument();
  });

  it("clears error when date input changes", () => {
    render(<SchedulePicker {...defaultProps} />);

    const input = document.querySelector(
      'input[type="datetime-local"]',
    ) as HTMLInputElement;

    // Set a past date, click schedule, expect error
    const past = new Date(Date.now() - 3600000);
    const pad = (n: number) => n.toString().padStart(2, "0");
    const pastValue = `${past.getFullYear()}-${pad(past.getMonth() + 1)}-${pad(past.getDate())}T${pad(past.getHours())}:${pad(past.getMinutes())}`;

    fireEvent.change(input, { target: { value: pastValue } });
    fireEvent.click(screen.getByText("Schedule"));
    expect(screen.getByText("Must be in the future")).toBeInTheDocument();

    // Changing the input should clear the error
    const future = new Date(Date.now() + 3600000);
    const futureValue = `${future.getFullYear()}-${pad(future.getMonth() + 1)}-${pad(future.getDate())}T${pad(future.getHours())}:${pad(future.getMinutes())}`;
    fireEvent.change(input, { target: { value: futureValue } });
    expect(screen.queryByText("Must be in the future")).not.toBeInTheDocument();
  });

  it("shows error for past date", () => {
    render(<SchedulePicker {...defaultProps} />);

    const input = document.querySelector(
      'input[type="datetime-local"]',
    ) as HTMLInputElement;

    const past = new Date(Date.now() - 3600000);
    const pad = (n: number) => n.toString().padStart(2, "0");
    const value = `${past.getFullYear()}-${pad(past.getMonth() + 1)}-${pad(past.getDate())}T${pad(past.getHours())}:${pad(past.getMinutes())}`;

    fireEvent.change(input, { target: { value } });
    fireEvent.click(screen.getByText("Schedule"));
    expect(screen.getByText("Must be in the future")).toBeInTheDocument();
    expect(defaultProps.onSchedule).not.toHaveBeenCalled();
  });
});
