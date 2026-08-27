---
order: 2
app: industry/helsinki-public-transport
slug: helsinki-public-transport
galleryPost: docs/gallery-posts/helsinki-public-transport.md
galleryUrl:            # paste the live gallery URL here in Phase 5a, then it replaces {{galleryUrl}} below
status: draft
language: en
assetsReady: true
assets:
  - docs/previews/helsinki-public-transport.webp
---

# 02 — helsinki-public-transport

*Post 2 of 15 in the Fabric Apps series. One per weekday.*

## Post text

```text
Every tram in Helsinki, moving on a 3D map, on Fabric Real-Time Intelligence.

The idea is not mine: this is a rebuild of Kevin Thomas's original Helsinki real-time transit solution, using the same Real-Time Intelligence architecture and the same Fabric portal host bridge for querying the semantic model. What I added is a token-free 3D city twin and a fallback chain so it also runs outside the portal.

Eventstream into an Eventhouse, a semantic model over KQL, and the app querying it with the signed-in user's own identity. No service principal, no shared secret.

The producer notebook holds no credentials at all — it resolves the connection at run time, on an hourly schedule with a runtime budget so overlapping runs cannot pile up.

None of the data is mine. Vehicle positions are HSL's and the 3D city is the City of Helsinki's, both CC BY 4.0, both streamed live from the publisher — nothing copied into the repo:
Contains data from HSL, licensed under CC BY 4.0.
Imagery & 3D models (c) City of Helsinki (CC BY 4.0).

End-user SSO on a Kusto datasource is the detail worth stealing. Every user queries as themselves, so row-level security actually means something.

Source, and always the latest version:
https://github.com/KornAlexander/Fabric-Apps/tree/main/industry/helsinki-public-transport

Gallery entry: {{galleryUrl}}

#MicrosoftFabric #PowerBI #FabricApps #RealTimeIntelligence #Eventhouse #KQL #OpenData
```

## Notes for the composer

- Attach: `docs/media/helsinki-public-transport-demo.gif` (or the MP4 if LinkedIn handles it better on the day).
- Paste as plain text; LinkedIn strips markdown. The blank lines are the formatting.
- Mentions are added by hand in the composer, not here.
- ⚠️ The attribution lines are PRESCRIBED BY THE LICENCE. Reproduce them verbatim - re-wording or re-wrapping them stops them being the attribution. Do not cut them for length; cut something else.
