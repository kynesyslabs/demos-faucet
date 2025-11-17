FROM oven/bun:1-alpine

WORKDIR /app

# Create non-root user
RUN addgroup -g 1001 -S nodejs
RUN adduser -S faucet -u 1001

# Create directories for logs and database with proper ownership
RUN mkdir -p /app/logs /app/data && chown -R faucet:nodejs /app

# Switch to non-root user BEFORE installing dependencies
USER faucet

# Copy package files
COPY --chown=faucet:nodejs package.json ./
COPY --chown=faucet:nodejs bun.lockb* ./

# Install dependencies as non-root user (ownership is correct from start)
RUN bun install && bun pm trust --all || true

# Copy source code with proper ownership
COPY --chown=faucet:nodejs src/ ./src/
COPY --chown=faucet:nodejs tsconfig.json ./

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/api/health || exit 1

# Start the server
CMD ["bun", "run", "start"]