# ClearLLM

**Anonymisez vos messages avant de les envoyer aux LLM. Restaurez les données originales dans les réponses.**

ClearLLM est une application web self-hosted qui détecte et remplace automatiquement les données personnelles (PII) dans vos messages grâce à [Microsoft Presidio](https://microsoft.github.io/presidio/), avant que vous ne les envoyiez à ChatGPT, Claude, Gemini ou tout autre LLM. La réponse du LLM peut ensuite être dé-anonymisée pour retrouver les données originales.

> Aucune donnée n'est stockée sur disque. Tout le traitement se fait en mémoire. Les sessions expirent automatiquement.

---

## Fonctionnalités

- **Détection automatique de PII** — noms, emails, téléphones, adresses, IBAN, cartes bancaires, numéros de sécu, IP, URL, dates...
- **Support multilingue** — Français et Anglais (modèles spaCy dédiés)
- **Reconnaisseurs custom FR** — téléphones français (06/07/+33), NIR (numéro de sécurité sociale), IBAN français
- **Dé-anonymisation** — collez la réponse du LLM, les placeholders sont remplacés par les valeurs originales
- **Interface professionnelle** — dark theme, responsive, raccourcis clavier
- **Zéro persistance** — traitement 100% en mémoire, sessions éphémères avec TTL
- **Sécurité renforcée** — CSP, HSTS, rate limiting, Docker non-root, filesystem read-only

---

## Flux d'utilisation

```
┌──────────────────┐      ┌──────────────────┐      ┌──────────────────┐
│  1. Votre message │ ──▶  │  2. Message       │ ──▶  │  3. Envoi au LLM │
│                    │      │     anonymisé     │      │  (copier/coller) │
│  "Bonjour, je     │      │  "Bonjour, je     │      │                  │
│   suis Guillaume,  │      │   suis <PERSON_1>,│      │  ChatGPT, Claude │
│   mon email est    │      │   mon email est   │      │  Gemini, etc.    │
│   g.dupont@mail.fr"│      │   <EMAIL_1>"      │      │                  │
└──────────────────┘      └──────────────────┘      └──────────────────┘
                                                              │
┌──────────────────┐      ┌──────────────────┐              │
│  5. Réponse       │ ◀──  │  4. Réponse LLM  │ ◀────────────┘
│     restaurée     │      │  (avec placeholders)│
│                    │      │                    │
│  "Guillaume, votre│      │  "<PERSON_1>, votre│
│   email g.dupont   │      │   email <EMAIL_1>  │
│   est confirmé"    │      │   est confirmé"    │
└──────────────────┘      └──────────────────┘
```

---

## Démarrage rapide

### Avec Docker (recommandé)

```bash
git clone https://github.com/BHAALOL/ClearLLM.git
cd ClearLLM
cp .env.example .env
docker compose up -d
```

L'application est accessible sur **http://localhost:8000**

### Sans Docker (développement)

```bash
git clone https://github.com/BHAALOL/ClearLLM.git
cd ClearLLM

python -m venv venv
source venv/bin/activate  # Linux/macOS
# venv\Scripts\activate   # Windows

pip install -r requirements.txt
python -m spacy download en_core_web_md
python -m spacy download fr_core_news_md

cp .env.example .env
uvicorn backend.main:app --reload --port 8000
```

---

## Configuration

Toute la configuration se fait via variables d'environnement ou fichier `.env` :

| Variable | Défaut | Description |
|----------|--------|-------------|
| `HOST` | `0.0.0.0` | Adresse d'écoute du serveur |
| `PORT` | `8000` | Port d'écoute |
| `ALLOWED_ORIGINS` | `*` | Origines CORS autorisées (séparées par des virgules) |
| `RATE_LIMIT_PER_MINUTE` | `30` | Nombre max de requêtes API par minute par IP |
| `SESSION_TTL_MINUTES` | `30` | Durée de vie des sessions d'anonymisation |
| `MAX_SESSIONS` | `1000` | Nombre max de sessions simultanées en mémoire |
| `MAX_TEXT_LENGTH` | `50000` | Longueur max du texte en entrée (caractères) |

---

## Entités détectées

### Reconnaisseurs intégrés (Presidio)

| Entité | Exemples |
|--------|----------|
| `PERSON` | Guillaume Dupont, Jean Martin |
| `EMAIL_ADDRESS` | guillaume.dupont@email.fr |
| `PHONE_NUMBER` | 06 12 34 56 78, +33 6 12 34 56 78 |
| `LOCATION` | Paris, 12 rue de la Paix |
| `CREDIT_CARD` | 4111 1111 1111 1111 |
| `IBAN_CODE` | FR76 3000 6000 0112 3456 7890 189 |
| `DATE_TIME` | 15 mars 2025, 14/07/1989 |
| `IP_ADDRESS` | 192.168.1.1 |
| `URL` | https://example.com |
| `NRP` | Nationalité, religion, groupe politique |

### Reconnaisseurs custom français

| Entité | Exemples |
|--------|----------|
| `FR_SSN` | 1 85 05 78 006 084 26 (numéro de sécurité sociale) |
| `PHONE_NUMBER` (FR) | 06.12.34.56.78, 07-12-34-56-78 |
| `IBAN_CODE` (FR) | FR76 3000 6000 0112 3456 7890 189 |

---

## API

L'API REST est utilisable indépendamment du frontend.

### `POST /api/analyze`

Détecte les PII sans les anonymiser.

```bash
curl -X POST http://localhost:8000/api/analyze \
  -H "Content-Type: application/json" \
  -d '{"text": "Appelez Guillaume au 06 12 34 56 78", "language": "fr"}'
```

```json
{
  "entities": [
    {"entity_type": "PERSON", "text": "Guillaume", "start": 8, "end": 17, "score": 0.85},
    {"entity_type": "PHONE_NUMBER", "text": "06 12 34 56 78", "start": 21, "end": 35, "score": 0.7}
  ]
}
```

### `POST /api/anonymize`

Détecte et remplace les PII. Retourne un `session_id` pour la dé-anonymisation.

```bash
curl -X POST http://localhost:8000/api/anonymize \
  -H "Content-Type: application/json" \
  -d '{"text": "Appelez Guillaume au 06 12 34 56 78", "language": "fr"}'
```

```json
{
  "session_id": "a1b2c3d4e5f6...",
  "anonymized_text": "Appelez <PERSON_1> au <PHONE_NUMBER_1>",
  "entities": [
    {"entity_type": "PERSON", "original": "Guillaume", "anonymized": "<PERSON_1>", "score": 0.85},
    {"entity_type": "PHONE_NUMBER", "original": "06 12 34 56 78", "anonymized": "<PHONE_NUMBER_1>", "score": 0.7}
  ]
}
```

### `POST /api/deanonymize`

Remplace les placeholders par les valeurs originales.

```bash
curl -X POST http://localhost:8000/api/deanonymize \
  -H "Content-Type: application/json" \
  -d '{"session_id": "a1b2c3d4e5f6...", "text": "<PERSON_1> est disponible au <PHONE_NUMBER_1>"}'
```

```json
{
  "deanonymized_text": "Guillaume est disponible au 06 12 34 56 78"
}
```

### `DELETE /api/session/{session_id}`

Supprime immédiatement une session et ses mappings.

### `GET /api/health`

Health check pour le monitoring et les orchestrateurs.

---

## Sécurité

### Principes

| Mesure | Détail |
|--------|--------|
| **Zéro stockage** | Aucune base de données, aucun fichier. Tout est en RAM |
| **Sessions éphémères** | TTL de 30 min par défaut, suppression manuelle possible |
| **Nettoyage automatique** | Les sessions expirées sont purgées régulièrement |
| **Rate limiting** | Fenêtre glissante par IP sur les endpoints API |
| **Security headers** | CSP strict, HSTS, X-Frame-Options DENY, no-referrer |
| **Pas de docs exposées** | OpenAPI/Swagger désactivés en production |
| **Docker hardened** | Utilisateur non-root, filesystem read-only, no-new-privileges |
| **Pas de logs PII** | Aucune donnée personnelle dans les logs applicatifs |

### Headers HTTP

```
Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'
Strict-Transport-Security: max-age=63072000; includeSubDomains; preload
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
Referrer-Policy: no-referrer
Permissions-Policy: camera=(), microphone=(), geolocation=(), interest-cohort=()
```

### Recommandations de déploiement

- Placez un reverse proxy (Nginx, Traefik, Caddy) devant l'application pour le TLS
- Restreignez `ALLOWED_ORIGINS` à votre domaine en production
- Limitez l'accès réseau au strict nécessaire
- Surveillez les logs pour détecter des patterns d'abus

---

## Déploiement sur Dokploy

1. **Ajouter l'application** dans Dokploy avec le repo : `https://github.com/BHAALOL/ClearLLM`
2. **Type de build** : `Dockerfile`
3. **Port** : `8000`
4. **Variables d'environnement** (optionnel) :
   ```
   ALLOWED_ORIGINS=https://votre-domaine.com
   RATE_LIMIT_PER_MINUTE=30
   SESSION_TTL_MINUTES=30
   ```
5. **Déployer** — le Dockerfile gère tout (dépendances, modèles NLP, configuration)

---

## Structure du projet

```
ClearLLM/
├── backend/
│   ├── __init__.py
│   ├── anonymizer.py      # Service Presidio : analyse, anonymisation, dé-anonymisation
│   ├── config.py           # Configuration via variables d'environnement
│   ├── main.py             # Application FastAPI, middleware, routes
│   └── models.py           # Modèles Pydantic (requêtes/réponses)
├── frontend/
│   ├── css/
│   │   └── style.css       # Dark theme professionnel
│   ├── js/
│   │   └── app.js          # Logique frontend
│   └── index.html          # Interface utilisateur
├── .dockerignore
├── .env.example
├── .gitignore
├── docker-compose.yml      # Orchestration locale avec hardening
├── Dockerfile              # Build de production (non-root, healthcheck)
├── README.md
└── requirements.txt
```

---

## Stack technique

| Composant | Technologie |
|-----------|-------------|
| Backend | [FastAPI](https://fastapi.tiangolo.com/) |
| Détection PII | [Microsoft Presidio](https://microsoft.github.io/presidio/) |
| NLP | [spaCy](https://spacy.io/) (en_core_web_md, fr_core_news_md) |
| Frontend | HTML, CSS, JavaScript (vanilla) |
| Conteneurisation | Docker |
| Validation | [Pydantic](https://docs.pydantic.dev/) |

---

## Raccourcis clavier

| Raccourci | Action |
|-----------|--------|
| `Ctrl + Entrée` | Lancer l'analyse et l'anonymisation |

---

## Licence

Ce projet est privé. Tous droits réservés.
