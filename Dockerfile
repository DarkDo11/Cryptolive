FROM nginxinc/nginx-unprivileged:1.27-alpine

WORKDIR /usr/share/nginx/html

COPY --chown=101:101 index.html style.css app.js ./

EXPOSE 8080/tcp

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/ >/dev/null || exit 1

CMD ["nginx", "-g", "daemon off;"]
