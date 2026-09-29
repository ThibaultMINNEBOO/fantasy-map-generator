# Documentation de l'API — Fantasy Map Generator

Cette API génère des cartes fantasy au format PNG, SVG ou JSON. Chaque paramètre peut être envoyé
de deux façons :

- **`POST /v1/maps`** avec un corps JSON. C'est la forme complète, qui accepte tous les paramètres.
- **`GET /v1/maps`** avec des paramètres de query. C'est pratique pour une balise `<img src>`, un lien
  ou un test rapide dans le navigateur. Une variante `?payload=` accepte le même JSON que le POST,
  encodé en base64url.

Dans les exemples, `$API` désigne l'URL de base (`http://localhost:8787` avec `npm run dev`).

```bash
export API=http://localhost:8787
```

---

## Sommaire

1. [Démarrage rapide](#1-démarrage-rapide)
2. [Règles générales GET et POST](#2-règles-générales-get-et-post)
3. [Référence des paramètres](#3-référence-des-paramètres)
4. [Réponses](#4-réponses)
5. [Erreurs](#5-erreurs)
6. [Cache et déterminisme](#6-cache-et-déterminisme)
7. [Authentification](#7-authentification)
8. [Autres endpoints](#8-autres-endpoints)
9. [Recettes complètes](#9-recettes-complètes)

---

## 1. Démarrage rapide

La requête minimale ne contient que la liste des pays. Tous les autres paramètres ont une valeur
par défaut.

**GET**

```bash
curl -o carte.png "$API/v1/maps?countries=Dunmar,Aldoria,Kesh&seed=42"
```

**POST**

```bash
curl -o carte.png -X POST "$API/v1/maps" \
  -H 'Content-Type: application/json' \
  -d '{"countries": ["Dunmar", "Aldoria", "Kesh"], "seed": 42}'
```

Ces deux requêtes renvoient exactement la même image.

---

## 2. Règles générales GET et POST

### POST `/v1/maps`

- En-tête `Content-Type: application/json` obligatoire.
- Le corps est un objet JSON dont les champs sont décrits en [section 3](#3-référence-des-paramètres).
- Les nombres s'envoient comme des nombres JSON (`"width": 1200`), les booléens comme des booléens
  (`true` / `false`).

### GET `/v1/maps` : deux modes

**Mode 1 : paramètres « à plat »**

Chaque paramètre devient un paramètre de query :

| Type de champ | Syntaxe GET | Exemple |
| --- | --- | --- |
| Texte ou énumération | `clé=valeur` | `template=island` |
| Nombre | `clé=nombre` | `width=1200` |
| Booléen | `clé=true` ou `clé=false` (`0` vaut aussi faux) | `includeGeometry=true` |
| Objet imbriqué | notation pointée `objet.clé=valeur` | `layers.rivers=false`, `latitude.north=70` |
| Liste de pays | noms séparés par des virgules, ou `country` répété | `countries=A,B,C` ou `country=A&country=B` |

Limites du mode à plat :

- Les pays ne peuvent être que des **noms**. Pour fournir `id`, `color`, `capital`, `cities` ou
  `expansionism`, utilisez le POST ou le mode `payload`.
- Un nom de pays ne peut pas contenir de virgule, car la virgule sert de séparateur.
- Les valeurs doivent être encodées pour l'URL : espaces, accents, apostrophes, `#`…
  (`Empire d'Aldoria` devient `Empire%20d'Aldoria`, `Élan` devient `%C3%89lan`).
- Pour un booléen, toute valeur autre que `false` ou `0` vaut `true` (`layers.frame=non` vaut donc `true`).
- Un nombre mal écrit (`width=abc`) donne une erreur 400.

**Mode 2 : `?payload=<JSON en base64url>`**

Le paramètre `payload` contient exactement le même objet que le corps du POST, sérialisé en JSON,
encodé en UTF-8 puis en **base64url** (alphabet `-` et `_` au lieu de `+` et `/`, sans `=` final).
Quand `payload` est présent, **tous les autres paramètres de query sont ignorés**.

C'est le seul moyen d'obtenir une carte complète (capitales, villes, couleurs…) via une URL,
et c'est le format de l'`imageUrl` renvoyée par la sortie JSON.

Encoder un payload :

```bash
# Shell (macOS ; sous Linux, remplacez `base64` par `base64 -w0`)
PAYLOAD=$(printf '%s' '{"countries":["Dunmar","Aldoria"],"seed":42}' | base64 | tr '+/' '-_' | tr -d '=\n')
curl -o carte.png "$API/v1/maps?payload=$PAYLOAD"
```

```js
// JavaScript (navigateur ou Node 18+), gère les accents
function toPayload(obj) {
  const bytes = new TextEncoder().encode(JSON.stringify(obj))
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
const url = `${API}/v1/maps?payload=${toPayload({ countries: ['Élan', 'Brume'], seed: 42 })}`
```

```python
# Python
import base64, json
payload = base64.urlsafe_b64encode(json.dumps(obj).encode()).decode().rstrip("=")
```

### Clés inconnues

Les clés non reconnues sont **ignorées sans erreur**, en GET comme en POST. Une faute de frappe
(`widht=1200`) ne produit donc aucune erreur : le paramètre garde simplement sa valeur par défaut.
En cas de doute, demandez `format: "json"` et vérifiez l'objet `request` renvoyé, qui contient
les paramètres réellement utilisés.

---

## 3. Référence des paramètres

Récapitulatif :

| Paramètre | Type | Défaut | Bornes | Modifie la géographie ? |
| --- | --- | --- | --- | --- |
| [`countries`](#countries) | liste | *obligatoire* | 1 à 64 pays | Oui : le **nombre** de pays et leur `expansionism` |
| [`seed`](#seed) | texte ou entier | aléatoire | 1 à 64 caractères, ou entier ≥ 0 | Oui |
| [`format`](#format) | `png` \| `svg` \| `json` | `png` | | Non |
| [`width`](#width--height) | entier | `1600` | 320 à 4096 | Oui |
| [`height`](#width--height) | entier | `900` | 240 à 4096 | Oui |
| [`cells`](#cells) | entier | `8000` | 1000 à `MAX_CELLS` (20000 par défaut) | Oui |
| [`template`](#template) | énumération | `continents` | voir liste | Oui |
| [`style`](#style) | `political` \| `physical` \| `parchment` | `political` | | Non |
| [`title`](#title) | texte | aucun | 1 à 80 caractères | Non |
| [`scale`](#scale) | nombre | `1` | 0,25 à 4 | Non |
| [`latitude.north`](#latitude) | nombre | `60` | -90 à 90 | Climat, donc capitales et frontières |
| [`latitude.south`](#latitude) | nombre | `15` | -90 à 90 | Climat, donc capitales et frontières |
| [`riverDensity`](#riverdensity) | nombre | `1` | 0 à 4 | Rivières, donc capitales et frontières |
| [`neutralLands`](#neutrallands) | nombre | `0` | 0 à 10 | Frontières |
| [`layers.*`](#layers) | booléens | tous `true` | | Non |
| [`includeGeometry`](#includegeometry) | booléen | `false` | | Non |

> **Règle d'or.** Les noms, couleurs, identifiants, noms de capitales et de villes, le style, le
> titre, les calques, le format et l'échelle **ne modifient jamais** le relief ni les frontières.
> Vous pouvez renommer un pays ou changer sa couleur et rappeler l'API avec la même seed : la carte
> sera identique, seul le texte changera.

---

### `countries`

**Obligatoire.** Liste de 1 à 64 pays. Chaque élément est soit une chaîne (le nom), soit un objet.

**L'ordre compte** : la position d'un pays dans la liste détermine son territoire. Si vous
intervertissez deux pays, ils échangent leurs territoires. Si vous ajoutez ou retirez un pays, toute
la carte politique change (le relief reste le même). Pour garder des cartes stables, conservez
toujours le même ordre.

**GET**

```
?countries=Dunmar,Aldoria,Kesh
?country=Dunmar&country=Aldoria&country=Kesh
?countries=Dunmar,Aldoria&country=Kesh          (les deux formes se cumulent, dans cet ordre)
```

**POST**

```json
{ "countries": ["Dunmar", "Aldoria", "Kesh"] }
```

#### Forme objet (POST ou `payload` uniquement)

| Champ | Type | Obligatoire | Description |
| --- | --- | --- | --- |
| `name` | texte (1 à 80) | oui | Nom affiché sur la carte. N'influence jamais la géométrie. |
| `id` | texte (1 à 64) | non | Votre identifiant, renvoyé tel quel dans la sortie JSON. Doit être unique dans la liste. Par défaut, c'est l'index du pays sous forme de texte (`"0"`, `"1"`…). |
| `color` | couleur hex `#rgb` ou `#rrggbb` | non | Couleur de remplissage. Par défaut, une couleur de la palette distincte de celles des voisins. |
| `capital` | texte (1 à 80) | non | Nom de la capitale. Sans ce champ, la capitale est placée et marquée, mais sans étiquette. |
| `cities` | liste de textes (20 max) | non | Noms des villes secondaires, placées automatiquement dans le pays. Leur nombre ne change pas les frontières. Si le pays est trop petit, une partie des villes est omise et un avertissement est renvoyé. |
| `expansionism` | nombre (0,2 à 5) | non | Force d'expansion relative (`1` = normal). `2` donne un pays nettement plus étendu, `0.5` un pays plus petit. **Modifie les frontières.** |

Les deux formes peuvent être mélangées :

**POST**

```json
{
  "seed": "elthar",
  "countries": [
    "Dunmar",
    {
      "id": "aldoria",
      "name": "Empire d'Aldoria",
      "color": "#c9a0dc",
      "capital": "Valmont",
      "cities": ["Port-Sable", "Brumeval"],
      "expansionism": 1.5
    },
    { "name": "Kesh", "capital": "Kesh-la-Blanche" }
  ]
}
```

**GET** (payload encodé ; les champs objet ne sont pas disponibles en mode à plat)

```bash
PAYLOAD=$(printf '%s' '{"seed":"elthar","countries":["Dunmar",{"id":"aldoria","name":"Empire d'"'"'Aldoria","color":"#c9a0dc","capital":"Valmont","cities":["Port-Sable","Brumeval"],"expansionism":1.5},{"name":"Kesh","capital":"Kesh-la-Blanche"}]}' \
  | base64 | tr '+/' '-_' | tr -d '=\n')
curl -o carte.png "$API/v1/maps?payload=$PAYLOAD"
```

---

### `seed`

Graine de génération : texte de 1 à 64 caractères, ou entier positif ou nul. Les entiers sont
convertis en texte (`42` et `"42"` donnent la même carte).

- Même seed et mêmes paramètres géographiques : **même carte**, à l'octet près.
- Sans seed, une seed aléatoire à 9 chiffres est tirée. Elle est renvoyée dans l'en-tête
  `X-Map-Seed` (et dans le champ `seed` de la sortie JSON) : conservez-la pour rejouer la carte.
- La présence d'une seed active le cache HTTP (voir [section 6](#6-cache-et-déterminisme)).

**GET**

```
?countries=A,B&seed=royaume-42
```

**POST**

```json
{ "countries": ["A", "B"], "seed": "royaume-42" }
```

---

### `format`

Format de la réponse.

| Valeur | Content-Type | Contenu |
| --- | --- | --- |
| `png` (défaut) | `image/png` | Image matricielle, polices embarquées |
| `svg` | `image/svg+xml; charset=utf-8` | Image vectorielle ; les polices (Cinzel, Alegreya SC) sont chargées depuis Google Fonts |
| `json` | `application/json; charset=utf-8` | Données de la carte : pays, capitales, villes, labels… (voir [section 4](#4-réponses)) |

**GET**

```
?countries=A,B&seed=1&format=svg
```

**POST**

```json
{ "countries": ["A", "B"], "seed": 1, "format": "svg" }
```

---

### `width` / `height`

Dimensions de la carte en pixels (en unités SVG pour le format `svg`).

- `width` : entier de 320 à 4096, défaut `1600`.
- `height` : entier de 240 à 4096, défaut `900`.

Changer les dimensions produit une géographie différente, même avec la même seed.

**GET**

```
?countries=A,B&seed=1&width=1200&height=1200
```

**POST**

```json
{ "countries": ["A", "B"], "seed": 1, "width": 1200, "height": 1200 }
```

---

### `cells`

Nombre de cellules de Voronoi, c'est-à-dire le niveau de détail. Entier de 1000 jusqu'à `MAX_CELLS`
(variable du Worker, `20000` par défaut), défaut `8000`.

- Plus de cellules : côtes et frontières plus fines, génération plus lente.
- Moins de cellules : carte plus grossière mais plus rapide.
- Changer `cells` produit une géographie différente.

**GET**

```
?countries=A,B&seed=1&cells=15000
```

**POST**

```json
{ "countries": ["A", "B"], "seed": 1, "cells": 15000 }
```

---

### `template`

Modèle de relief utilisé pour la heightmap. Défaut : `continents`.

| Valeur | Résultat |
| --- | --- |
| `continents` | Plusieurs masses continentales séparées par des océans |
| `pangea` | Un supercontinent unique |
| `archipelago` | De nombreuses îles de tailles variées |
| `island` | Une grande île centrale |
| `peninsula` | Une péninsule rattachée au bord haut de la carte |
| `mediterranean` | Des terres au nord et au sud d'une mer centrale |

La liste à jour est renvoyée par `GET /v1/options` (champ `templates`).

**GET**

```
?countries=A,B&seed=1&template=archipelago
```

**POST**

```json
{ "countries": ["A", "B"], "seed": 1, "template": "archipelago" }
```

---

### `style`

Thème graphique. N'a d'effet que pour `png` et `svg`. Défaut : `political`.

| Valeur | Rendu |
| --- | --- |
| `political` | Pays en aplats de couleur, océan bleu, frontières pleines |
| `physical` | Biomes (forêts, déserts, toundra…) sans couleur de pays, frontières en pointillés |
| `parchment` | Tons sépia façon vieux parchemin, pays légèrement teintés |

**GET**

```
?countries=A,B&seed=1&style=parchment
```

**POST**

```json
{ "countries": ["A", "B"], "seed": 1, "style": "parchment" }
```

---

### `title`

Titre affiché sur la carte (1 à 80 caractères). Aucun titre par défaut. Pensez à l'encoder en GET.

**GET**

```
?countries=A,B&seed=1&title=Les%20Royaumes%20d'Elthar
```

**POST**

```json
{ "countries": ["A", "B"], "seed": 1, "title": "Les Royaumes d'Elthar" }
```

---

### `scale`

Ratio de pixels du PNG, de 0,25 à 4, défaut `1`. Avec `scale: 2`, une carte de 1600×900 produit une
image de 3200×1800 (qualité « retina ») sans changer la mise en page. Sans effet sur `svg` et `json`.

Limite : `width × height × scale²` doit rester sous **16 mégapixels** en PNG (erreur 400 sinon).
Par exemple, 1600×900 accepte `scale` jusqu'à 3,33 environ.

**GET**

```
?countries=A,B&seed=1&scale=2
```

**POST**

```json
{ "countries": ["A", "B"], "seed": 1, "scale": 2 }
```

---

### `latitude`

Latitudes du bord haut (`north`) et du bord bas (`south`) de la carte, en degrés de -90 à 90.
Défauts : `north: 60`, `south: 15`. Elles pilotent les températures, donc les biomes (glaces,
toundra, déserts, jungles…). Comme les capitales s'installent de préférence sur les terres
favorables, ce paramètre peut aussi modifier la carte politique.

Chaque sous-champ est facultatif : on peut n'en fournir qu'un seul.

Exemples :

- `north: 80, south: 50` : monde froid et nordique ;
- `north: 20, south: -20` : monde tropical traversé par l'équateur.

**GET**

```
?countries=A,B&seed=1&latitude.north=80&latitude.south=50
```

**POST**

```json
{ "countries": ["A", "B"], "seed": 1, "latitude": { "north": 80, "south": 50 } }
```

---

### `riverDensity`

Densité des rivières, de 0 à 4, défaut `1`. `0` en supprime presque toutes, `2` les double
environ, `4` produit un réseau très dense. Pour masquer les rivières sans changer la carte, utilisez
plutôt `layers.rivers: false`, car `riverDensity` influence aussi l'emplacement des capitales et
donc les frontières.

**GET**

```
?countries=A,B&seed=1&riverDensity=2.5
```

**POST**

```json
{ "countries": ["A", "B"], "seed": 1, "riverDensity": 2.5 }
```

---

### `neutralLands`

Contrôle les terres qui n'appartiennent à aucun pays. Nombre de 0 à 10, défaut `0`.

- `0` : toutes les terres émergées sont attribuées à un pays.
- Toute valeur `> 0` limite la distance d'expansion des pays. **Plus la valeur est faible, plus
  il reste de terres neutres** : `0.5` laisse de grands territoires inoccupés, `8` n'en laisse
  presque pas.

**GET**

```
?countries=A,B&seed=1&neutralLands=1
```

**POST**

```json
{ "countries": ["A", "B"], "seed": 1, "neutralLands": 1 }
```

---

### `layers`

Calques à afficher (`png` et `svg` uniquement). Tous sont à `true` par défaut ; il suffit de
fournir ceux que l'on veut désactiver.

| Calque | Contenu |
| --- | --- |
| `labels` | Noms des pays |
| `cities` | Capitales et villes (marqueurs et noms) |
| `rivers` | Rivières |
| `relief` | Symboles de montagnes |
| `borders` | Tracés des frontières |
| `frame` | Cadre décoratif autour de la carte |

Les calques ne changent pas la géographie : une carte sans rivières affichées reste identique à la
carte complète.

**GET**

```
?countries=A,B&seed=1&layers.rivers=false&layers.frame=false
```

**POST**

```json
{ "countries": ["A", "B"], "seed": 1, "layers": { "rivers": false, "frame": false } }
```

---

### `includeGeometry`

Pour `format: "json"` uniquement. Ajoute à chaque pays un champ `outline` qui contient ses contours
(polygones en coordonnées pixels). Défaut : `false`, car la réponse est nettement plus lourde avec
les contours.

**GET**

```
?countries=A,B&seed=1&format=json&includeGeometry=true
```

**POST**

```json
{ "countries": ["A", "B"], "seed": 1, "format": "json", "includeGeometry": true }
```

---

## 4. Réponses

### En-têtes communs (200)

| En-tête | Description |
| --- | --- |
| `Content-Type` | Selon `format` (voir [`format`](#format)) |
| `X-Map-Seed` | Seed utilisée, fournie ou tirée au hasard |
| `X-Generator-Version` | Version de l'algorithme (voir [section 6](#6-cache-et-déterminisme)) |
| `X-Map-Warnings` | Présent seulement en cas d'avertissement : tableau JSON encodé pour l'URL (`decodeURIComponent` puis `JSON.parse`) |
| `ETag` | Empreinte de la requête normalisée |
| `Cache-Control` | `public, max-age=86400` si une seed est fournie, `no-store` sinon |

Ces en-têtes sont exposés via CORS : un script d'une autre origine peut les lire.

### PNG et SVG

Le corps est l'image elle-même.

### JSON

```jsonc
{
  "seed": "elthar",
  "generatorVersion": 1,
  "width": 1600,
  "height": 900,
  "template": "continents",
  "style": "political",

  // Payload normalisé : toutes les valeurs par défaut sont remplies et la seed est incluse.
  // Stockez-le tel quel pour rejouer exactement la même carte.
  "request": { "countries": [{ "name": "Dunmar" }, /* … */], "seed": "elthar", "format": "json", /* … */ },

  // URL GET renvoyant le PNG de cette même carte (format forcé à png, includeGeometry à false).
  "imageUrl": "http://localhost:8787/v1/maps?payload=eyJjb3VudHJpZXMiOlt7Im5hbWUiOi…",

  "warnings": [],

  "countries": [
    {
      "index": 1,                         // position dans la liste envoyée
      "id": "aldoria",                    // votre id, ou l'index en texte ("1") par défaut
      "name": "Empire d'Aldoria",
      "color": "#c9a0dc",
      "capital": {
        "name": "Valmont",                // null si aucun nom n'a été fourni
        "x": 812.4, "y": 377.9,           // position du marqueur en pixels
        "label": { "x": 812.4, "y": 370.1, "anchor": "middle", "fontSize": 18.4 }  // null sans nom ou si l'étiquette n'a pas pu être placée
      },
      "cities": [
        { "name": "Port-Sable", "x": 901.2, "y": 402.6, "label": { "x": 906.3, "y": 406.8, "anchor": "start", "fontSize": 16 } }
      ],
      "cellCount": 412,                   // nombre de cellules du territoire
      "landShare": 0.2317,                // part des terres émergées (0 à 1)
      "neighbors": ["0", "2"],            // ids des pays frontaliers
      "label": {                          // étiquette du nom du pays, null si elle n'a pas pu être placée
        "x": 845.0, "y": 390.5,           // centre du texte
        "fontSize": 38.2,
        "lines": ["Empire", "d'Aldoria"]  // le nom peut être réparti sur deux lignes
      },
      "bbox": [690.1, 280.4, 1012.8, 505.3],  // [minX, minY, maxX, maxY] en pixels
      "outline": [[[701.2, 300.5], [705.9, 298.1], /* … */]]  // seulement avec includeGeometry
    }
  ]
}
```

Toutes les coordonnées sont en pixels dans le repère de la carte (`width` × `height`, origine en
haut à gauche), avant application de `scale`. Pour superposer des éléments interactifs sur un PNG
rendu avec `scale: 2`, multipliez-les par 2 ou affichez l'image à sa taille logique.

`outline` est une liste de polygones (un pays peut avoir plusieurs îles), chaque polygone étant une
liste de points `[x, y]`.

---

## 5. Erreurs

Toutes les erreurs sont en JSON, sauf le 401.

| Statut | `error` | Cause |
| --- | --- | --- |
| `400` | `invalid_request` | Paramètre invalide, JSON mal formé, payload base64url illisible, `cells` > `MAX_CELLS`, PNG > 16 Mpx |
| `401` | | Clé d'API absente ou incorrecte (réponse texte `Unauthorized`) |
| `404` | `not_found` | Route inconnue |
| `422` | `generation_failed` | La carte n'a pas pu être générée avec ces paramètres, par exemple « Not enough land for N countries » : réduisez le nombre de pays, augmentez `cells` ou changez de `template` |
| `500` | `internal_error` | Erreur inattendue |

Erreur de validation : `issues` liste chaque problème avec son chemin.

```json
{
  "error": "invalid_request",
  "issues": [
    { "path": "countries", "message": "Too small: expected array to have >=1 items" },
    { "path": "template", "message": "Invalid option: expected one of \"continents\"|\"pangea\"|…" }
  ]
}
```

Autres erreurs :

```json
{ "error": "generation_failed", "message": "…" }
```

---

## 6. Cache et déterminisme

Quand une **seed est fournie**, la réponse est entièrement déterministe :

- `ETag` : si vous renvoyez la même requête avec `If-None-Match: <etag>`, le serveur répond `304 Not
  Modified` sans corps ni génération.
- `Cache-Control: public, max-age=86400` : les navigateurs et CDN peuvent garder l'image un jour.
- Le Worker met la réponse en cache (Cache API) : une requête identique ne régénère pas la carte.

La clé de cache est calculée sur le payload **normalisé** : `seed=42` en GET et `"seed": 42` en POST
partagent la même entrée, tout comme un paramètre omis et le même paramètre fourni avec sa valeur par
défaut. Le format fait partie de la clé.

Sans seed, `Cache-Control: no-store` est renvoyé et rien n'est mis en cache.

La clé inclut aussi `GENERATOR_VERSION` (renvoyée dans `X-Generator-Version`). Elle augmente quand
l'algorithme change d'une façon qui modifie les cartes : une même seed peut alors donner une carte
différente après une mise à jour.

```bash
ETAG=$(curl -sI "$API/v1/maps?countries=A,B&seed=1" | grep -i '^etag' | cut -d' ' -f2 | tr -d '\r')
curl -s -o /dev/null -w '%{http_code}\n' -H "If-None-Match: $ETAG" "$API/v1/maps?countries=A,B&seed=1"   # 304
```

---

## 7. Authentification

Elle est optionnelle. Si le secret `API_KEY` est défini sur le Worker
(`npx wrangler secret put API_KEY`), toutes les routes `/v1/*` exigent :

```
Authorization: Bearer <API_KEY>
```

`/health` et `/` restent publiques.

**GET**

```bash
curl -o carte.png -H "Authorization: Bearer $API_KEY" "$API/v1/maps?countries=A,B&seed=1"
```

**POST**

```bash
curl -o carte.png -X POST "$API/v1/maps" \
  -H "Authorization: Bearer $API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"countries": ["A", "B"], "seed": 1}'
```

> Une balise `<img src>` ne peut pas envoyer d'en-tête `Authorization`. Si la clé est activée,
> récupérez l'image avec `fetch` puis affichez-la via `URL.createObjectURL`, ou servez-la depuis
> votre propre backend.

---

## 8. Autres endpoints

| Méthode | Route | Réponse |
| --- | --- | --- |
| `GET` | `/` | Nom de l'API, version du générateur, liste des endpoints |
| `GET` | `/health` | `{ "ok": true }` |
| `GET` | `/v1/options` | `templates`, `styles`, `formats`, `palette` (couleurs par défaut), `defaults` (payload normalisé avec toutes les valeurs par défaut), `limits` (`countries`, `cells`, `width`, `height`, `pngMegapixels`) |
| `GET` | `/v1/schema` | JSON Schema du payload, utilisable pour la validation côté client ou la génération de formulaires |

```bash
curl "$API/v1/options"
curl "$API/v1/schema"
```

---

## 9. Recettes complètes

### Carte complète en PNG

**POST**

```bash
curl -o elthar.png -X POST "$API/v1/maps" \
  -H 'Content-Type: application/json' \
  -d '{
    "seed": "elthar",
    "title": "Les Royaumes d'"'"'Elthar",
    "template": "mediterranean",
    "style": "parchment",
    "width": 1600, "height": 1000,
    "cells": 12000,
    "scale": 2,
    "countries": [
      { "id": "dun", "name": "Dunmar", "capital": "Dunhold", "cities": ["Grisemer"] },
      { "id": "ald", "name": "Empire d'"'"'Aldoria", "color": "#c9a0dc", "capital": "Valmont",
        "cities": ["Port-Sable", "Brumeval"], "expansionism": 1.5 },
      { "id": "kes", "name": "Kesh", "capital": "Kesh-la-Blanche" }
    ],
    "latitude": { "north": 55, "south": 25 },
    "layers": { "relief": true, "frame": true }
  }'
```

**GET** (même carte via payload)

```bash
PAYLOAD=$(cat <<'EOF' | tr -d '\n' | base64 | tr '+/' '-_' | tr -d '=\n'
{"seed":"elthar","title":"Les Royaumes d'Elthar","template":"mediterranean","style":"parchment",
"width":1600,"height":1000,"cells":12000,"scale":2,
"countries":[{"id":"dun","name":"Dunmar","capital":"Dunhold","cities":["Grisemer"]},
{"id":"ald","name":"Empire d'Aldoria","color":"#c9a0dc","capital":"Valmont","cities":["Port-Sable","Brumeval"],"expansionism":1.5},
{"id":"kes","name":"Kesh","capital":"Kesh-la-Blanche"}],
"latitude":{"north":55,"south":25},"layers":{"relief":true,"frame":true}}
EOF
)
curl -o elthar.png "$API/v1/maps?payload=$PAYLOAD"
```

### Carte simple avec tous les réglages « à plat »

**GET**

```bash
curl -o monde.png "$API/v1/maps?countries=Nordmark,Sudland,Estrie,Vestmark\
&seed=monde-1&format=png&width=1920&height=1080&cells=10000\
&template=continents&style=physical&title=Le%20Monde%20Connu&scale=1\
&latitude.north=70&latitude.south=10&riverDensity=1.5&neutralLands=2\
&layers.labels=true&layers.cities=true&layers.rivers=true\
&layers.relief=true&layers.borders=true&layers.frame=false"
```

**POST**

```bash
curl -o monde.png -X POST "$API/v1/maps" \
  -H 'Content-Type: application/json' \
  -d '{
    "countries": ["Nordmark", "Sudland", "Estrie", "Vestmark"],
    "seed": "monde-1", "format": "png", "width": 1920, "height": 1080, "cells": 10000,
    "template": "continents", "style": "physical", "title": "Le Monde Connu", "scale": 1,
    "latitude": { "north": 70, "south": 10 }, "riverDensity": 1.5, "neutralLands": 2,
    "layers": { "labels": true, "cities": true, "rivers": true, "relief": true, "borders": true, "frame": false }
  }'
```

### Données JSON pour une carte interactive

**GET**

```bash
curl "$API/v1/maps?countries=Nordmark,Sudland&seed=7&format=json&includeGeometry=true"
```

**POST**

```bash
curl -X POST "$API/v1/maps" \
  -H 'Content-Type: application/json' \
  -d '{"countries": [{"id": "n", "name": "Nordmark"}, {"id": "s", "name": "Sudland"}], "seed": 7, "format": "json", "includeGeometry": true}'
```

Côté client, l'image et les données se combinent ainsi :

```js
const res = await fetch(`${API}/v1/maps`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ countries: ['Nordmark', 'Sudland'], seed: 7, format: 'json', includeGeometry: true }),
})
const map = await res.json()
img.src = map.imageUrl            // PNG de la même carte
map.countries.forEach((c) => {    // zones cliquables à partir de c.outline, c.bbox, c.label…
  console.log(c.name, c.landShare, c.neighbors)
})
```

### Renommer un pays sans changer la carte

Stockez l'objet `request` d'une réponse JSON, modifiez uniquement les noms ou les couleurs, puis
renvoyez-le : relief et frontières restent identiques.

```js
const saved = map.request                        // obtenu une première fois avec format: 'json'
saved.countries[0].name = 'Nouveau Nordmark'     // nom, couleur, capitale, villes : sans effet sur la géographie
saved.format = 'png'
const png = await fetch(`${API}/v1/maps`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(saved),
})
```

### Intégration HTML

```html
<!-- Mode à plat -->
<img src="https://votre-worker.workers.dev/v1/maps?countries=Dunmar,Aldoria&seed=42&style=parchment&width=800&height=600"
     alt="Carte des royaumes" width="800" height="600">

<!-- Retina : scale=2, affichage à la taille logique -->
<img src="https://votre-worker.workers.dev/v1/maps?countries=Dunmar,Aldoria&seed=42&width=800&height=600&scale=2"
     alt="Carte des royaumes" width="800" height="600">
```
