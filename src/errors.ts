/**
 * Typed errors. Callers decide what to do from the class, never from message text.
 *
 * - QuotaExhaustedError: the project is over its model quota right now. Waiting and
 *   retrying is the right response.
 * - TransientError: a network blip or a 5xx. Retrying is safe.
 * - UnrecoverableError: bad input, missing permission, content filtered, deadline
 *   passed. Retrying the same request will not help.
 */
export class VideoGenerationError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = new.target.name;
  }
}

export class QuotaExhaustedError extends VideoGenerationError {}

export class TransientError extends VideoGenerationError {}

export class UnrecoverableError extends VideoGenerationError {}

/** The service finished but returned no video because a safety filter removed it. */
export class ContentFilteredError extends UnrecoverableError {
  constructor(
    message: string,
    public readonly reasons: string[] = [],
  ) {
    super(message);
  }
}

/** The operation was still running when our deadline passed. The operation itself may still finish. */
export class PollDeadlineError extends UnrecoverableError {
  constructor(
    public readonly operationName: string,
    public readonly deadlineMs: number,
  ) {
    super(`Operation ${operationName} still running after ${Math.round(deadlineMs / 1000)}s`);
  }
}

export class OptionValidationError extends VideoGenerationError {
  constructor(
    public readonly field: string,
    message: string,
  ) {
    super(message);
  }
}
