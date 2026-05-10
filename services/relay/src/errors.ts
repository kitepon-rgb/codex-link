export class RelayError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
  }
}

export class RelayAuthnError extends RelayError {
  constructor(message = "Authentication required") {
    super(message, "AUTHENTICATION_REQUIRED");
  }
}

export class RelayAuthzError extends RelayError {
  constructor(message = "Host access denied") {
    super(message, "HOST_ACCESS_DENIED");
  }
}

export class RelayNotFoundError extends RelayError {
  constructor(message = "Not found") {
    super(message, "NOT_FOUND");
  }
}
