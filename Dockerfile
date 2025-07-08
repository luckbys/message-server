# ------------------------------
# Stage 1: Build
# ------------------------------
FROM node:20-alpine AS builder

WORKDIR /app

# Copia apenas o package.json e package-lock para instalar dependências primeiro (cache eficiente)
COPY package*.json ./

RUN npm ci --legacy-peer-deps

# Copia o restante do código
COPY . .

# Compila o projeto (gera pasta dist/)
RUN npm run build

# ------------------------------
# Stage 2: Production image
# ------------------------------
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production

# Copia dependências apenas de produção
COPY package*.json ./
RUN npm ci --omit=dev --legacy-peer-deps

# Copia arquivos compilados da etapa builder
COPY --from=builder /app/dist ./dist

# Porta exposta pelo NestJS
EXPOSE 3000

CMD ["node", "dist/main.js"] 