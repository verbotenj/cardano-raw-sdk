/**
 * Security middleware for the Cardano Raw SDK API server.
 *
 * Provides configurable security features:
 * - CORS (Cross-Origin Resource Sharing)
 * - Rate limiting
 * - Optional API key authentication
 * - Request body size limits
 *
 * All settings are configurable via environment variables to allow
 * clients to customize security based on their deployment requirements.
 */

import type { Express, Request, Response, NextFunction } from "express";
import rateLimit from "express-rate-limit";
import cors from "cors";

export interface SecurityConfig {
  maxBodySize: string;
  rateLimitWindowMs: number;
  rateLimitMaxRequests: number;
  corsOrigins: string | string[];
  apiKeyEnabled: boolean;
  apiKey?: string;
}

/**
 * Load security configuration from environment variables.
 * All values have sensible defaults for development.
 */
const getConfig = (): SecurityConfig => ({
  maxBodySize: process.env.MAX_BODY_SIZE || "1mb",
  rateLimitWindowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || "900000", 10), // 15 minutes
  rateLimitMaxRequests: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || "100", 10),
  corsOrigins: process.env.CORS_ORIGINS ? process.env.CORS_ORIGINS.split(",") : "*",
  apiKeyEnabled: process.env.API_KEY_ENABLED === "true",
  apiKey: process.env.API_KEY,
});

/**
 * Apply security middleware to the Express application.
 *
 * Order of middleware:
 * 1. CORS - Handle cross-origin requests
 * 2. Rate limiting - Prevent abuse
 * 3. API key auth (optional) - Require authentication header
 *
 * @param app - Express application instance
 */
export const applySecurityMiddleware = (app: Express): void => {
  const config = getConfig();

  // CORS configuration
  app.use(
    cors({
      origin: config.corsOrigins,
      methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Authorization", "X-API-Key"],
      credentials: true,
    })
  );

  // Rate limiting
  app.use(
    rateLimit({
      windowMs: config.rateLimitWindowMs,
      max: config.rateLimitMaxRequests,
      message: { success: false, error: "Too many requests, please try again later" },
      standardHeaders: true,
      legacyHeaders: false,
      // Skip rate limiting for health checks
      skip: (req: Request) => req.path === "/health",
    })
  );

  // Optional API key authentication
  if (config.apiKeyEnabled && config.apiKey) {
    app.use((req: Request, res: Response, next: NextFunction) => {
      // Skip auth for health check and documentation endpoints
      const publicPaths = ["/health", "/api-docs", "/docs"];
      if (publicPaths.some((p) => req.path.startsWith(p))) {
        return next();
      }

      const providedKey = req.headers["x-api-key"];
      if (providedKey !== config.apiKey) {
        return res.status(401).json({
          success: false,
          error: "Invalid or missing API key",
          code: "UNAUTHORIZED",
        });
      }

      next();
    });
  }
};

/**
 * Get the configured max body size for use in express.json() middleware.
 * @returns Max body size string (e.g., "1mb", "100kb")
 */
export const getMaxBodySize = (): string => process.env.MAX_BODY_SIZE || "1mb";
