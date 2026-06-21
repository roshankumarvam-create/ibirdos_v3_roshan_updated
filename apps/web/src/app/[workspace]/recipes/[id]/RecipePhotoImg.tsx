"use client";

import { useState } from "react";

interface RecipePhotoImgProps {
  src: string;
  alt: string;
  label: string;
}

/** Renders a recipe photo with an error fallback so broken URLs never show a broken-image icon. */
export function RecipePhotoImg({ src, alt, label }: RecipePhotoImgProps) {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return (
      <div className="h-32 w-32 rounded border border-bg-border bg-bg-inset flex items-center justify-center">
        <span className="text-[10px] text-text-tertiary text-center px-2">
          {label} photo unavailable
        </span>
      </div>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      className="h-32 w-auto rounded object-cover border border-bg-border"
      onError={() => setFailed(true)}
    />
  );
}
