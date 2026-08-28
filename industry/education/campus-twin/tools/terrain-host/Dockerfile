# Terrain-Host — nginx, das nur die gebauten Geodaten ausliefert.
#
# ⚠ WARUM UEBERHAUPT EIN CONTAINER UND KEIN BLOB-STORAGE. Ein Static-Website-Endpunkt waere der
# naheliegende Ort. In dieser Subscription ist er unmoeglich: eine Management-Group-Policy mit
# Modify-Effekt erzwingt `publicNetworkAccess: Disabled` und `allowSharedKeyAccess: false` schon
# beim Anlegen, auch wenn man beide Flags ausdruecklich mitgibt, und das nachtraegliche Update ist
# ein stiller No-Op mit Exit 0. Nachgewiesen am 26.08.2026 an einem Wegwerfkonto. Container Apps
# sind von der Policy nicht betroffen.
#
# ⚠ DAS BILD IST GROSS UND DAS IST DER ZWECK. Rund 240 MB Kacheln liegen darin, damit sie NICHT
# im Fabric-Paket liegen, das bei 100 MB komprimiert gedeckelt ist.
FROM nginx:1.27-alpine

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY payload/ /usr/share/nginx/html/terrain/

# Container Apps schickt den Verkehr an den Ingress-Port; 8080 statt 80, damit kein Root noetig ist.
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/healthz || exit 1
