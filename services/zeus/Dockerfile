FROM node:18-alpine

WORKDIR /app

COPY services/zeus/package*.json ./

RUN npm install

COPY services/zeus/src ./src

CMD ["npm", "start"]
