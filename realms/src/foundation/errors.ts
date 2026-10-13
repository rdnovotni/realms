export class DomainError extends Error {
  constructor(public statusCode: number, public code: string) { super(code); }
}
