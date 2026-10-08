# Copal mock backend — API, console, fake GitHub/GitLab and PR webhooks on one port.
FROM node:22-alpine AS build
WORKDIR /app
COPY . .
RUN npm install --no-audit --no-fund && npm run build

FROM node:22-alpine
WORKDIR /app
COPY --from=build /app /app
ENV NODE_ENV=production PORT=4010
EXPOSE 4010
# Set COPAL_MOCK_DEV_KEY when the container is reachable from the internet.
CMD ["node", "apps/mock-server/dist/src/index.js", "--persist", "/tmp/copal/state.json"]
