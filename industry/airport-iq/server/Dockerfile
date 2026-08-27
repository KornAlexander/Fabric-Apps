# Airport IQ chat/voice backend (Foundry-powered, grounded in the ops snapshot).
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund

FROM node:20-alpine AS runtime
ENV NODE_ENV=production
ENV PORT=8080
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json server.mjs config.mjs ./
COPY lib ./lib
COPY routes ./routes
COPY data ./data
EXPOSE 8080
# Managed identity (Container Apps) supplies the Azure OpenAI token at runtime.
CMD ["node", "server.mjs"]
