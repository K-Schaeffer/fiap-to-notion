# FIAP to Notion Web Scraper

A work in progress... :hourglass_flowing_sand:

## Description

This project automates syncing study materials from my FIAP course into my personal Notion workspace. It scrapes the course platform, extracts course structure and HLS video URLs, and persists everything locally — ready for upload to Notion.

The scraper will:

1. Authenticate on the FIAP course page.
2. Present an interactive phase selector with sync and video status indicators.
3. Scrape subjects and classes for the selected phase, matching each to its Notion page.
4. Extract HLS video URLs for each class, persisting progress to `output/output.json` after every class so runs are resumable on crash or CloudFront block.
5. _(Upcoming)_ Upload videos to Notion.

## How It Works

```mermaid
sequenceDiagram
    actor user as User
    participant scraper as Scraper
    participant state as output.json
    participant fiap as FIAP Platform
    participant notion as Notion

    user->>scraper: npm run dev
    scraper->>fiap: Login + fetch phases
    fiap-->>scraper: Phase list
    scraper->>state: Load local data (last sync timestamp)
    state-->>scraper: Synced phases + video status

    loop Until exit
        scraper->>user: Select phase [S][V] status indicators
        user-->>scraper: Fase N + action

        opt Sync (first run only)
            scraper->>fiap: Scrape subjects + classes
            fiap-->>scraper: ClassItem[]
            scraper->>notion: Query Conteúdo DB
            notion-->>scraper: Existing entries
            scraper->>scraper: Match titles → page IDs
            scraper->>state: Upsert phase (preserve existing videos)
        end

        opt Get Videos
            loop Each unfetched class (sequential)
                scraper->>fiap: Navigate to class content page (new tab)
                fiap-->>scraper: Playlist items + thumbnail URLs
                scraper->>scraper: Derive HLS URLs from CDN hash
                scraper->>state: Write class videos immediately
            end
        end
    end
```

## Notion Workspace Structure

> **Note:** This project is tailored to a specific Notion workspace structure. The scraper expects the following hierarchy to exist before running — pages and databases are not created automatically.

```mermaid
graph TD
    fases_db[(Fases DB)] --> fase_n[Fase N]
    fase_n --> disciplinas_db[(Disciplinas DB)]
    fase_n --> conteudo_db[(Conteúdo DB)]
    disciplinas_db --> subject[Subject]
    conteudo_db --> aula[Class]
    subject -. relation .-> aula
```

Each **Fase** page contains two inline databases:
- **Disciplinas** — one row per subject, with a relation to Conteúdo
- **Conteúdo** — one row per class; this is what the scraper matches against and uploads to

## Technologies

- **[TypeScript](https://www.typescriptlang.org/)** — type-safe JavaScript
- **[Puppeteer](https://pptr.dev/)** — headless browser for scraping the FIAP course platform
- **[Notion SDK](https://github.com/makenotion/notion-sdk-js)** — querying and updating the Notion workspace
- **[@inquirer/prompts](https://github.com/SBoudrias/Inquirer.js)** — interactive CLI prompts
- **[ora](https://github.com/sindresorhus/ora)** — terminal spinners for async feedback

## Prerequisites

Make sure you have the following installed:

- **Node.js** (>= 24.x)
- **npm** (>= 11.x)

**Tip**: It is highly recommended to use **[nvm](https://github.com/nvm-sh/nvm)** (Node Version Manager) to manage and switch between different versions of Node.js easily.

## Installation

Clone the repository and install the dependencies:

```bash
git clone git@github.com:K-Schaeffer/fiap-to-notion.git
cd fiap-to-notion
nvm use # If you have nvm it will set the projects node version for you
npm install
cp .env.example .env
```

## Scripts

### `dev`

Runs the project in **development mode** (using `ts-node` to directly run TypeScript files without compilation).

### `build:start`

Compiles the TypeScript code and then starts the project (recommended for production).

### `build`

Compiles the TypeScript code into JavaScript.

### `start`

Starts the project after compilation.
