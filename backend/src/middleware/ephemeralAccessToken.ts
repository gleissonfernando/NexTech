import type { NextFunction, Request, Response } from "express";
import { extractBearerToken, validateEphemeralAccessToken, type EphemeralAccessTokenPayload } from "../services/ephemeralAccessTokenService";

export function requireEphemeralAccessToken(requiredScopes: string[] = []) {
  return (req: Request, res: Response, next: NextFunction) => {
    const validation = validateEphemeralAccessToken(extractBearerToken(req.header("authorization")), {
      requiredScopes
    });

    if (!validation.ok) {
      return res.status(validation.status).json({
        success: false,
        error: validation.code,
        message: validation.message
      });
    }

    res.setHeader("X-Ephemeral-Token-Remaining", String(validation.remainingRequests));
    (res.locals as Record<string, unknown>).ephemeralAccessToken = validation.payload satisfies EphemeralAccessTokenPayload;
    return next();
  };
}
