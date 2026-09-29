# Fantasy Map Generator API

API [Hono](https://hono.dev) déployée comme Cloudflare Worker, qui génère des cartes fantasy
(PNG, SVG ou JSON) à partir d'un payload. Les algorithmes s'inspirent de
[Azgaar's Fantasy Map Generator](https://github.com/Azgaar/Fantasy-Map-Generator) : grille de Voronoi,
heightmap par templates, climat, biomes, rivières et expansion des pays.

**Principe clé : la géographie ne dépend que de la seed, des dimensions, du template et du nombre
de pays (et de leur `expansionism`).** Les noms, couleurs, capitales et villes ne changent jamais
le relief ni les frontières. Une application externe peut donc renommer un pays et rappeler
l'API : elle obtient exactement la même carte avec le nouveau nom.

## Démarrage

```bash
npm install
npm run dev        # wrangler dev sur http://localhost:8787
npm test           # vitest (générateur + routes)
npm run typecheck
npm run deploy -w api
```

> Le rendu PNG consomme environ 100 à 500 ms de CPU : il faut le plan **Workers Paid**, car le plan
> Free est limité à 10 ms de CPU par requête. Voir `limits.cpu_ms` dans `apps/api/wrangler.jsonc`.

## Endpoints

> Documentation complète, avec chaque paramètre en version GET et POST : [docs/API.md](docs/API.md).

| Méthode | Route | Description |
| --- | --- | --- |
| `POST` | `/v1/maps` | Génère une carte depuis un payload JSON |
| `GET` | `/v1/maps` | Idem via query (`?countries=A,B&seed=42`) ou `?payload=<JSON en base64url>`, pratique pour `<img src>` |
| `GET` | `/v1/options` | Templates, styles, valeurs par défaut, limites |
| `GET` | `/v1/schema` | JSON Schema du payload |
| `GET` | `/health` | Healthcheck |

### Payload

```jsonc
{
  "seed": "royaume-42",            // optionnel : aléatoire sinon (renvoyé dans X-Map-Seed)
  "format": "png",                 // png | svg | json
  "countries": [                   // l'ORDRE compte : l'index détermine le territoire
    "Dunmar",                      // forme courte
    {
      "id": "k1",                  // votre identifiant, renvoyé dans le JSON
      "name": "Empire d'Aldoria",
      "color": "#c9a0dc",          // optionnel
      "capital": "Valmont",        // sans nom : marqueur sans label
      "cities": ["Port-Sable", "Brumeval"],
      "expansionism": 1.5          // optionnel, modifie les frontières
    }
  ],
  "title": "Les Royaumes d'Elthar",
  "width": 1600, "height": 900,
  "cells": 8000,                   // niveau de détail (limité par MAX_CELLS)
  "template": "continents",        // continents | pangea | archipelago | island | peninsula | mediterranean
  "style": "political",            // political | physical | parchment
  "scale": 1,                      // ratio de pixels du PNG
  "latitude": { "north": 60, "south": 15 },
  "riverDensity": 1,
  "neutralLands": 0,               // 0 = toutes les terres appartiennent à un pays
  "layers": { "labels": true, "cities": true, "rivers": true, "relief": true, "borders": true, "frame": true },
  "includeGeometry": false         // JSON : contours des pays
}
```

### Sortie JSON

`format: "json"` renvoie tout ce qui est affiché sur la carte : pour chaque pays, son nom, sa
couleur, sa capitale et ses villes (coordonnées en pixels), la position et la taille de son label,
ses voisins, sa bounding box et sa part des terres. Elle contient aussi :

- `request` : le payload normalisé avec la seed, à stocker pour rejouer la carte à l'identique ;
- `imageUrl` : l'URL `GET` qui renvoie le PNG correspondant.

### En-têtes et cache

- `X-Map-Seed` : la seed utilisée, `X-Map-Warnings` : avertissements encodés en URL (par exemple
  un pays trop petit pour toutes ses villes).
- Quand la seed est fournie, la réponse est déterministe : `ETag` (le serveur répond `304`),
  `Cache-Control: public` et mise en cache via la Cache API du Worker. La clé inclut
  `GENERATOR_VERSION`, à incrémenter dès qu'une modification de l'algorithme change les cartes.

### Authentification

Optionnelle. Si le secret `API_KEY` est défini (`npx wrangler secret put API_KEY`), les routes
`/v1/*` exigent `Authorization: Bearer <API_KEY>`.

## Structure

```
apps/api/
  src/generator/   grille Voronoi, heightmap, climat/biomes, rivières, pays, labels
  src/render/      SVG (géométrie lissée partagée entre calques) et PNG (resvg-wasm)
  src/schema.ts    validation zod du payload
  src/app.ts       routes Hono
  assets/fonts/    Cinzel et Alegreya SC (OFL), embarquées pour le rendu PNG
  scripts/font-metrics.mjs  régénère les métriques de police utilisées pour ajuster les labels
```

Les polices couvrent l'alphabet latin, accents compris. Les autres écritures (cyrillique, CJK…)
nécessiteraient d'ajouter une police et de relancer `scripts/font-metrics.mjs`.
