import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import HistoryTable from "../HistoryTable";

const baseProps = {
  refreshKey: 0,
  projectId: null,
  projectName: null,
  userId: "user-1",
  userDisplayName: "Test User",
};

describe("HistoryTable", () => {
  it("renders empty state when there is no project", () => {
    render(<HistoryTable {...baseProps} />);

    expect(screen.getByText("Task List")).toBeInTheDocument();
    expect(screen.getByText("No history yet.")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /download excel/i }),
    ).toBeDisabled();
  });
});
