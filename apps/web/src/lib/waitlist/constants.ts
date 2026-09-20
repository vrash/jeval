/**
 * Version of the privacy notice shown next to the waitlist form. Bump the date whenever the
 * wording of NOTICE_TEXT changes; the value is stored with each signup so we know which notice a
 * person saw. The DB constrains it to YYYY-MM-DD.
 */
export const NOTICE_VERSION = "2026-09-19" as const;

export const NOTICE_TEXT =
  "We'll use your email only to contact you about Jeval Cloud early access. No marketing lists, no sharing. You can ask us to delete it at any time.";

export const WAITLIST_SOURCES = ["site", "docs", "demo", "cloud-page"] as const;
export type WaitlistSource = (typeof WAITLIST_SOURCES)[number];

/** Upper bound on the raw request body accepted by the endpoint, in bytes. */
export const MAX_BODY_BYTES = 4096;

/** Rate limits enforced per hashed client key and per hashed email. */
export const RATE_LIMIT_WINDOW_SECONDS = 10 * 60;
export const RATE_LIMIT_PER_CLIENT = 5;
export const RATE_LIMIT_PER_EMAIL = 3;

export const SUCCESS_MESSAGE = "You're on the list. We'll email you about Jeval Cloud early access.";
export const UNAVAILABLE_MESSAGE = "The waitlist is temporarily unavailable. Nothing was saved.";
