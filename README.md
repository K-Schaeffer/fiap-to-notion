# FIAP to Notion

A personal tool I built to scratch my own itch: automatically syncing my FIAP course materials into my Notion workspace so I can study from a single place without manually copying anything. The app is a three-stage CLI pipeline — scrape, convert, upload — and each stage is fully resumable if interrupted.

With this tool I scraped through **5 phases**, **119 classes**, and **335 videos** — converting **~26 GB** of HLS streams into MP4s totalling **92 hours and 15 minutes** of course content — and uploaded them directly into the corresponding Notion class pages.

## Description

**Scraper** — authenticates on the FIAP platform, extracts course structure (phases, subjects, classes), matches each class to its Notion page, and scrapes HLS video URLs.

**Video Converter** — downloads HLS video streams and converts them to MP4 files using ffmpeg. Fully offline — no browser or credentials needed, just the scraped data.

**Notion Uploader** — uploads the converted MP4s to Notion's file storage and embeds them as video blocks inside a "Playlist" toggle on each class page. Only requires a Notion token.

All three modes are fully resumable. Progress is persisted after every video/class, so interrupted runs pick up exactly where they left off.

### Flow

1. Launch the CLI (`npm run dev`) and pick a mode: **Scraper**, **Video Converter**, or **Notion Uploader**.
2. **Scraper**: authenticate → select a phase → sync subjects/classes to Notion → fetch HLS video URLs.
3. **Video Converter**: select a phase with fetched videos → download and convert all videos to MP4 in parallel.
4. **Notion Uploader**: select a phase with converted videos → upload MP4s and embed them in class pages.

## How It Works

```mermaid
sequenceDiagram
    actor user as User
    participant cli as CLI
    participant state as data/output.json
    participant fiap as FIAP Platform
    participant notion as Notion
    participant ffmpeg as ffmpeg

    user->>cli: npm run dev
    cli->>user: Select mode

    rect rgb(40, 40, 60)
        Note over cli,notion: Scraper Mode
        cli->>fiap: Login + fetch phases
        fiap-->>cli: Phase list
        cli->>state: Load local data
        state-->>cli: Synced phases + video status

        loop Until exit
            cli->>user: Select phase [S][V]
            user-->>cli: Fase N + action

            opt Sync
                cli->>fiap: Scrape subjects + classes
                cli->>notion: Match to Conteúdo DB
                cli->>state: Upsert phase
            end

            opt Get Videos
                loop Each unfetched class (sequential)
                    cli->>fiap: Scrape HLS URLs (new tab)
                    cli->>state: Write videos immediately
                end
            end
        end
    end

    rect rgb(40, 60, 40)
        Note over cli,ffmpeg: Video Converter Mode (offline)
        cli->>state: Read phases with fetched videos

        loop Until exit
            cli->>user: Select phase [C]
            user-->>cli: Fase N

            par Download all unconverted videos
                cli->>ffmpeg: HLS → MP4 (video 1)
                cli->>ffmpeg: HLS → MP4 (video 2)
                cli->>ffmpeg: HLS → MP4 (video N)
            end
            ffmpeg-->>cli: Done
            cli->>state: Mark each video converted
        end
    end

    rect rgb(60, 40, 40)
        Note over cli,notion: Notion Uploader Mode
        cli->>state: Read phases with converted videos

        loop Until exit
            cli->>user: Select phase [U]
            user-->>cli: Fase N

            loop Each class with unuploaded videos (parallel, bounded)
                par Upload videos for class
                    cli->>notion: fileUploads.create + send (video 1)
                    cli->>notion: fileUploads.create + send (video 2)
                end
                cli->>notion: Embed video blocks in class page
                cli->>state: Mark class videos uploaded
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
- **Conteúdo** — one row per class; this is what the scraper matches against and what videos are uploaded to

## Technologies

- **[TypeScript](https://www.typescriptlang.org/)** — type-safe JavaScript
- **[Puppeteer](https://pptr.dev/)** — headless browser for scraping the FIAP course platform
- **[Notion SDK](https://github.com/makenotion/notion-sdk-js)** — querying, updating, and uploading files to the Notion workspace
- **[ffmpeg](https://ffmpeg.org/)** — HLS to MP4 video conversion (system install, not bundled)
- **[@inquirer/prompts](https://github.com/SBoudrias/Inquirer.js)** — interactive CLI prompts
- **[ora](https://github.com/sindresorhus/ora)** — terminal spinners for async feedback

## Prerequisites

Make sure you have the following installed:

- **Node.js** (>= 24.x)
- **npm** (>= 11.x)
- **ffmpeg** — required for Video Converter mode

```bash
# Ubuntu/Debian
sudo apt install ffmpeg

# macOS
brew install ffmpeg
```

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

### Environment variables

| Variable                   | Required           | Description                                                                         |
| -------------------------- | ------------------ | ----------------------------------------------------------------------------------- |
| `FIAP_USERNAME`            | Scraper            | FIAP course login                                                                   |
| `FIAP_PASSWORD`            | Scraper            | FIAP course password                                                                |
| `NOTION_TOKEN`             | Scraper / Uploader | Notion integration token                                                            |
| `NOTION_PHASES_DB_ID`      | Scraper            | Page ID of the top-level Fases database                                             |
| `FFMPEG_CONCURRENCY`       | No                 | Max parallel ffmpeg processes (default: unlimited)                                  |
| `NOTION_UPLOAD_CONCURRENCY`| No                 | Max parallel class uploads in Uploader (default: 3, matches Notion's ~3 req/s rate limit; set to 0 for unlimited) |

## Output

All output is stored in `data/` (gitignored):

```
data/
├── output.json                              # Scraped state (phases, classes, video URLs, flags)
└── videos/
    └── Fase 1 - .../
        └── Subject Name/
            └── Class Name/
                ├── Video Title - I.mp4
                └── Video Title - II.mp4
```

MP4 files can be deleted after a successful Notion upload — they're only needed during the upload step.

## Scripts

### `dev`

Runs the project in **development mode** (using `ts-node` to directly run TypeScript files without compilation).

### `build:start`

Compiles the TypeScript code and then starts the project (recommended for production).

### `build`

Compiles the TypeScript code into JavaScript.

### `start`

Starts the project after compilation.
