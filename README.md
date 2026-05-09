<img width="2560" height="1285" alt="Screenshot 2026-05-09 at 7 52 12 AM" src="https://github.com/user-attachments/assets/d8c96542-7d4c-4810-a357-f957b61da9b1" />

# SQLite Viewer

A web-based SQLite database viewer and editor built with Node.js. Open any `.db`, `.sqlite`, or `.sqlite3` file from your filesystem, browse its contents, edit data, and modify schemas — all from a clean, mobile-friendly UI in your browser. Made this because the sql viewer extensions in vscode, actually sucks in terms of UI (the ones that even work anyway) and of course they want you to pay once your DB is over a certain size, and paywall native sql features. 

---

## Features

- **File Browser** — navigate your entire filesystem to select a database file
- **Upload** — drag & drop or upload a file directly from your device
- **Data View** — paginated table grid with sorting, filtering, and configurable page size
- **Row Editing** — add, edit, and delete rows; text columns use auto-growing textareas
- **Bulk Delete** — select multiple rows with checkboxes and delete in one click
- **Sticky Actions Column** — Edit/Delete buttons stay visible while scrolling wide tables
- **Schema View** — inspect columns, types, constraints, indices, foreign keys, and the raw DDL
- **Schema Editing** — rename/drop columns, add columns, rename/drop tables
- **Create Table** — write a `CREATE TABLE` statement to add a new table
- **SQL Editor** — run any SQL query with `Ctrl+Enter` (or `⌘+Enter`), results shown as a table
- **Export CSV** — download any table as a `.csv` file
- **Mobile Friendly** — responsive layout with a collapsible sidebar and touch-friendly controls

---

## Requirements

- [Node.js](https://nodejs.org/) v18 or later  **or**  [Docker](https://docs.docker.com/get-docker/) + [Docker Compose](https://docs.docker.com/compose/)

No native compilation required — SQLite runs via WebAssembly (`sql.js`).

---

## Quick Start (Node.js)

```bash
npm install
node server.js
```

Open **http://localhost:3000** in your browser.

To use a different port:

```bash
PORT=8080 node server.js
```

---

## Docker

### ZimaOS

SSH into your ZimaOS machine, clone or copy the project, then run:

```bash
docker compose up --build -d
```

Open **http://\<your-zima-ip\>:3010** in your browser.

The compose file mounts the paths ZimaOS uses out of the box:

| Mount | What you can browse |
|---|---|
| `/root` | Root user home directory |
| `/home` | All other user home directories |
| `/DATA` | ZimaOS main storage (Media, Documents, etc.) |
| `/media` | USB drives and external media |
| `/mnt` | Other mounted filesystems |

### Any Linux server

Same command:

```bash
docker compose up --build -d
```

Adjust the volume list in `docker-compose.yml` to match your storage layout.

### macOS (local dev)

```bash
docker run -p 3010:3000 \
  -v "$HOME:$HOME" \
  -v /Volumes:/Volumes \
  -e HOME="$HOME" \
  $(docker build -q .)
```

### Stop

```bash
docker compose down
```

---

## Usage

### Opening a database

**Browse Files** — click "Browse Files" (header or landing screen) to navigate your filesystem. Folders and SQLite files are shown; click a file to open it.

**Upload** — click "Upload" or drag & drop a file onto the landing screen.

### Viewing data

Select a table from the left sidebar. The **Data** tab shows a paginated grid:

| Control | Action |
|---|---|
| Click a column header | Sort ascending/descending |
| Search box | Filter visible rows |
| Rows dropdown | Change page size (25 / 50 / 100 / 250) |
| Row checkbox | Select rows for bulk delete |
| Edit button *(sticky right)* | Open edit modal for that row |
| Delete button *(sticky right)* | Delete that single row |

The **Edit** and **Delete** buttons are pinned to the right edge of the table — they stay visible while scrolling horizontally through wide tables.

### Editing data

- **Add Row** — click the green "Add Row" button. Fill in field values and click "Insert Row".
- **Edit Row** — click the "Edit" button on any row. Text and blob columns use auto-sizing textareas; other types use single-line inputs.
- **Delete Row(s)** — check one or more rows, then click the red "Delete (n)" button.

### Schema

Click the **Schema** tab for the active table to:

- View all columns with their type, constraints (PK, NOT NULL), and default values
- **Rename a column** — click "Rename" next to a column
- **Drop a column** — click "Drop" next to a column (cannot drop primary key columns)
- **Add a column** — click "+ Add Column", choose a name, type, and optional NOT NULL + default
- **Rename the table** — type a new name and click "Rename"
- **Drop the table** — click "Drop Table" (with confirmation)
- View indices, foreign keys, and the raw `CREATE TABLE` statement

### Creating a table

Click the **+** icon at the top of the sidebar to open the "Create New Table" dialog. Enter a valid `CREATE TABLE` SQL statement and click "Create Table".

### SQL Editor

Click the **SQL** tab to open the query editor. Write any SQL and run it with:

- `Ctrl+Enter` (Windows / Linux)
- `⌘+Enter` (macOS)
- Or click the "Run Query" button

`SELECT` queries display results as a table. Other statements (`INSERT`, `UPDATE`, `DELETE`, `CREATE`, etc.) display the number of affected rows.

### Exporting

Click **Export CSV** in the content header to download the current table as a comma-separated file.

---

## Supported File Types

| Extension | Description |
|---|---|
| `.db` | Generic SQLite database |
| `.sqlite` | SQLite database |
| `.sqlite3` | SQLite database (version 3) |
| `.s3db` | SQLite database |
| `.sl3` | SQLite database |

---

## Project Structure

```
sqllite viewer/
├── Dockerfile
├── docker-compose.yml
├── .dockerignore
├── server.js              # Express server + SQLite API
├── package.json
├── public/
│   ├── index.html         # App HTML
│   ├── style.css          # Styles (mobile-first, responsive)
│   └── app.js             # Frontend JavaScript
└── uploads/               # Temporary storage for uploaded files (auto-created)
```

---

## Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js 20 |
| Web server | Express |
| SQLite engine | [sql.js](https://sql.js.org/) (SQLite compiled to WebAssembly) |
| File uploads | Multer |
| Container | Docker / Docker Compose |
| Frontend | Vanilla HTML / CSS / JavaScript — no framework |

Using `sql.js` means no native compilation is needed, so the app installs and runs on any platform without build tools — including inside a minimal Alpine-based Docker image.

---

## Notes

- The database is loaded into memory when opened. Changes are written back to disk after every write operation. For very large databases (> 500 MB) this may use significant RAM.
- Uploaded files are stored in `uploads/` (a named Docker volume when running via Compose, or the local `uploads/` folder otherwise).
- The file browser can access any path your OS user (or container user) has read permission for.
