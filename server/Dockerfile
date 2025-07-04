FROM oven/bun:1-alpine

WORKDIR /app

# Copy package files
COPY package*.json bun.lockb ./

# Install dependencies
RUN bun install --frozen-lockfile && bun pm trust --all || true

# Copy source code
COPY src/ ./src/
COPY tsconfig.json ./

# Create non-root user
RUN addgroup -g 1001 -S nodejs
RUN adduser -S faucet -u 1001

# Create directories for logs and database
RUN mkdir -p /app/logs /app/data

# Set ownership
RUN chown -R faucet:nodejs /app
USER faucet

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/api/health || exit 1

# Start the server
CMD ["bun", "run", "start"]