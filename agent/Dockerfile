FROM node:22-alpine

WORKDIR /app

# Run as non-root user
USER node

# Copy dependency manifests
COPY --chown=node:node package*.json ./

RUN npm ci --omit=dev

# Copy application source
COPY --chown=node:node . .

# Outbound HTTPS only — no inbound ports needed
ENV NODE_ENV=production

CMD ["node", "src/index.js"]
