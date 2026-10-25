/** Report categories, target types and the crisis line, shared by UI and actions. */

export const REPORT_CATEGORIES = [
  { value: "spam", label: "Spam" },
  { value: "bullying", label: "Mean or bullying" },
  { value: "inappropriate", label: "Inappropriate" },
  { value: "contact_info", label: "Sharing contact info" },
  { value: "under_13", label: "May be under 13" },
  { value: "urgent", label: "Urgent: someone is in danger" },
] as const;

export type ReportCategory = (typeof REPORT_CATEGORIES)[number]["value"];

export type ReportTargetType = "post" | "comment" | "chat_message" | "profile" | "poll";

export const REPORT_TARGET_TYPES: readonly ReportTargetType[] = [
  "post",
  "comment",
  "chat_message",
  "profile",
  "poll",
];

export const CRISIS_LINE =
  "If someone is in danger, call or text 988 (Suicide & Crisis Lifeline) or text HOME to 741741.";
