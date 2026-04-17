import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { TocNodeEditor } from "../../src/webapp/components/textbooks/tocPreview/TocNodeEditor";

describe("TocNodeEditor interactions", () => {
  it("saves edited values with parsed numeric page start", () => {
    const onSave = vi.fn();
    const onCancel = vi.fn();

    render(
      <TocNodeEditor
        numberValue="1.1"
        title="Original"
        pageStart={7}
        onSave={onSave}
        onCancel={onCancel}
      />
    );

    fireEvent.change(screen.getByPlaceholderText("e.g., 1.2"), { target: { value: "1.2" } });
    fireEvent.change(screen.getByPlaceholderText("Section title"), { target: { value: "Updated title" } });
    fireEvent.change(screen.getByPlaceholderText("e.g., 42"), { target: { value: "42" } });

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(onSave).toHaveBeenCalledWith({
      numberValue: "1.2",
      title: "Updated title",
      pageStart: 42,
    });
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("saves undefined pageStart for invalid or empty input", () => {
    const onSave = vi.fn();

    const { rerender } = render(
      <TocNodeEditor
        numberValue="2.1"
        title="Topic"
        onSave={onSave}
        onCancel={() => undefined}
      />
    );

    fireEvent.change(screen.getByPlaceholderText("e.g., 42"), { target: { value: "-2" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    rerender(
      <TocNodeEditor
        numberValue="2.1"
        title="Topic"
        onSave={onSave}
        onCancel={() => undefined}
      />
    );

    fireEvent.change(screen.getByPlaceholderText("e.g., 42"), { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(onSave).toHaveBeenNthCalledWith(1, {
      numberValue: "2.1",
      title: "Topic",
      pageStart: undefined,
    });
    expect(onSave).toHaveBeenNthCalledWith(2, {
      numberValue: "2.1",
      title: "Topic",
      pageStart: undefined,
    });
  });

  it("invokes cancel action and exposes accessible labels", () => {
    const onCancel = vi.fn();

    render(
      <TocNodeEditor
        numberValue="3.1"
        title="Topic"
        pageStart={8}
        onSave={() => undefined}
        onCancel={onCancel}
      />
    );

    expect(screen.getByLabelText("Number")).toBeInTheDocument();
    expect(screen.getByLabelText("Title")).toBeInTheDocument();
    expect(screen.getByLabelText("Start Page")).toBeInTheDocument();

    const cancelButton = screen.getByRole("button", { name: "Cancel" });
    cancelButton.focus();
    expect(cancelButton).toHaveFocus();

    fireEvent.click(cancelButton);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
