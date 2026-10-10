# Multi-stage production container for ChaosMesh Sentinel Observability
FROM node:20-alpine AS runner

WORKDIR /app

COPY package.json ./
COPY src/ ./src/
COPY tests/ ./tests/
COPY index.html ./

EXPOSE 8080

CMD ["node", "tests/chaosmesh.test.js"]
