# FIAP to Notion Web Scraper

A web scraper that authenticates, extracts PDFs and videos from my FIAP course, and organizes the content in my personal Notion for structured studying.

## Description

This project is designed to automate the process of downloading study materials (PDFs and videos) from FIAP courses and uploading them into my personal Notion. The main goal is to streamline the workflow of storing course content for later reference and organization.

The scraper will:

1. Authenticate on the FIAP course page.
2. Extract PDFs and video links for each class.
3. Download the PDFs.
4. Download and convert the video files.
5. Upload the PDFs and videos to Notion.

## Prerequisites

Make sure you have the following installed:

- **Node.js** (>= 20.x)
- **npm** (>= 10.x)

**Tip**: It is highly recommended to use **[nvm](https://github.com/nvm-sh/nvm)** (Node Version Manager) to manage and switch between different versions of Node.js easily.

## Installation

Clone the repository and install the dependencies:

```bash
git clone git@github.com:K-Schaeffer/fiap-to-notion.git
cd fiap-to-notion
nvm use # If you have nvm it will set the projects node version for you
npm install
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
