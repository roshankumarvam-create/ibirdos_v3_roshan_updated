"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@ibirdos/ui";
import { api } from "@/lib/api";
import { toast } from "@/lib/toast";
import type { Route } from "next";

interface Props {
  recipeId: string;
  workspaceSlug: string;
  recipeName: string;
}

export function DeleteRecipeButton({ recipeId, workspaceSlug, recipeName }: Props) {
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const handleClick = async () => {
    if (!confirm(`Delete "${recipeName}"? This cannot be undone.`)) return;
    setLoading(true);
    const res = await api.delete(`/recipes/${recipeId}`);
    setLoading(false);
    if (res.error) {
      toast.error("Failed to delete recipe. Please try again.");
      return;
    }
    toast.success("Recipe deleted successfully.");
    router.push(`/${workspaceSlug}/recipes` as Route);
  };

  return (
    <Button variant="ghost" size="sm" onClick={handleClick} disabled={loading} className="text-danger hover:text-danger">
      {loading ? "Deleting…" : "Delete"}
    </Button>
  );
}
