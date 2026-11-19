FROM node:22-bookworm-slim
ENV NODE_ENV=production TZ=America/Sao_Paulo DATA_DIR=/app/data PORT=3000
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY server ./server
COPY public ./public
COPY scripts ./scripts
VOLUME ["/app/data"]
EXPOSE 3000
CMD ["node", "server/index.js"]
