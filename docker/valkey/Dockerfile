FROM valkey/valkey:8.1-alpine

COPY docker/valkey/valkey.conf /usr/local/etc/valkey/valkey.conf

EXPOSE 6379

CMD ["valkey-server", "/usr/local/etc/valkey/valkey.conf"]
