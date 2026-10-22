# Local development: Node.js and dependencies live inside the image.
FROM node:22-alpine
WORKDIR /app
RUN chown node:node /app
USER node

# Reuse the dependency layer until the lockfile changes.
COPY --chown=node:node package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY --chown=node:node . .

EXPOSE 5173
CMD ["npm", "run", "dev", "--", "--strictPort"]
