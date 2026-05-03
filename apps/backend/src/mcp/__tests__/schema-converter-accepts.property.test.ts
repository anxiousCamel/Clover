/**
 * Property-Based Test — Property 2: JSON Schema → Zod Conversion Accepts Conforming Input
 *
 * **Validates: Requirements 1.5.1, 1.5.2, 1.5.3, 1.5.4, 1.5.5, 1.3.2**
 *
 * For any valid JSON Schema object using types string, number, integer,
 * boolean, array, object (with optional enum, required, description
 * constraints), and for any input value that conforms to that JSON Schema,
 * converting the schema to Zod via jsonSchemaToZod() and then validating
 * the input SHALL accept it.
 *
 * Generator strategy:
 *   - Generate JSON Schema trees (recursive: object with nested properties,
 *     arrays, enums).
 *   - Generate conforming values from each schema.
 *   - Validate via converted Zod — must accept.
 */
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { jsonSchemaToZod } from '../schema-converter.js';
import type { JSONSchemaProperty } from '../schema-converter.js';

// ---------------------------------------------------------------------------
// Helpers — paired generators that produce { schema, value } tuples
// ---------------------------------------------------------------------------

/**
 * Each generator returns an Arbitrary<{ schema: JSONSchemaProperty; value: unknown }>
 * where `value` is guaranteed to conform to `schema`.
 */

/** String schema with a conforming string value. */
const stringSchemaAndValue = fc.record({
  schema: fc.constant({ type: 'string' } as JSONSchemaProperty),
  value: fc.string(),
});

/** String schema with enum constraint and a conforming enum value. */
const enumSchemaAndValue = fc
  .array(fc.stringMatching(/^[a-zA-Z][a-zA-Z0-9]{0,9}$/), {
    minLength: 1,
    maxLength: 8,
  })
  .chain((enumValues) => {
    // Deduplicate to avoid z.enum issues with duplicates
    const unique = [...new Set(enumValues)];
    if (unique.length === 0) return fc.constant(null);
    const schema: JSONSchemaProperty = { type: 'string', enum: unique };
    return fc.constantFrom(...unique).map((value) => ({ schema, value }));
  })
  .filter((x): x is { schema: JSONSchemaProperty; value: string } => x !== null);

/** Number schema with a conforming number value. */
const numberSchemaAndValue = fc.record({
  schema: fc.constant({ type: 'number' } as JSONSchemaProperty),
  value: fc.double({ noNaN: true, noDefaultInfinity: true }),
});

/** Integer schema with a conforming integer value. */
const integerSchemaAndValue = fc.record({
  schema: fc.constant({ type: 'integer' } as JSONSchemaProperty),
  value: fc.integer(),
});

/** Boolean schema with a conforming boolean value. */
const booleanSchemaAndValue = fc.record({
  schema: fc.constant({ type: 'boolean' } as JSONSchemaProperty),
  value: fc.boolean(),
});

// ---------------------------------------------------------------------------
// Leaf schema+value — any primitive type
// ---------------------------------------------------------------------------

const leafSchemaAndValue: fc.Arbitrary<{
  schema: JSONSchemaProperty;
  value: unknown;
}> = fc.oneof(
  stringSchemaAndValue,
  enumSchemaAndValue,
  numberSchemaAndValue,
  integerSchemaAndValue,
  booleanSchemaAndValue,
);

// ---------------------------------------------------------------------------
// Recursive schema+value — arrays and objects built from leaves
// ---------------------------------------------------------------------------

/**
 * Build a recursive schema+value generator using fc.letrec.
 * Depth is bounded by fast-check's internal size control.
 */
const schemaAndValue: fc.Arbitrary<{
  schema: JSONSchemaProperty;
  value: unknown;
}> = fc.letrec((tie) => ({
  tree: fc.oneof(
    { depthSize: 'small', withCrossShrink: true },
    leafSchemaAndValue,
    tie('array'),
    tie('object'),
  ),

  array: tie('tree').chain(({ schema: itemSchema, value: itemValue }) =>
    fc
      .array(fc.constant(itemValue), { minLength: 0, maxLength: 5 })
      .map((items) => ({
        schema: {
          type: 'array',
          items: itemSchema,
        } as JSONSchemaProperty,
        value: items,
      })),
  ),

  object: fc
    .array(
      fc.tuple(
        fc.stringMatching(/^[a-zA-Z][a-zA-Z0-9]{0,7}$/),
        tie('tree'),
      ),
      { minLength: 0, maxLength: 5 },
    )
    .chain((entries) => {
      // Deduplicate keys
      const seen = new Set<string>();
      const uniqueEntries = entries.filter(([key]) => {
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

      const properties: Record<string, JSONSchemaProperty> = {};
      const conformingValue: Record<string, unknown> = {};
      const allKeys = uniqueEntries.map(([key]) => key);

      for (const [key, { schema, value }] of uniqueEntries) {
        properties[key] = schema;
        conformingValue[key] = value;
      }

      // Choose a random subset of keys to mark as required
      return fc
        .subarray(allKeys, { minLength: 0, maxLength: allKeys.length })
        .map((requiredKeys) => ({
          schema: {
            type: 'object',
            properties,
            required: requiredKeys,
          } as JSONSchemaProperty,
          // Conforming value includes ALL keys (required + optional)
          value: conformingValue,
        }));
    }),
})).tree;

// ---------------------------------------------------------------------------
// Optional description decorator
// ---------------------------------------------------------------------------

const withOptionalDescription: fc.Arbitrary<{
  schema: JSONSchemaProperty;
  value: unknown;
}> = schemaAndValue.chain(({ schema, value }) =>
  fc.option(fc.stringMatching(/^[a-zA-Z ]{1,30}$/), { nil: undefined }).map(
    (desc) => ({
      schema: desc ? { ...schema, description: desc } : schema,
      value,
    }),
  ),
);

// ---------------------------------------------------------------------------
// Property tests
// ---------------------------------------------------------------------------

describe('Property 2: JSON Schema → Zod Conversion Accepts Conforming Input', () => {
  it('should accept any conforming value for string schemas (Req 1.5.1)', () => {
    fc.assert(
      fc.property(stringSchemaAndValue, ({ schema, value }) => {
        const zodSchema = jsonSchemaToZod(schema);
        const result = zodSchema.safeParse(value);
        expect(result.success).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  it('should accept any conforming value for enum schemas (Req 1.5.3)', () => {
    fc.assert(
      fc.property(enumSchemaAndValue, ({ schema, value }) => {
        const zodSchema = jsonSchemaToZod(schema);
        const result = zodSchema.safeParse(value);
        expect(result.success).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  it('should accept any conforming value for number schemas (Req 1.5.1)', () => {
    fc.assert(
      fc.property(numberSchemaAndValue, ({ schema, value }) => {
        const zodSchema = jsonSchemaToZod(schema);
        const result = zodSchema.safeParse(value);
        expect(result.success).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  it('should accept any conforming value for integer schemas (Req 1.5.1)', () => {
    fc.assert(
      fc.property(integerSchemaAndValue, ({ schema, value }) => {
        const zodSchema = jsonSchemaToZod(schema);
        const result = zodSchema.safeParse(value);
        expect(result.success).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  it('should accept any conforming value for boolean schemas (Req 1.5.1)', () => {
    fc.assert(
      fc.property(booleanSchemaAndValue, ({ schema, value }) => {
        const zodSchema = jsonSchemaToZod(schema);
        const result = zodSchema.safeParse(value);
        expect(result.success).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  it('should accept conforming values for recursive schemas — arrays, objects, nested (Req 1.5.1, 1.5.2, 1.5.5, 1.3.2)', () => {
    fc.assert(
      fc.property(schemaAndValue, ({ schema, value }) => {
        const zodSchema = jsonSchemaToZod(schema);
        const result = zodSchema.safeParse(value);
        expect(result.success).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  it('should accept conforming values when description is present (Req 1.5.4)', () => {
    fc.assert(
      fc.property(withOptionalDescription, ({ schema, value }) => {
        const zodSchema = jsonSchemaToZod(schema);
        const result = zodSchema.safeParse(value);
        expect(result.success).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  it('should preserve description annotation after conversion (Req 1.5.4)', () => {
    fc.assert(
      fc.property(
        leafSchemaAndValue,
        fc.stringMatching(/^[a-zA-Z ]{1,30}$/),
        ({ schema }, desc) => {
          const schemaWithDesc = { ...schema, description: desc };
          const zodSchema = jsonSchemaToZod(schemaWithDesc);
          expect(zodSchema.description).toBe(desc);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('should accept conforming objects with required fields present (Req 1.5.2)', () => {
    // Generate objects where all required fields are present in the value
    const objectWithRequired = fc
      .array(
        fc.tuple(
          fc.stringMatching(/^[a-zA-Z][a-zA-Z0-9]{0,5}$/),
          leafSchemaAndValue,
        ),
        { minLength: 1, maxLength: 5 },
      )
      .chain((entries) => {
        const seen = new Set<string>();
        const uniqueEntries = entries.filter(([key]) => {
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });

        const properties: Record<string, JSONSchemaProperty> = {};
        const conformingValue: Record<string, unknown> = {};
        const allKeys = uniqueEntries.map(([key]) => key);

        for (const [key, { schema, value }] of uniqueEntries) {
          properties[key] = schema;
          conformingValue[key] = value;
        }

        // Mark ALL keys as required — value has them all, so it conforms
        return fc.constant({
          schema: {
            type: 'object',
            properties,
            required: allKeys,
          } as JSONSchemaProperty,
          value: conformingValue,
        });
      });

    fc.assert(
      fc.property(objectWithRequired, ({ schema, value }) => {
        const zodSchema = jsonSchemaToZod(schema);
        const result = zodSchema.safeParse(value);
        expect(result.success).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  it('should accept objects where optional fields are omitted (Req 1.5.2)', () => {
    // Generate objects with some optional fields, then omit them from value
    const objectWithOptionalOmitted = fc
      .array(
        fc.tuple(
          fc.stringMatching(/^[a-zA-Z][a-zA-Z0-9]{0,5}$/),
          leafSchemaAndValue,
        ),
        { minLength: 2, maxLength: 6 },
      )
      .chain((entries) => {
        const seen = new Set<string>();
        const uniqueEntries = entries.filter(([key]) => {
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });

        if (uniqueEntries.length < 2) {
          return fc.constant(null);
        }

        const properties: Record<string, JSONSchemaProperty> = {};
        const allKeys = uniqueEntries.map(([key]) => key);

        for (const [key, { schema }] of uniqueEntries) {
          properties[key] = schema;
        }

        // Mark only a strict subset as required
        return fc
          .subarray(allKeys, {
            minLength: 0,
            maxLength: Math.max(0, allKeys.length - 1),
          })
          .map((requiredKeys) => {
            const requiredSet = new Set(requiredKeys);
            // Value includes only required fields (omit optional ones)
            const conformingValue: Record<string, unknown> = {};
            for (const [key, { value }] of uniqueEntries) {
              if (requiredSet.has(key)) {
                conformingValue[key] = value;
              }
            }
            return {
              schema: {
                type: 'object',
                properties,
                required: requiredKeys,
              } as JSONSchemaProperty,
              value: conformingValue,
            };
          });
      })
      .filter(
        (x): x is { schema: JSONSchemaProperty; value: unknown } =>
          x !== null,
      );

    fc.assert(
      fc.property(objectWithOptionalOmitted, ({ schema, value }) => {
        const zodSchema = jsonSchemaToZod(schema);
        const result = zodSchema.safeParse(value);
        expect(result.success).toBe(true);
      }),
      { numRuns: 100 },
    );
  });
});
