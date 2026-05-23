# solid-apps/profile

Your profile, on your pod, in two projections:

- A **human-friendly page** — VK/Bluesky-shaped: cover, avatar, name, status, links, the apps you run.
- An **agent-friendly `SOUL.md`** — the markdown structure AI agents already read for identity, values, comms style, hard limits, endpoints.

One source of truth (`/profile/card.jsonld`, your WebID), one editor, two outputs.

## Install

```bash
jspod install profile
```

Open at `https://<your-pod>/public/apps/profile/`. The pod owner can edit; everyone else sees the public face.

## Layout

```
/profile/card.jsonld              ← source of truth (WebID, JSON-LD)
/profile/SOUL.md                  ← generated on save (for agents)
/profile/avatar.png               ← optional avatar upload
/settings/publicTypeIndex.jsonld  ← read for endpoint discovery (not edited here yet)
```

## Card schema

The pod's WebID is a single JSON-LD document. Identity uses standard `foaf:` and `schema:` predicates so existing Solid clients understand it. Agent-specific fields live under `soul:`:

```jsonld
{
  "@context": {
    "schema": "https://schema.org/",
    "foaf": "http://xmlns.com/foaf/0.1/",
    "soul": "urn:soul:"
  },
  "@id": "#me",
  "@type": ["schema:Person", "foaf:Person"],

  "foaf:name": "Ada Lovelace",
  "schema:alternateName": "@ada",
  "schema:description": "Mathematician, dreaming of analytical engines.",
  "foaf:img": "/profile/avatar.png",
  "schema:url": [
    "https://github.com/ada",
    "nostr:npub1..."
  ],

  "soul:values": ["accuracy over speed", "explicit over implicit"],
  "soul:commsStyle": { "tone": "terse", "filler": "no" },
  "soul:hardLimits": ["no push without review"],
  "soul:memoryPolicy": "remember preferences; forget session details"
}
```

Old Solid clients that don't know `soul:*` ignore the unknown properties. Agents that hit `/profile/SOUL.md` get a rendered markdown view of the same data.

## Why card.jsonld and typeIndex (not data.jsonld)

Solid already has a WebID and a typeIndex — we use those rather than inventing a parallel `data.jsonld`:

| Concern | Lives in |
|---|---|
| Name, avatar, status, links | `/profile/card.jsonld` (WebID) |
| `soul:*` agent metadata | `/profile/card.jsonld` (same doc) |
| "Where do my plume / plaza / chat live" | `/settings/publicTypeIndex.jsonld` |
| Rendered agent doc | `/profile/SOUL.md` (generated) |

## Agent endpoint convention

This app proposes a small convention: **every Solid pod publishes a `SOUL.md` at `/profile/SOUL.md`**. Agents land there first for identity + how-to-talk-to-this-pod context. Think `robots.txt` for the AI age.

If you don't want one, don't install this app. If you do, the file is regenerated from your WebID every save — no separate file to maintain.

## License

AGPL-3.0
