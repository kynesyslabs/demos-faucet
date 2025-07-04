FROM oven/bun:1-alpine

WORKDIR /app

COPY package*.json bun.lockb ./
RUN bun install --frozen-lockfile && bun pm trust --all || true

COPY . .

EXPOSE 3000

CMD ["bun", "run", "start"]