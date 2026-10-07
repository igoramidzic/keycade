import type { ApplicationSetupStep } from "@keycade/contracts";

// Unsaved recovery is scoped to this tab and identity. Saved answers/progress always come
// from the server; never store credentials or application data in browser storage.
const answers = new Map<string, Partial<Record<ApplicationSetupStep, string>>>();
export const answerKey = (bankId: string, email: string, applicationId: string) =>
  `${bankId}:${email}:${applicationId}`;
export function unsavedAnswer(key: string, step: ApplicationSetupStep) {
  return answers.get(key)?.[step];
}
export function rememberAnswer(key: string, step: ApplicationSetupStep, value?: string) {
  const entry = { ...answers.get(key) };
  if (value === undefined) delete entry[step];
  else entry[step] = value;
  if (Object.keys(entry).length) answers.set(key, entry);
  else answers.delete(key);
}
export function clearUnsavedAnswers() {
  answers.clear();
}
