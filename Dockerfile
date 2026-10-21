FROM node:22-bookworm-slim

WORKDIR /app

# Instalar utilidades mínimas del sistema (curl y tzdata para zona horaria America/Santiago)
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    ca-certificates \
    tzdata \
    && rm -rf /var/lib/apt/lists/*

ENV TZ=America/Santiago

# Copiar manifiestos de paquetes
COPY package.json package-lock.json ./

# Instalar dependencias
RUN npm ci

# Copiar el código de la aplicación
COPY . .

# Asegurar permisos de ejecución en scripts
RUN chmod +x docker-entrypoint.sh

# Exponer el puerto de Vite / Cloudflare Worker
EXPOSE 5174

ENV PORT=5174
ENV HOST=0.0.0.0

ENTRYPOINT ["./docker-entrypoint.sh"]
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0", "--port", "5174"]
