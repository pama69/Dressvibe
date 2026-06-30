# Stage 1: build Expo web static export
FROM node:20-slim AS builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --legacy-peer-deps

COPY . .

# EXPO_PUBLIC_* vars are inlined at build time by Metro
ARG EXPO_PUBLIC_BACKEND_URL=https://api.dressvibe.app
ENV EXPO_PUBLIC_BACKEND_URL=$EXPO_PUBLIC_BACKEND_URL

RUN npx expo export -p web

# Stage 2: serve with nginx
FROM nginx:alpine

COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
