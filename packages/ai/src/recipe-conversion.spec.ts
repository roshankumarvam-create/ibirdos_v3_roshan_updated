import { describe, it, expect } from 'vitest';
import { convertIngredient } from './recipe-conversion';

describe('convertIngredient', () => {
  it('butter 0.25 cup → ~56.75g', () => {
    const result = convertIngredient({
      name: 'butter', prepNote: 'cubed', qty: 0.25, nativeUnit: 'cup',
      sizeQualifier: null, weightHintGrams: null, weightHintOz: null,
    });
    expect(result.unitCanonical).toBe('g');
    expect(result.qtyCanonical).toBeCloseTo(56.75, 1);
  });

  it('broccoli florets 4 cup with hint 8oz → 226.8g (uses weight hint)', () => {
    const result = convertIngredient({
      name: 'broccoli florets', prepNote: null, qty: 4, nativeUnit: 'cup',
      sizeQualifier: null, weightHintGrams: null, weightHintOz: 8,
    });
    expect(result.unitCanonical).toBe('g');
    expect(result.qtyCanonical).toBeCloseTo(226.8, 1);
    expect(result.conversionNote).toContain('weight hint');
    expect(result.lowConfidence).toBe(false);
  });

  it('chicken stock 3 cup → ml (liquid)', () => {
    const result = convertIngredient({
      name: 'chicken stock', prepNote: null, qty: 3, nativeUnit: 'cup',
      sizeQualifier: null, weightHintGrams: null, weightHintOz: null,
    });
    expect(result.unitCanonical).toBe('ml');
    expect(result.qtyCanonical).toBeCloseTo(709.8, 1);
  });

  it('half-and-half cream 2 cup → ml (liquid)', () => {
    const result = convertIngredient({
      name: 'half-and-half cream', prepNote: null, qty: 2, nativeUnit: 'cup',
      sizeQualifier: null, weightHintGrams: null, weightHintOz: null,
    });
    expect(result.unitCanonical).toBe('ml');
    expect(result.qtyCanonical).toBeCloseTo(473.2, 1);
  });

  it('2 garlic cloves → 2 each (~0.21 oz equivalent)', () => {
    const result = convertIngredient({
      name: 'garlic cloves', prepNote: 'minced', qty: 2, nativeUnit: 'clove',
      sizeQualifier: null, weightHintGrams: null, weightHintOz: null,
    });
    expect(result.unitCanonical).toBe('each');
    expect(result.qtyCanonical).toBe(2);
    expect(result.ozEquivalent).toBeCloseTo(0.21, 1);
    expect(result.lowConfidence).toBe(false);
  });

  it('1 large carrot → 1 each (confident via size+name lookup)', () => {
    const result = convertIngredient({
      name: 'large carrot', prepNote: 'finely chopped', qty: 1, nativeUnit: 'each',
      sizeQualifier: 'large', weightHintGrams: null, weightHintOz: null,
    });
    expect(result.unitCanonical).toBe('each');
    expect(result.qtyCanonical).toBe(1);
    expect(result.lowConfidence).toBe(false);
  });

  it('2 bay leaves → 2 each', () => {
    const result = convertIngredient({
      name: 'bay leaves', prepNote: null, qty: 2, nativeUnit: 'leaf',
      sizeQualifier: null, weightHintGrams: null, weightHintOz: null,
    });
    expect(result.unitCanonical).toBe('each');
    expect(result.qtyCanonical).toBe(2);
  });

  it('0.5 tsp salt → 3g', () => {
    const result = convertIngredient({
      name: 'salt', prepNote: null, qty: 0.5, nativeUnit: 'tsp',
      sizeQualifier: null, weightHintGrams: null, weightHintOz: null,
    });
    expect(result.unitCanonical).toBe('g');
    expect(result.qtyCanonical).toBeCloseTo(3, 1);
  });

  it('0.25 cup cornstarch → ~32g', () => {
    const result = convertIngredient({
      name: 'cornstarch', prepNote: null, qty: 0.25, nativeUnit: 'cup',
      sizeQualifier: null, weightHintGrams: null, weightHintOz: null,
    });
    expect(result.unitCanonical).toBe('g');
    expect(result.qtyCanonical).toBeCloseTo(32, 1);
  });

  it('NEVER defaults to oz for unknown solid in volume — falls back to ml + lowConfidence', () => {
    const result = convertIngredient({
      name: 'mystery ingredient xyz', prepNote: null, qty: 1, nativeUnit: 'cup',
      sizeQualifier: null, weightHintGrams: null, weightHintOz: null,
    });
    expect(result.unitCanonical).toBe('ml');
    expect(result.lowConfidence).toBe(true);
    expect(result.conversionNote).toBeTruthy();
  });

  it('explicit grams hint overrides volume unit', () => {
    const result = convertIngredient({
      name: 'flour', prepNote: null, qty: 2, nativeUnit: 'cup',
      sizeQualifier: null, weightHintGrams: 240, weightHintOz: null,
    });
    expect(result.unitCanonical).toBe('g');
    expect(result.qtyCanonical).toBe(240);
    expect(result.conversionNote).toContain('240g');
  });

  it('pinch of salt → 0.5g', () => {
    const result = convertIngredient({
      name: 'salt', prepNote: null, qty: 1, nativeUnit: 'pinch',
      sizeQualifier: null, weightHintGrams: null, weightHintOz: null,
    });
    expect(result.unitCanonical).toBe('g');
    expect(result.qtyCanonical).toBeCloseTo(0.5, 2);
  });

  it('1 lb chicken breast → ~453.6g', () => {
    const result = convertIngredient({
      name: 'chicken breast', prepNote: null, qty: 1, nativeUnit: 'lb',
      sizeQualifier: null, weightHintGrams: null, weightHintOz: null,
    });
    expect(result.unitCanonical).toBe('g');
    expect(result.qtyCanonical).toBeCloseTo(453.6, 1);
  });

  it('unitConfidence defaults to 100 when omitted', () => {
    const result = convertIngredient({
      name: 'butter', prepNote: null, qty: 0.25, nativeUnit: 'cup',
      sizeQualifier: null, weightHintGrams: null, weightHintOz: null,
    });
    expect(result.unitConfidence).toBe(100);
  });

  it('unitConfidence=90 (column-based) does NOT set lowConfidence for a confident conversion', () => {
    const result = convertIngredient({
      name: 'milk', prepNote: null, qty: 1250, nativeUnit: 'ml',
      sizeQualifier: null, weightHintGrams: null, weightHintOz: null,
      unitConfidence: 90,
    });
    expect(result.unitConfidence).toBe(90);
    expect(result.unitCanonical).toBe('ml');
    expect(result.lowConfidence).toBe(false);
  });

  it('unitConfidence=50 sets lowConfidence=true and adds note', () => {
    const result = convertIngredient({
      name: 'milk', prepNote: null, qty: 1250, nativeUnit: 'ml',
      sizeQualifier: null, weightHintGrams: null, weightHintOz: null,
      unitConfidence: 50,
    });
    expect(result.unitConfidence).toBe(50);
    expect(result.lowConfidence).toBe(true);
    expect(result.conversionNote).toContain('50%');
  });

  it('unitConfidence=50 on a weight unit still converts correctly but flags lowConfidence', () => {
    const result = convertIngredient({
      name: 'corn flour', prepNote: null, qty: 100, nativeUnit: 'g',
      sizeQualifier: null, weightHintGrams: null, weightHintOz: null,
      unitConfidence: 50,
    });
    expect(result.unitCanonical).toBe('g');
    expect(result.qtyCanonical).toBeCloseTo(100, 1);
    expect(result.lowConfidence).toBe(true);
    expect(result.conversionNote).toContain('50%');
  });
});
