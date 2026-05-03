/**
 * Pure function converting JSON Schema objects to Zod schemas.
 *
 * Supports: string, number, integer, boolean, array, object types,
 * plus enum, required, and description constraints.
 *
 * Throws SchemaConversionError on unsupported types.
 */

import { z } from 'zod';
import { SchemaConversionError } from '../errors/mcp-errors.js';

// ---------------------------------------------------------------------------
// Public interface
// ---------------------------------------------------------------------------

export interface JSONSchemaProperty {
  type: string;
  description?: string;
  enum?: string[];
  items?: JSONSchemaProperty;
  properties?: Record<string, JSONSchemaProperty>;
  required?: string[];
}

// ---------------------------------------------------------------------------
// Converter
// ---------------------------------------------------------------------------

/**
 * Convert a JSON Schema property definition to a Zod schema.
 *
 * Handles `string` (with optional `enum`), `number`, `integer`, `boolean`,
 * `array` (recursive via `items`), and `object` (recursive via `properties`
 * with `required` support).
 *
 * Chains `.describe(description)` when a description is present.
 *
 * @throws {SchemaConversionError} when the schema type is unsupported.
 */
export function jsonSchemaToZod(schema: JSONSchemaProperty): z.ZodTypeAny {
  let zodSchema: z.ZodTypeAny;

  switch (schema.type) {
    case 'string': {
      if (schema.enum && schema.enum.length > 0) {
        zodSchema = z.enum(schema.enum as [string, ...string[]]);
      } else {
        zodSchema = z.string();
      }
      break;
    }

    case 'number': {
      zodSchema = z.number();
      break;
    }

    case 'integer': {
      zodSchema = z.number().int();
      break;
    }

    case 'boolean': {
      zodSchema = z.boolean();
      break;
    }

    case 'array': {
      const itemSchema = schema.items
        ? jsonSchemaToZod(schema.items)
        : z.unknown();
      zodSchema = z.array(itemSchema);
      break;
    }

    case 'object': {
      const shape: Record<string, z.ZodTypeAny> = {};
      const requiredFields = new Set(schema.required ?? []);

      if (schema.properties) {
        for (const [key, prop] of Object.entries(schema.properties)) {
          const fieldSchema = jsonSchemaToZod(prop);
          shape[key] = requiredFields.has(key)
            ? fieldSchema
            : fieldSchema.optional();
        }
      }

      zodSchema = z.object(shape);
      break;
    }

    default: {
      throw new SchemaConversionError(
        '',
        '',
        `Unsupported JSON Schema type: "${schema.type}"`,
      );
    }
  }

  if (schema.description) {
    zodSchema = zodSchema.describe(schema.description);
  }

  return zodSchema;
}
