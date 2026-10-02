# ⚠️ BUILT IN THE CLOUD, NOT HERE. `az acr build` runs this on an ACR Task agent, which is
# linux/amd64 natively. That matters: this laptop is ARM64, and a previous attempt in this family
# of apps to produce an AMD64 image locally under emulation never reached a healthy container.
# Cloud-side build removes the whole problem rather than working around it.
#
# ⚠️ THE TAG IS PINNED AND WAS VERIFIED TO EXIST. An earlier draft used
# `azurelinux/base/nodejs:22`, which looks entirely plausible and is a 404 — MCR publishes 20 and
# 24 for this image, not 22. Checked against the registry's own tag list and manifest endpoint on
# 2026-09-21 rather than assumed, after a review flagged it. Pinning the full version keeps a
# rebuild reproducible instead of silently moving with the floating `24` tag.
#
# Zero dependencies on purpose: no package.json, no npm install, nothing to audit and no lockfile
# to drift. Node's built-in http and fetch are all this needs.

FROM mcr.microsoft.com/azurelinux/base/nodejs:24.21.0-1-azl3.0.20260909

WORKDIR /app
COPY server.mjs ./server.mjs

ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

# Non-root.
USER 1000

CMD ["node", "server.mjs"]
