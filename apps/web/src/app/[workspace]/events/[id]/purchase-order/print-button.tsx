"use client";

import { Button } from "@ibirdos/ui";

export function PrintButton() {
  return (
    <Button variant="secondary" size="sm" onClick={() => window.print()}>
      Print / Save as PDF
    </Button>
  );
}
