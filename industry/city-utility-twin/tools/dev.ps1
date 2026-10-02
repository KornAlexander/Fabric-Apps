# Start the dev server from the project root.
#
# ⚠️ A WRAPPER RATHER THAN A ONE-LINER. Vite takes its root from the working directory, and a
# `cd` that does not survive into the child process produces a server that starts, prints a URL
# and then answers every request with an error because it is serving a directory with no
# index.html in it. Pinning the location here makes that impossible.

param([int]$Port = 5190)

$ErrorActionPreference = 'Stop'
Set-Location (Split-Path -Parent $PSScriptRoot)
npm run dev -- --port $Port
