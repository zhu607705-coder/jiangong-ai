#!/bin/sh
set -eu
case "${RENEWED_LINEAGE:-}" in
    /etc/letsencrypt/live/laneanew.cn)
        /usr/sbin/nginx -t
        /usr/bin/systemctl reload nginx.service
        ;;
esac
