FROM node:18-alpine

WORKDIR /app

COPY services/zeus/package*.json ./

RUN npm install --verbose && \
    npm list @qdrant/js-client-rest || (echo "Failed to install Qdrant client" && exit 1)

COPY services/zeus/src ./src

CMD ["npm", "start"]
