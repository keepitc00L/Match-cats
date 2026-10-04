FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build

FROM node:20-alpine AS server
WORKDIR /app
COPY server/package*.json ./
RUN npm install
COPY server/ ./
COPY --from=build /app/dist ./dist

EXPOSE 3001
CMD ["npm", "start"]
