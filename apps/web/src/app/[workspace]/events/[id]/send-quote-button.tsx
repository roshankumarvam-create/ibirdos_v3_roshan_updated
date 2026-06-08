"use client";

import { useState } from "react";
import { Button } from "@ibirdos/ui";
import { api } from "@/lib/api";

interface Props {
  eventId: string;
  clientEmail: string | null;
  eventName: string;
}

export function SendQuoteButton({ eventId, clientEmail, eventName }: Props) {
  const [state, setState] = useState<"idle" | "confirm" | "sending" | "sent" | "no_email" | "not_configured" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");

  const handleSend = async () => {
    setState("sending");
    const res = await api.post<{ sentTo: string }>(`/events/${eventId}/send-quote`, {});
    if (res.error) {
      const code = (res.error as any)?.code;
      if (code === "email_not_configured") {
        setState("not_configured");
      } else if (code === "no_client_email") {
        setState("no_email");
      } else {
        setErrorMsg(res.error.message ?? "Failed to send quote.");
        setState("error");
      }
      return;
    }
    setState("sent");
  };

  const copyToClipboard = async () => {
    await navigator.clipboard.writeText(
      `Quote for ${eventName}\nClient: ${clientEmail ?? "(no email set)"}\n\nReply to this message to confirm the quote.`,
    );
    alert("Quote reference copied to clipboard.");
  };

  if (state === "sent") {
    return (
      <span className="inline-flex items-center gap-1 rounded border border-success/30 bg-success/10 px-3 py-1 text-xs font-medium text-success">
        Quote sent ✓
      </span>
    );
  }

  if (state === "not_configured") {
    return (
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs text-warning">Email not configured.</span>
        <button
          onClick={copyToClipboard}
          className="text-xs text-accent-400 hover:underline"
        >
          Copy quote reference
        </button>
      </div>
    );
  }

  if (state === "no_email") {
    return (
      <span className="text-xs text-warning">
        Add an email to the client contact field to send a quote.
      </span>
    );
  }

  if (state === "error") {
    return <span className="text-xs text-danger">{errorMsg}</span>;
  }

  if (state === "confirm") {
    return (
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs text-text-secondary">
          Send to <span className="font-mono">{clientEmail}</span>?
        </span>
        <Button variant="primary" size="sm" onClick={handleSend}>
          Confirm send
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setState("idle")}>
          Cancel
        </Button>
      </div>
    );
  }

  return (
    <Button
      variant="secondary"
      size="sm"
      onClick={() => (clientEmail ? setState("confirm") : handleSend())}
      disabled={state === "sending"}
    >
      {state === "sending" ? "Sending…" : "Send quote"}
    </Button>
  );
}
