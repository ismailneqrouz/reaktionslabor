# Reaktionslabor

Interaktives Lernsystem „Chemische Reaktionen: Kinetik und Gleichgewicht“ — React + TypeScript (Vite).

## Lokal starten

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # Produktions-Build nach dist/
npm run preview    # Build lokal ansehen
```

## Struktur

- `src/App.tsx` – React-Shell (Seitenleiste + Hauptspalte)
- `src/lab/engine.ts` – Logik, Widgets, Routing (aus der Original-HTML portiert)
- `src/lab/app-data.json` – Kapitel, Quiz, Karteikarten usw.
- `src/styles.css` – Styles inkl. Dark Mode

## GitHub Pages

`.github/workflows/deploy.yml` baut und veröffentlicht bei jedem Push auf `main`.
Im Repo unter **Settings → Pages → Source** „GitHub Actions“ auswählen.
