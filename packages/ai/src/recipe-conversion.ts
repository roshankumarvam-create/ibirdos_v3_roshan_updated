// packages/ai/src/recipe-conversion.ts
// Deterministic unit conversion for recipe ingredients extracted from Vision OCR.
// Pure math — no external calls. Run this AFTER the Vision extraction step.

const VOLUME_TO_ML: Record<string, number> = {
  ml: 1, l: 1000,
  tsp: 4.929, tbsp: 14.787,
  cup: 236.588, fl_oz: 29.574,
  pint: 473.18, quart: 946.35, gallon: 3785.4,
};

const WEIGHT_TO_G: Record<string, number> = {
  g: 1, kg: 1000,
  oz: 28.3495, lb: 453.592,
};

const LIQUID_KEYWORDS = [
  'water', 'stock', 'broth', 'milk', 'cream', 'half-and-half', 'half and half',
  'juice', 'oil', 'vinegar', 'wine', 'beer', 'syrup', 'sauce', 'marinade',
  'honey', 'maple syrup',
];

const DENSITY_G_PER_CUP: Record<string, number> = {
  'butter': 227,
  'all-purpose flour': 120, 'flour': 120,
  'cornstarch': 128,
  'granulated sugar': 200, 'sugar': 200, 'brown sugar': 220,
  'powdered sugar': 120,
  'chopped onion': 160, 'onion': 160,
  'shredded cheese': 113, 'cheese': 113,
  'broccoli florets': 91, 'broccoli': 91,
  'sour cream': 230,
  'breadcrumbs': 108, 'panko': 50,
  'rice': 195, 'cooked rice': 158,
  'oats': 90, 'rolled oats': 90,
  'chocolate chips': 175,
  'nuts': 120, 'chopped nuts': 120,
};

const AVG_WEIGHT_G: Record<string, number> = {
  'clove': 3,
  'large_carrot': 72, 'medium_carrot': 60, 'small_carrot': 50,
  'large_onion': 150, 'medium_onion': 110, 'small_onion': 70,
  'large_egg': 50, 'medium_egg': 44,
  'leaf': 0.2, 'bay leaf': 0.2,
  'slice': 25, 'stick': 113,
  'can': 425, 'bunch': 100,
  'each_default': 50,
};

const TSP_G_SOLID: Record<string, number> = {
  'salt': 6, 'table salt': 6, 'kosher salt': 4,
  'baking powder': 4, 'baking soda': 4,
  'ground spice': 2, 'pepper': 2, 'ground nutmeg': 2, 'ground cinnamon': 2,
  'vanilla extract': 4,
  'default_spice': 2,
};

export interface ExtractedIngredient {
  name: string;
  prepNote: string | null;
  qty: number;
  nativeUnit: string;
  sizeQualifier: 'small' | 'medium' | 'large' | null;
  weightHintGrams: number | null;
  weightHintOz: number | null;
  /** 0–100. Values below 90 mean the extracted unit is uncertain and will trigger lowConfidence. */
  unitConfidence?: number;
}

export interface ConvertedIngredient extends ExtractedIngredient {
  unitConfidence: number;
  qtyCanonical: number;
  unitCanonical: 'g' | 'ml' | 'each';
  ozEquivalent: number | null;
  lowConfidence: boolean;
  conversionNote: string | null;
}

export function convertIngredient(ing: ExtractedIngredient): ConvertedIngredient {
  const nameNorm = ing.name.toLowerCase().trim();
  const isLiquid = LIQUID_KEYWORDS.some(k => nameNorm.includes(k));
  const unitConf = ing.unitConfidence ?? 100;

  // Wraps every return: threads unitConfidence through and upgrades lowConfidence when unit is uncertain.
  function done(
    qtyCanonical: number,
    unitCanonical: 'g' | 'ml' | 'each',
    ozEquivalent: number | null,
    lowConfidence: boolean,
    conversionNote: string | null,
  ): ConvertedIngredient {
    const unitUncertain = unitConf < 90;
    const noteWithConf = unitUncertain
      ? (conversionNote
          ? `${conversionNote} Unit confidence: ${unitConf}% — verify unit before use.`
          : `Unit confidence: ${unitConf}% — verify unit before use.`)
      : conversionNote;
    return {
      ...ing,
      unitConfidence: unitConf,
      qtyCanonical,
      unitCanonical,
      ozEquivalent,
      lowConfidence: lowConfidence || unitUncertain,
      conversionNote: noteWithConf,
    };
  }

  // Priority A: explicit weight hint from recipe
  if (ing.weightHintGrams != null) {
    return done(
      ing.weightHintGrams, 'g', ing.weightHintGrams / 28.3495, false,
      `Used recipe weight hint ${ing.weightHintGrams}g`,
    );
  }
  if (ing.weightHintOz != null) {
    const grams = ing.weightHintOz * 28.3495;
    return done(grams, 'g', ing.weightHintOz, false, `Used recipe weight hint ${ing.weightHintOz} oz`);
  }

  // Priority B: weight units
  if (ing.nativeUnit in WEIGHT_TO_G) {
    const grams = ing.qty * WEIGHT_TO_G[ing.nativeUnit]!;
    return done(grams, 'g', grams / 28.3495, false, null);
  }

  // Priority C: liquid in volume units → ml
  if (isLiquid && ing.nativeUnit in VOLUME_TO_ML) {
    const ml = ing.qty * VOLUME_TO_ML[ing.nativeUnit]!;
    return done(ml, 'ml', ml / 29.574, false, null);
  }

  // Priority D: solid in volume units → density lookup → g
  if (ing.nativeUnit in VOLUME_TO_ML) {
    let densityG: number | null = null;
    for (const [key, g] of Object.entries(DENSITY_G_PER_CUP)) {
      if (nameNorm.includes(key)) {
        densityG = g;
        break;
      }
    }

    // Spoon-sized spices/salt (tsp/tbsp only, when no density found)
    if ((ing.nativeUnit === 'tsp' || ing.nativeUnit === 'tbsp') && !densityG) {
      for (const [key, tspG] of Object.entries(TSP_G_SOLID)) {
        if (nameNorm.includes(key)) {
          const grams = ing.nativeUnit === 'tbsp' ? ing.qty * tspG * 3 : ing.qty * tspG;
          return done(grams, 'g', grams / 28.3495, false, null);
        }
      }
      // Default generic spice (~2g/tsp)
      const defaultG = TSP_G_SOLID['default_spice']!;
      const grams = ing.nativeUnit === 'tbsp' ? ing.qty * defaultG * 3 : ing.qty * defaultG;
      return done(grams, 'g', grams / 28.3495, true,
        'Estimated as generic spice (~2g/tsp). Verify if precise costing needed.');
    }

    if (densityG) {
      const cups = (ing.qty * VOLUME_TO_ML[ing.nativeUnit]!) / VOLUME_TO_ML['cup']!;
      const grams = cups * densityG;
      return done(grams, 'g', grams / 28.3495, false, null);
    }

    // Unknown solid density → store as ml volume and flag
    const ml = ing.qty * VOLUME_TO_ML[ing.nativeUnit]!;
    return done(ml, 'ml', ml / 29.574, true,
      `Unknown density for "${ing.name}" — stored as volume. Edit if needed.`);
  }

  // Priority E: counted items
  const countUnits = ['each', 'clove', 'leaf', 'slice', 'stick', 'can', 'bunch'];
  if (countUnits.includes(ing.nativeUnit)) {
    let perItemG = AVG_WEIGHT_G['each_default']!;
    let confident = false;

    if (ing.nativeUnit === 'clove') {
      perItemG = AVG_WEIGHT_G['clove']!; confident = true;
    } else if (ing.nativeUnit === 'leaf') {
      perItemG = AVG_WEIGHT_G['leaf']!; confident = true;
    } else if (ing.nativeUnit === 'stick') {
      perItemG = AVG_WEIGHT_G['stick']!; confident = true;
    } else if (ing.nativeUnit === 'can') {
      perItemG = AVG_WEIGHT_G['can']!; confident = true;
    } else if (ing.nativeUnit === 'each' && ing.sizeQualifier) {
      const key = `${ing.sizeQualifier}_${nameNorm.split(' ').pop() ?? ''}`;
      if (AVG_WEIGHT_G[key]) { perItemG = AVG_WEIGHT_G[key]!; confident = true; }
    }

    return done(
      ing.qty, 'each', (ing.qty * perItemG) / 28.3495,
      !confident,
      confident ? null : 'Estimated unit weight. Verify if used in costing.',
    );
  }

  // Priority F: pinch/dash — ~0.5g each
  if (ing.nativeUnit === 'pinch' || ing.nativeUnit === 'dash') {
    return done(ing.qty * 0.5, 'g', (ing.qty * 0.5) / 28.3495, false, '~0.5g per pinch/dash');
  }

  // Unknown unit fallback
  return done(ing.qty, 'each', null, true, `Unrecognized unit "${ing.nativeUnit}" — stored as each.`);
}
