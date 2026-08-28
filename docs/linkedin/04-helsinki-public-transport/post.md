---
order: 4
app: industry/helsinki-public-transport
slug: helsinki-public-transport
galleryPost: docs/gallery-posts/helsinki-public-transport.md
galleryUrl:            # paste the live gallery URL here in Phase 5a, then it replaces {{galleryUrl}} below
status: draft
language: en
assetsReady: false
assets:
  - docs/previews/helsinki-public-transport.webp
---

# 04: helsinki-public-transport

*Post 4 of 13 in the Fabric Apps series, one per weekday.*

## Post text

```text
Every tram in Helsinki, moving on a 3D map, on Fabric Real-Time Intelligence.

The idea is not mine: this is a rebuild of Kevin Thomas's original Helsinki real-time transit solution, using the same Real-Time Intelligence architecture and the same Fabric portal host bridge for querying the semantic model. What I added is a token-free 3D city twin and a fallback chain for running outside the portal.

Eventstream into an Eventhouse, a semantic model over KQL, and the app querying it with the signed-in user's own identity. No service principal, no shared secret.

The producer notebook holds no credentials at all: it resolves the connection at run time, on an hourly schedule with a runtime budget so runs cannot pile up.

None of the data is mine. Vehicle positions are HSL's, the 3D city is the City of Helsinki's, both CC BY 4.0, streamed live from the publisher, nothing copied into the repo:
Contains data from HSL, licensed under CC BY 4.0.
Imagery & 3D models (c) City of Helsinki (CC BY 4.0).

End-user SSO on a Kusto datasource is the detail worth stealing: every user queries as themselves, so row-level security means something.

App page: https://kornalexander.github.io/Fabric-Apps/apps/helsinki-public-transport/

Source, and always the latest version:
https://github.com/KornAlexander/Fabric-Apps/tree/main/industry/helsinki-public-transport

Gallery entry: https://community.fabric.microsoft.com/discussions/pbi_fabricappsgallery/helsinki-public-transport-a-live-map-on-real-time-intelligence/5363079

#MicrosoftFabric #PowerBI #FabricApps #RealTimeIntelligence #Eventhouse #KQL #OpenData
```

## Notes for the composer

- ⚠️ No demo clip exists for this app yet. Record one before posting.
- Paste as plain text; LinkedIn strips markdown. The blank lines are the formatting.
- Mentions are added by hand in the composer, not here.
- The app page link is mandatory and always the app's own subpage, never the front page: https://kornalexander.github.io/Fabric-Apps/apps/helsinki-public-transport/
- ⚠️ The attribution lines are PRESCRIBED BY THE LICENCE. Reproduce them verbatim - re-wording or re-wrapping them stops them being the attribution. Do not cut them for length; cut something else.
