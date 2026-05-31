import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { requireSession } from "@/lib/session";
import { api } from "@/lib/api";
import { formatCanonical, toCanonical } from "@ibirdos/types";
import { TaskPrepClient } from "./client";

interface IngredientLine {
  ingredientId: string;
  unit: string;
  quantity: number;
  yieldPctOverride: number | null;
  ingredient: {
    id: string;
    name: string;
    dimension: "MASS" | "VOLUME" | "COUNT";
    canonicalUnit: string;
    densityGPerMl: number | null;
    preferredDisplayUnit: string | null;
    currentStockCanonical: number;
    reorderThresholdCanonical: number | null;
    defaultYieldPct: number | null;
  };
}

interface RecipeDetail {
  id: string;
  name: string;
  portionsYielded: number | null;
  instructionsMd: string | null;
  prepTimeMin: number | null;
  cookTimeMin: number | null;
  ingredients: IngredientLine[];
}

interface TaskDetail {
  id: string;
  title: string;
  status: "PENDING" | "IN_PROGRESS" | "BLOCKED" | "DONE" | "CANCELLED";
  station: string;
  targetPortions: number | null;
  estimatedMinutes: number | null;
  scheduledStartAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  notes: string | null;
  blockReason: string | null;
}

export interface PrepLine {
  ingredientId: string;
  ingredientName: string;
  displayQty: string;
  stockStatus: "ok" | "low" | "insufficient";
  currentStockDisplay: string;
  displayUnit: string;
}

export default async function TaskPrepPage({
  params,
}: {
  params: Promise<{ workspace: string; taskId: string }>;
}) {
  const { workspace, taskId } = await params;
  await requireSession();
  const c = await cookies();

  const res = await api.get<{ task: TaskDetail; recipe: RecipeDetail | null }>(
    `/kitchen/tasks/${taskId}`,
    { cookies: c },
  );

  if (!res.data) notFound();
  const { task, recipe } = res.data;

  // Compute prep list server-side (has access to toCanonical)
  const targetPortions = task.targetPortions ?? 1;
  const recipePortions = recipe?.portionsYielded ?? 1;
  const scale = targetPortions / recipePortions;

  const prepLines: PrepLine[] = (recipe?.ingredients ?? []).map((link) => {
    let canonicalPerRecipe = 0;
    try {
      canonicalPerRecipe = toCanonical(Number(link.quantity), link.unit, {
        dimension: link.ingredient.dimension,
        densityGPerMl: link.ingredient.densityGPerMl,
      });
    } catch {
      canonicalPerRecipe = Number(link.quantity);
    }

    const consumed = canonicalPerRecipe * scale;
    const displayQty = formatCanonical(
      consumed,
      link.ingredient.dimension,
      link.ingredient.preferredDisplayUnit ?? undefined,
    );

    // Display the current stock in the same display unit
    const displayUnitCode = link.ingredient.preferredDisplayUnit ?? link.ingredient.canonicalUnit;
    let displayFactor = 1;
    try {
      displayFactor = toCanonical(1, displayUnitCode, { dimension: link.ingredient.dimension, densityGPerMl: null });
    } catch { /* keep 1 */ }

    const stock = Number(link.ingredient.currentStockCanonical);
    const threshold = link.ingredient.reorderThresholdCanonical
      ? Number(link.ingredient.reorderThresholdCanonical)
      : null;
    const stockStatus: "ok" | "low" | "insufficient" =
      stock < consumed
        ? "insufficient"
        : threshold && stock < threshold
        ? "low"
        : "ok";

    const currentStockDisplay = `${(stock / displayFactor).toFixed(1)} ${displayUnitCode}`;

    return {
      ingredientId: link.ingredient.id,
      ingredientName: link.ingredient.name,
      displayQty,
      stockStatus,
      currentStockDisplay,
      displayUnit: displayUnitCode,
    };
  });

  return (
    <TaskPrepClient
      workspace={workspace}
      taskId={taskId}
      initialTask={task}
      recipe={recipe}
      prepLines={prepLines}
    />
  );
}
