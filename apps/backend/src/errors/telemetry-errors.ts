/**
 * Telemetry-related error classes for event validation failures.
 */

// ---------------------------------------------------------------------------
// TelemetryValidationError
// ---------------------------------------------------------------------------

export class TelemetryValidationError extends Error {
  public readonly missingFields: string[];

  constructor(missingFields: string[]) {
    super(
      `Telemetry event rejected: missing required fields: ${missingFields.join(', ')}`,
    );
    this.name = 'TelemetryValidationError';
    this.missingFields = missingFields;
  }
}
