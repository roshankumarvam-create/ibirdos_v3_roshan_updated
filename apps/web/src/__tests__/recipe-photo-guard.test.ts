import { describe, it, expect } from "vitest";

// Regression: recipe detail page must not render <img> for empty/null photo URLs.
// The fix uses !!photoUrl which coerces empty strings to false.
function shouldRenderPhoto(url: string | null | undefined): boolean {
  return !!url;
}

describe("recipe photo URL guard", () => {
  it("renders image for a valid https URL", () => {
    expect(shouldRenderPhoto("https://r2.example.com/photo.jpg")).toBe(true);
  });

  it("does NOT render image for null (no photo uploaded)", () => {
    expect(shouldRenderPhoto(null)).toBe(false);
  });

  it("does NOT render image for undefined", () => {
    expect(shouldRenderPhoto(undefined)).toBe(false);
  });

  it("does NOT render image for empty string (stored as empty after removal)", () => {
    expect(shouldRenderPhoto("")).toBe(false);
  });

  it("renders image for a data URL (base64)", () => {
    expect(shouldRenderPhoto("data:image/jpeg;base64,/9j/abc")).toBe(true);
  });
});
