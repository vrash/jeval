import { z } from "zod";
import { NOTICE_VERSION, WAITLIST_SOURCES } from "./constants";

/** Lower-cases and trims an address so it matches the DB's normalisation CHECK. */
export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

const emptyToUndefined = (value: unknown) =>
  typeof value === "string" && value.trim() === "" ? undefined : value;

export const CAMPAIGN_PATTERN = /^[a-z0-9-]{1,40}$/;

export const WaitlistInputSchema = z.object({
  email: z
    .string()
    .transform(normaliseEmail)
    .pipe(z.email().min(3).max(254)),
  useCase: z.preprocess(emptyToUndefined, z.string().trim().max(280).optional()),
  source: z.enum(WAITLIST_SOURCES).default("site"),
  campaign: z.preprocess(emptyToUndefined, z.string().regex(CAMPAIGN_PATTERN).optional()),
  noticeVersion: z.literal(NOTICE_VERSION),
  /** Honeypot. Real browsers never fill it; the handler treats a non-empty value as a bot. */
  website: z.string().max(1000).optional(),
});

export type WaitlistInput = z.infer<typeof WaitlistInputSchema>;

/** Field names the endpoint may report in a validation error, in a stable order. */
export const WAITLIST_FIELDS = ["email", "useCase", "source", "campaign", "noticeVersion", "website"] as const;
export type WaitlistField = (typeof WAITLIST_FIELDS)[number];

/** Fixed, input-free messages so a 400 response never echoes what was submitted. */
export const FIELD_ERROR_MESSAGES: Record<WaitlistField, string> = {
  email: "Enter a valid email address (up to 254 characters).",
  useCase: "Keep the use case to 280 characters.",
  source: "Unknown signup source.",
  campaign: "Invalid campaign value.",
  noticeVersion: "The privacy notice has changed. Reload the page and try again.",
  website: "Invalid value.",
};

export interface FieldError {
  field: WaitlistField | "body";
  message: string;
}

/** Collapses a zod error into one generic message per offending field. */
export function toFieldErrors(error: z.ZodError): FieldError[] {
  const seen = new Set<string>();
  const out: FieldError[] = [];
  for (const issue of error.issues) {
    const head = issue.path[0];
    const field = typeof head === "string" && (WAITLIST_FIELDS as readonly string[]).includes(head)
      ? (head as WaitlistField)
      : "body";
    if (seen.has(field)) continue;
    seen.add(field);
    out.push({
      field,
      message: field === "body" ? "The request body is not valid." : FIELD_ERROR_MESSAGES[field],
    });
  }
  return out;
}
