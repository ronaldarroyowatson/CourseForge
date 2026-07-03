# CourseForge — Greenfield Rewrite (vNext)

CourseForge is a local‑first curriculum authoring platform for teachers. It combines a browser extension for quick capture with a full web app for textbook management, sync, moderation, and XML export.

This repository now serves as the greenfield rewrite workspace for CourseForge vNext.
The previous v0 spike has been fully archived and preserved in `/archive/courseforge-v0-spike.zip`.
All spike deliverables remain available in `/deliverables/`.

---

## 🚀 Current Status

### ✔️ v0 Spike Archived
The entire previous codebase has been zipped and stored in `/archive/`.  
This ensures full historical preservation while providing a clean slate for the rewrite.

### ✔️ Deliverables Preserved
All spike deliverables remain in `/deliverables/` for reference during the rewrite.

### ✔️ Repo Reset for Greenfield Development
All other files have been removed to prepare for a clean, modern architecture.

---

## 🎯 Goals of the Greenfield Rewrite

The rewrite focuses on:

- Local‑first reliability  
- Modular architecture  
- Modern tooling  
- Improved Auto Mode pipeline clarity  
- Better admin and moderation flows  
- Cleaner developer experience  

---

## 📁 Repository Structure (Greenfield)

This repo currently contains:
```
/archive/           # Full v0 spike snapshot (courseforge-v0-spike.zip)
/deliverables/      # Spike deliverables preserved for reference
README.md           # This file
.git/               # Git history preserved
.gitignore
```

As development proceeds, the following structure will be introduced:

```
src/core/           # Entities, repositories, sync logic, XML export
src/webapp/         # React app for textbook management + admin tools
src/extension/      # Browser extension for quick capture workflows
src/firebase/       # Firebase client wiring
functions/          # Firebase Cloud Functions
tests/core/         # Core regression tests
tests/integration/  # Auth/admin integration tests
docs/               # Architecture, schema, onboarding, flowcharts
```

---

## 📦 Archived Spike Contents

The v0 spike archive includes:

- Full webapp + extension source  
- Firebase Functions  
- Auto Mode pipeline implementation  
- OCR fallback logic  
- Admin tools and moderation flows  
- Installer packaging scripts  
- Windows/macOS portable builds  
- All tests and schema docs  

This archive is not used directly in the rewrite but serves as a reference for:

- Feature parity  
- Migration planning  
- Architecture comparison  
- Historical debugging  

---

## 🧭 Rewrite Roadmap

### Phase 1 — Foundation
- Establish new folder structure  
- Reintroduce core entities and schema  
- Implement local-first persistence layer  
- Define sync boundaries and conflict resolution  

### Phase 2 — Webapp
- Rebuild textbook hierarchy UI  
- Rebuild admin tools  
- Rebuild moderation flows  
- Rebuild XML export  

### Phase 3 — Extension
- Rebuild capture workflows  
- Rebuild Auto Mode pipeline  
- Rebuild OCR fallback logic  

### Phase 4 — Packaging & Deployment
- Rebuild installer pipelines  
- Rebuild portable artifacts  
- Rebuild updater logic  

---

## 🧪 Testing Strategy

The rewrite will restore and expand the following test suites:

- tests/core — XML, entities, sync logic  
- tests/integration — auth, admin, moderation  
- tests/e2e — Auto Mode, OCR, metadata fallback  
- Installer tests (Windows/macOS)  

---

## 🛠 Developer Notes

- Node 20 is the authoritative runtime for Functions.  
- Node 20–24 is supported for the root workspace.  
- Firebase project configuration must match `src/firebase/firebaseConfig.ts`.  
- Installer packaging requires Inno Setup 6 for GUI builds.  

---

## 📚 Documentation

The following documents from the spike archive will be reintroduced and modernized:

- Architecture Overview  
- DB Schema  
- XML Schema  
- Auto Mode Pipeline Flowchart  
- Installer Flowchart  
- Updater Maintainer Guide  
- i18n Architecture  
- Accessibility Plan  
- ChromeOS Deployment Guide  

---

## 📄 License

See `LICENSE`.