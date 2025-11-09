import { Request, Response, NextFunction } from 'express';
import { body, validationResult } from 'express-validator';
import rateLimit from 'express-rate-limit';
import slowDown from 'express-slow-down';
import winston from 'winston';

// Logger configuration
export const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({ filename: 'error.log', level: 'error' }),
    new winston.transports.File({ filename: 'combined.log' }),
    new winston.transports.Console({
      format: winston.format.simple()
    })
  ]
});

// Rate limiting middleware
export const createRateLimit = (windowMs: number, max: number, message: string) => {
  return rateLimit({
    windowMs,
    max,
    message: { error: message },
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req: Request, res: Response) => {
      logger.warn(`Rate limit exceeded for IP: ${req.ip}, path: ${req.path}`);
      res.status(429).json({ error: message });
    }
  });
};

// Slow down middleware for progressive delays
export const createSlowDown = (windowMs: number, delayAfter: number, delayMs: number) => {
  return slowDown({
    windowMs,
    delayAfter,
    delayMs,
    maxDelayMs: delayMs * 10
  });
};

// Input validation middleware
// SECURITY: Server controls amount based on identity, client only provides address
export const validateFaucetRequest = [
  body('address')
    .isString()
    .trim()
    .isLength({ min: 66, max: 66 })
    .matches(/^0x[0-9a-fA-F]{64}$/)
    .withMessage('Invalid address format - must be 0x followed by 64 hex characters'),
  // REMOVED: amount validation - server determines amount based on identity

  (req: Request, res: Response, next: NextFunction) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      logger.warn(`Validation error for IP: ${req.ip}`, { errors: errors.array() });
      return res.status(400).json({
        error: 'Invalid request parameters',
        details: errors.array()
      });
    }
    next();
  }
];

// Security headers middleware
export const securityHeaders = (req: Request, res: Response, next: NextFunction) => {
  // Remove server identification
  res.removeHeader('X-Powered-By');
  
  // Set security headers
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Content-Security-Policy', "default-src 'self'");
  
  next();
};

// IP extraction middleware with proxy support
export const getClientIP = (req: Request): string => {
  const forwarded = req.headers['x-forwarded-for'] as string;
  const realIP = req.headers['x-real-ip'] as string;
  
  if (forwarded) {
    return forwarded.split(',')[0].trim();
  }
  
  if (realIP) {
    return realIP;
  }
  
  return req.connection.remoteAddress || req.socket.remoteAddress || 'unknown';
};

// Request logging middleware
export const requestLogger = (req: Request, res: Response, next: NextFunction) => {
  const start = Date.now();
  const ip = getClientIP(req);
  
  res.on('finish', () => {
    const duration = Date.now() - start;
    logger.info(`${req.method} ${req.path}`, {
      ip,
      statusCode: res.statusCode,
      duration,
      userAgent: req.headers['user-agent'],
      body: req.method === 'POST' ? req.body : undefined
    });
  });
  
  next();
};

// DDoS protection - detect and block suspicious patterns
export class DDoSProtection {
  private suspiciousIPs: Map<string, { count: number; firstSeen: number }> = new Map();
  private blockedIPs: Set<string> = new Set();
  private readonly SUSPICIOUS_THRESHOLD = 50; // requests per minute
  private readonly BLOCK_DURATION = 15 * 60 * 1000; // 15 minutes
  private readonly WINDOW_SIZE = 60 * 1000; // 1 minute

  public middleware = (req: Request, res: Response, next: NextFunction) => {
    const ip = getClientIP(req);
    
    // Check if IP is currently blocked
    if (this.blockedIPs.has(ip)) {
      logger.warn(`Blocked IP attempted access: ${ip}`);
      return res.status(429).json({ error: 'IP temporarily blocked due to suspicious activity' });
    }

    // Track request patterns
    const now = Date.now();
    const existing = this.suspiciousIPs.get(ip);
    
    if (existing) {
      // Reset if window expired
      if (now - existing.firstSeen > this.WINDOW_SIZE) {
        this.suspiciousIPs.set(ip, { count: 1, firstSeen: now });
      } else {
        existing.count++;
        
        // Block if threshold exceeded
        if (existing.count > this.SUSPICIOUS_THRESHOLD) {
          this.blockedIPs.add(ip);
          this.suspiciousIPs.delete(ip);
          
          logger.error(`IP blocked for DDoS protection: ${ip}`, {
            requestCount: existing.count,
            timeWindow: this.WINDOW_SIZE
          });
          
          // Auto-unblock after duration
          setTimeout(() => {
            this.blockedIPs.delete(ip);
            logger.info(`IP unblocked: ${ip}`);
          }, this.BLOCK_DURATION);
          
          return res.status(429).json({ error: 'IP temporarily blocked due to suspicious activity' });
        }
      }
    } else {
      this.suspiciousIPs.set(ip, { count: 1, firstSeen: now });
    }

    next();
  };

  // Clean up old entries periodically
  public cleanup() {
    const now = Date.now();
    for (const [ip, data] of this.suspiciousIPs.entries()) {
      if (now - data.firstSeen > this.WINDOW_SIZE) {
        this.suspiciousIPs.delete(ip);
      }
    }
  }
}

// Honeypot middleware to detect automated attacks
export const honeypot = (req: Request, res: Response, next: NextFunction) => {
  const suspiciousPaths = [
    '/wp-admin',
    '/phpMyAdmin',
    '/admin',
    '/.env',
    '/config',
    '/backup',
    '/sql',
    '/database'
  ];
  
  if (suspiciousPaths.some(path => req.path.includes(path))) {
    const ip = getClientIP(req);
    logger.warn(`Honeypot triggered by IP: ${ip}, path: ${req.path}`);
    
    // Return fake success to waste attacker's time
    res.status(200).json({ message: 'Success' });
    return;
  }
  
  next();
};

// Error handling middleware
export const errorHandler = (err: Error, req: Request, res: Response, next: NextFunction) => {
  logger.error('Unhandled error:', {
    error: err.message,
    stack: err.stack,
    ip: getClientIP(req),
    path: req.path,
    method: req.method
  });
  
  res.status(500).json({ error: 'Internal server error' });
};