# Alternativa ao Cloudflare: servidor próprio (VPS ou computador da portaria) com Node.js + SQLite.
FROM node:22-bookworm-slim
ENV NODE_ENV=production TZ=America/Sao_Paulo DATA_DIR=/app/data PORT=3000
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY src ./src
COPY migrations ./migrations
COPY public ./public
COPY scripts ./scripts
VOLUME ["/app/data"]
EXPOSE 3000
CMD ["node", "src/node.js"]
