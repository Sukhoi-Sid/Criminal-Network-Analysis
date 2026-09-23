export class ApplicationError extends Error {
  constructor(
    public message: string,
    public code: string = 'APP_ERROR',
    public details?: unknown,
  ) {
    super(message);
    this.name = 'ApplicationError';
  }
}

export class ValidationError extends ApplicationError {
  constructor(message: string, details?: unknown) {
    super(message, 'VALIDATION_ERROR', details);
    this.name = 'ValidationError';
  }
}

export class UnauthorizedError extends ApplicationError {
  constructor(message: string = 'Unauthorized') {
    super(message, 'UNAUTHORIZED', undefined);
    this.name = 'UnauthorizedError';
  }
}

export class ForbiddenError extends ApplicationError {
  constructor(message: string = 'Forbidden') {
    super(message, 'FORBIDDEN', undefined);
    this.name = 'ForbiddenError';
  }
}

export class NotFoundError extends ApplicationError {
  constructor(message: string = 'Not found') {
    super(message, 'NOT_FOUND', undefined);
    this.name = 'NotFoundError';
  }
}

export class DatabaseError extends ApplicationError {
  constructor(message: string, details?: unknown) {
    super(message, 'DATABASE_ERROR', details);
    this.name = 'DatabaseError';
  }
}

export class FileError extends ApplicationError {
  constructor(message: string, details?: unknown) {
    super(message, 'FILE_ERROR', details);
    this.name = 'FileError';
  }
}
