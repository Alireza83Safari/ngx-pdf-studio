# PDF Studio render service (designer-ux 5.3).
#
# Build from the REPO ROOT, after `npm run build:core`:
#   npm run build:core
#   docker build -f apps/render-service/Dockerfile -t pdfstudio/render .
#   docker run -p 3000:3000 pdfstudio/render
#
# The image installs the packed core exactly as npm would publish it, rather
# than copying the workspace: what runs in the container is then the same
# artifact consumers install, so a packaging mistake fails here too instead of
# only after a release.

FROM node:20-alpine AS build
WORKDIR /pack
# `npm pack` on the built dist produces the publishable tarball. Copying only
# dist keeps the build context small and the layer independent of the sources.
COPY packages/pdf-studio/core/dist ./dist
RUN npm pack ./dist --pack-destination /pack && mv /pack/*.tgz /pack/core.tgz

FROM node:20-alpine
ENV NODE_ENV=production
WORKDIR /app

COPY --from=build /pack/core.tgz /tmp/core.tgz
# `--omit=dev --ignore-scripts` keeps the runtime tree to what the engine
# actually needs and stops package lifecycle scripts running in the image.
RUN npm init -y >/dev/null \
  && npm install --omit=dev --ignore-scripts /tmp/core.tgz \
  && rm /tmp/core.tgz \
  && npm cache clean --force

COPY apps/render-service/server.js apps/render-service/service.js ./

# Run unprivileged: the service reads no filesystem input and needs no writes.
USER node
EXPOSE 3000

# Node can probe itself, so the image needs no curl or wget for this.
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('node:http').get('http://127.0.0.1:'+(process.env.PORT||3000)+'/healthz',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

# No init shim and no `npm start`: node is PID 1 and receives SIGTERM directly,
# which is what the graceful shutdown in server.js is waiting for.
CMD ["node", "server.js"]
