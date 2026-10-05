FROM node:22-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY server.js users.js auth.js flag.js limits.js ./
COPY scripts/ ./scripts/
COPY public/ ./public/
ENV NODE_ENV=production
EXPOSE 3000
USER node
CMD ["npm", "start"]
