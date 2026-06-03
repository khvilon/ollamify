FROM node:18-alpine

WORKDIR /app

RUN apk add --no-cache curl

COPY package*.json ./
RUN npm install

COPY src ./src

EXPOSE 3002
CMD ["node", "src/index.js"]
