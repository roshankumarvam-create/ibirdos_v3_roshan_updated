const FRIENDLY_MESSAGES: Record<string, string> = {
  not_found: "The requested item could not be found.",
  validation_failed: "Please check your input and try again.",
  conflict: "A conflict occurred. Please refresh and try again.",
  duplicate_date: "Sales data already exists for this date.",
  internal_error: "Something went wrong. Please try again.",
  network_error: "Network error. Please check your connection and try again.",
  unauthorized: "Please sign in to continue.",
  forbidden: "You do not have permission to perform this action.",
  already_paid: "This event is already marked as paid.",
  email_not_configured: "Email service is not configured.",
  no_client_email: "No email address found for this client.",
  parse_error: "Could not read the file. Please check the format and try again.",
  csv_no_lines: "No line items found in the file. Check column headers and try again.",
};

export function friendlyError(code?: string | null, fallback?: string): string {
  if (code && FRIENDLY_MESSAGES[code]) return FRIENDLY_MESSAGES[code]!;
  return fallback ?? "Something went wrong. Please try again.";
}
