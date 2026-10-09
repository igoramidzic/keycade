/** Presentation only: keep stored fixture names, provider results and audit evidence intact. */
export function workflowText(value: string | null | undefined): string {
  const original = value ?? "";
  const text = original
    .replace(
      /All application data, checks, signatures and funding in this demo are synthetic\./g,
      "",
    )
    .replace(/This is a Keycade simulation\.\s*/g, "")
    .replace(/\s*[—·]\s*simulation\b/gi, "")
    .replace(/These checks are simulated and unverified\./g, "These checks are unverified.")
    .replace(/No external email has been sent\.?/gi, "")
    .replace(
      /Funding records a demonstration; no money moves\./g,
      "Funding is recorded separately.",
    )
    .replace(/\s*\(fictional\)/gi, "")
    .replace(/\b(?:synthetic|simulated|fictional|demo)\s+/gi, "")
    .replace(/\b(?:simulation|demonstration)\b/gi, "workflow")
    .replace(/\s+([.,])/g, "$1")
    .replace(/\bA EIN\b/g, "An EIN")
    .trim();
  return text === original ? text : text.replace(/^[a-z]/, (letter) => letter.toUpperCase());
}

/** Rename built-in display fixtures without changing a user's business or contact name. */
export function workflowName(value: string | null | undefined): string {
  const name = value ?? "";
  if (/^(?:Alex Cedar|Jordan Cedar|Casey Pine) \(fictional\)$/.test(name))
    return name.replace(" (fictional)", "");
  return /^Synthetic (?:Bank [AB]|Business Credit|Cedar Workshop|Maple Supply|Birch Services|Willow Services|Juniper Services|Borrower|Officer [AB]|Restricted Adviser|Revoked Owner|Non-portal Owner)$/.test(
    name,
  )
    ? name.slice("Synthetic ".length)
    : name;
}
