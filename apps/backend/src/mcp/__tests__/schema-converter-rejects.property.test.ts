/**
 * Property-Based Test — Property 3: JSON Schema → Zod Conversion Rejects Non-Conforming Input
 *
 * **Validates: Requirements 1.5.6, 1.4.6**
 *
 * For any valid JSON Schema object using types string, number, integer,
 * boolean, array, object (with optional enum, required, description
 * constraints), and for any input value that does NOT conform to that
 * JSON Schema (wrong type, missing required field, value outside enum),
 * converting the schema to Zod via jsonSchemaToZod() and then validating
 * the input SHALL reject it with a descriptive error.
 *
 * Generator strategy:
 *   - Generate JSON Schema trees (recursive: object with nested properties,
 *     arrays, enums).
 *   - Generate non-conforming values for each schema (wrong type, missing
 *     required, outside enum).
 *   - Validate via converted Zod — must reject.
 */
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { jsonSchemaToZod } from '../schema-converter.js';
import type { JSONSchemaProperty } from '../schema-converter.js';

// ---------------------------------------------------------------------------
// Helpers — generators that produce { schema, nonConformingValue } tuples
// ---------------------------------------------------------------------------

/**
 * Given a JSON Schema type string, return an Arbitrary that generates values
 * of a DIFFERENT type (guaranteed non-conforming by type mismatch).
 */
function wrongTypeValue(schemaType: string): fc.Arbitrary<unknown> {
  // Map each type to arbitraries that produce values of OTHER types
  const generators: Record<string, fc.Arbitrary<unknown>> = {
    string: fc.oneof(
      fc.double({ noNaN: true, noDefaultInfinity: true }),
      fc.boolean(),
      fc.integer(),
    ),
    number: fc.oneof(fc.string(), fc.boolean()),
    integer: fc.oneof(fc.string(), fc.boolean()),
    boolean: fc.oneof(fc.string(), fc.integer()),
    array: fc.oneof(fc.string(), fc.integer(), fc.boolean()),
    object: fc.oneof(fc.string(), fc.integer(), fc.boolean()),
  };

  return generators[schemaType] ?? fc.constant('__wrong__');
}

// ---------------------------------------------------------------------------
// Wrong-type generators for each primitive schema
// ---------------------------------------------------------------------------

/** String schema with a non-string value. */
const stringSchemaWrongType = fc.record({
  schema: fc.constant({ type: 'string' } as JSONSchemaProperty),
  nonConformingValue: wrongTypeValue('string'),
});

/** Number schema with a non-number value. */
const numberSchemaWrongType = fc.record({
  schema: fc.constant({ type: 'number' } as JSONSchemaProperty),
  nonConformingValue: wrongTypeValue('number'),
});

/** Integer schema with a non-integer value. */
const integerSchemaWrongType = fc.record({
  schema: fc.constant({ type: 'integer' } as JSONSchemaProperty),
  nonConformingValue: wrongTypeValue('integer'),
});

/** Boolean schema with a non-boolean value. */
const booleanSchemaWrongType = fc.record({
  schema: fc.constant({ type: 'boolean' } as JSONSchemaProperty),
  nonConformingValue: wrongTypeValue('boolean'),
});

/** Array schema with a non-array value. */
const arraySchemaWrongType = fc.record({
  schema: fc.constant({
    type: 'array',
    items: { type: 'string' },
  } as JSONSchemaProperty),
  nonConformingValue: wrongTypeValue('array'),
});

/** Object schema with a non-object value. */
const objectSchemaWrongType = fc.record({
  schema: fc.constant({
    type: 'object',
    properties: { a: { type: 'string' } },
    required: ['a'],
  } as JSONSchemaProperty),
  nonConformingValue: wrongTypeValue('object'),
});

// ---------------------------------------------------------------------------
// Enum violation generator
// ---------------------------------------------------------------------------

/**
 * Generate a string enum schema and a value that is NOT in the enum.
 */
const enumSchemaOutsideValue = fc
  .array(fc.stringMatching(/^[a-zA-Z][a-zA-Z0-9]{0,9}$/), {
    minLength: 1,
    maxLength: 8,
  })
  .chain((enumValues) => {
    const unique = [...new Set(enumValues)];
    if (unique.length === 0) return fc.constant(null);
    const schema: JSONSchemaProperty = { type: 'string', enum: unique };
    // Generate a string that is NOT in the enum
    return fc
      .string({ minLength: 1 })
      .filter((v) => !unique.includes(v))
      .map((nonConformingValue) => ({ schema, nonConformingValue }));
  })
  .filter(
    (
      x,
    ): x is { schema: JSONSchemaProperty; nonConformingValue: string } =>
      x !== null,
  );

// ---------------------------------------------------------------------------
// Missing required field generator
// ---------------------------------------------------------------------------

/**
 * Generate an object schema with at least one required field, then produce
 * a value that is missing one of the required fields.
 */
const objectSchemaMissingRequired = fc
  .array(
    fc.tuple(
      fc.stringMatching(/^[a-zA-Z][a-zA-Z0-9]{0,7}$/),
      fc.constantFrom('string', 'number', 'boolean'),
    ),
    { minLength: 1, maxLength: 5 },
  )
  .chain((entries) => {
    // Deduplicate keys
    const seen = new Set<string>();
    const uniqueEntries = entries.filter(([key]) => {
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    if (uniqueEntries.length === 0) return fc.constant(null);

    const properties: Record<string, JSONSchemaProperty> = {};
    const allKeys: string[] = [];

    for (const [key, type] of uniqueEntries) {
      properties[key] = { type } as JSONSchemaProperty;
      allKeys.push(key);
    }

    // Mark ALL keys as required
    const schema: JSONSchemaProperty = {
      type: 'object',
      properties,
      required: allKeys,
    };

    // Pick a random required key to omit
    return fc.constantFrom(...allKeys).map((keyToOmit) => {
      // Build a value with conforming types but missing one required key
      const value: Record<string, unknown> = {};
      for (const [key, type] of uniqueEntries) {
        if (key === keyToOmit) continue; // omit this required field
        switch (type) {
          case 'string':
            value[key] = 'test';
            break;
          case 'number':
            value[key] = 42;
            break;
          case 'boolean':
            value[key] = true;
            break;
        }
      }
      return { schema, nonConformingValue: value };
    });
  })
  .filter(
    (
      x,
    ): x is {
      schema: JSONSchemaProperty;
      nonConformingValue: Record<string, unknown>;
    } => x !== null,
  );

// ---------------------------------------------------------------------------
// Wrong-type inside array items generator
// ---------------------------------------------------------------------------

/**
 * Generate an array schema with typed items, then produce an array
 * containing at least one element of the wrong type.
 */
const arraySchemaWrongItemType = fc
  .constantFrom('string', 'number', 'integer', 'boolean')
  .chain((itemType) => {
    const schema: JSONSchemaProperty = {
      type: 'array',
      items: { type: itemType },
    };
    // Generate an array with at least one wrong-type element
    return wrongTypeValue(itemType).map((badItem) => ({
      schema,
      nonConformingValue: [badItem],
    }));
  });

// ---------------------------------------------------------------------------
// Wrong-type inside object property generator
// ---------------------------------------------------------------------------

/**
 * Generate an object schema with a required property of a specific type,
 * then provide a value where that property has the wrong type.
 */
const objectSchemaWrongPropertyType = fc
  .tuple(
    fc.stringMatching(/^[a-zA-Z][a-zA-Z0-9]{0,7}$/),
    fc.constantFrom('string', 'number', 'integer', 'boolean'),
  )
  .chain(([key, propType]) => {
    const schema: JSONSchemaProperty = {
      type: 'object',
      properties: { [key]: { type: propType } },
      required: [key],
    };
    return wrongTypeValue(propType).map((badValue) => ({
      schema,
      nonConformingValue: { [key]: badValue },
    }));
  });

// ---------------------------------------------------------------------------
// Combined non-conforming generator (all violation strategies)
// ---------------------------------------------------------------------------

const allNonConforming: fc.Arbitrary<{
  schema: JSONSchemaProperty;
  nonConformingValue: unknown;
}> = fc.oneof(
  // Wrong type for primitives
  stringSchemaWrongType,
  numberSchemaWrongType,
  integerSchemaWrongType,
  booleanSchemaWrongType,
  arraySchemaWrongType,
  objectSchemaWrongType,
  // Enum violation
  enumSchemaOutsideValue,
  // Missing required field
  objectSchemaMissingRequired,
  // Wrong type inside array items
  arraySchemaWrongItemType,
  // Wrong type inside object property
  objectSchemaWrongPropertyType,
);

// ---------------------------------------------------------------------------
// Property tests
// ---------------------------------------------------------------------------

describe('Property 3: JSON Schema → Zod Conversion Rejects Non-Conforming Input', () => {
  it('should reject wrong-type values for string schemas (Req 1.5.6)', () => {
    fc.assert(
      fc.property(stringSchemaWrongType, ({ schema, nonConformingValue }) => {
        const zodSchema = jsonSchemaToZod(schema);
        const result = zodSchema.safeParse(nonConformingValue);
        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.issues.length).toBeGreaterThan(0);
        }
      }),
      { numRuns: 100 },
    );
  });

  it('should reject wrong-type values for number schemas (Req 1.5.6)', () => {
    fc.assert(
      fc.property(numberSchemaWrongType, ({ schema, nonConformingValue }) => {
        const zodSchema = jsonSchemaToZod(schema);
        const result = zodSchema.safeParse(nonConformingValue);
        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.issues.length).toBeGreaterThan(0);
        }
      }),
      { numRuns: 100 },
    );
  });

  it('should reject wrong-type values for integer schemas (Req 1.5.6)', () => {
    fc.assert(
      fc.property(integerSchemaWrongType, ({ schema, nonConformingValue }) => {
        const zodSchema = jsonSchemaToZod(schema);
        const result = zodSchema.safeParse(nonConformingValue);
        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.issues.length).toBeGreaterThan(0);
        }
      }),
      { numRuns: 100 },
    );
  });

  it('should reject wrong-type values for boolean schemas (Req 1.5.6)', () => {
    fc.assert(
      fc.property(booleanSchemaWrongType, ({ schema, nonConformingValue }) => {
        const zodSchema = jsonSchemaToZod(schema);
        const result = zodSchema.safeParse(nonConformingValue);
        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.issues.length).toBeGreaterThan(0);
        }
      }),
      { numRuns: 100 },
    );
  });

  it('should reject wrong-type values for array schemas (Req 1.5.6)', () => {
    fc.assert(
      fc.property(arraySchemaWrongType, ({ schema, nonConformingValue }) => {
        const zodSchema = jsonSchemaToZod(schema);
        const result = zodSchema.safeParse(nonConformingValue);
        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.issues.length).toBeGreaterThan(0);
        }
      }),
      { numRuns: 100 },
    );
  });

  it('should reject wrong-type values for object schemas (Req 1.5.6)', () => {
    fc.assert(
      fc.property(objectSchemaWrongType, ({ schema, nonConformingValue }) => {
        const zodSchema = jsonSchemaToZod(schema);
        const result = zodSchema.safeParse(nonConformingValue);
        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.issues.length).toBeGreaterThan(0);
        }
      }),
      { numRuns: 100 },
    );
  });

  it('should reject values outside enum constraints (Req 1.5.6)', () => {
    fc.assert(
      fc.property(enumSchemaOutsideValue, ({ schema, nonConformingValue }) => {
        const zodSchema = jsonSchemaToZod(schema);
        const result = zodSchema.safeParse(nonConformingValue);
        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.issues.length).toBeGreaterThan(0);
        }
      }),
      { numRuns: 100 },
    );
  });

  it('should reject objects with missing required fields (Req 1.5.6)', () => {
    fc.assert(
      fc.property(
        objectSchemaMissingRequired,
        ({ schema, nonConformingValue }) => {
          const zodSchema = jsonSchemaToZod(schema);
          const result = zodSchema.safeParse(nonConformingValue);
          expect(result.success).toBe(false);
          if (!result.success) {
            expect(result.error.issues.length).toBeGreaterThan(0);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('should reject arrays with wrong-type items (Req 1.5.6)', () => {
    fc.assert(
      fc.property(
        arraySchemaWrongItemType,
        ({ schema, nonConformingValue }) => {
          const zodSchema = jsonSchemaToZod(schema);
          const result = zodSchema.safeParse(nonConformingValue);
          expect(result.success).toBe(false);
          if (!result.success) {
            expect(result.error.issues.length).toBeGreaterThan(0);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('should reject objects with wrong-type property values (Req 1.5.6)', () => {
    fc.assert(
      fc.property(
        objectSchemaWrongPropertyType,
        ({ schema, nonConformingValue }) => {
          const zodSchema = jsonSchemaToZod(schema);
          const result = zodSchema.safeParse(nonConformingValue);
          expect(result.success).toBe(false);
          if (!result.success) {
            expect(result.error.issues.length).toBeGreaterThan(0);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('should reject non-conforming input across all violation strategies (Req 1.5.6, 1.4.6)', () => {
    fc.assert(
      fc.property(allNonConforming, ({ schema, nonConformingValue }) => {
        const zodSchema = jsonSchemaToZod(schema);
        const result = zodSchema.safeParse(nonConformingValue);
        expect(result.success).toBe(false);
        if (!result.success) {
          // Verify the error contains descriptive issue information
          expect(result.error.issues.length).toBeGreaterThan(0);
          for (const issue of result.error.issues) {
            expect(issue.message).toBeTruthy();
          }
        }
      }),
      { numRuns: 100 },
    );
  });
});
