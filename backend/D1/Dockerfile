FROM node:22-alpine
WORKDIR /app
RUN chown node:node /app
USER node
COPY --chown=node:node package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY --chown=node:node . .
EXPOSE 3004
CMD ["sh", "-c", "npm run migrate && exec node src/index.js"]
