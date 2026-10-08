import { expect, test } from "vitest";
import { preferredDemoUploadTarget } from "./demo-upload-targets";

test("returning sidebar registration never displaces an open private task", () => {
  const task = { id: "personal-task", priority: 1 };
  const sidebar = { id: "general", priority: 0 };
  expect(preferredDemoUploadTarget([task, sidebar])).toBe(task);
  expect(preferredDemoUploadTarget([sidebar, task])).toBe(task);
});

test("closing a task restores the still-visible general uploader", () => {
  const sidebar = { id: "general", priority: 0 };
  const task = { id: "personal-task", priority: 1 };
  const registered = [sidebar, task];
  expect(preferredDemoUploadTarget(registered.filter((entry) => entry !== task))).toBe(sidebar);
  expect(preferredDemoUploadTarget([])).toBeNull();
});

test("equally specific destinations use the latest visible registration", () => {
  const previous = { id: "previous", priority: undefined };
  const current = { id: "current", priority: 0 };
  expect(preferredDemoUploadTarget([previous, current])).toBe(current);
});
