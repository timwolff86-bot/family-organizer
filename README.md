# Familienplaner 🏡

Unser gemeinsamer Haushaltsplan als Web-App fürs Handy (iPhone und Android).
Beim Öffnen erscheint immer der heutige Tag mit:

- **Erinnerungen**: To-dos für einen Tag (Uhrzeit optional), einmalig oder wiederkehrend,
  für eine oder mehrere Personen. Jede/r kann abhaken.
- **Terminen**: einmalig oder wöchentlich (z. B. Pickleball Mi + Fr). Einzelne Termine einer Serie
  können „ausfallen“.
- **Essen** für den Tag
- **Aufgaben** mit Filter „Alle / Meine“

Dazu gibt es eine **Wochenansicht** (inkl. Essensplanung), eine **Einkaufsliste** mit automatischen
Supermarkt-Kategorien (Produktkatalog in der Datenbank, lernt Korrekturen dazu) und unter **Mehr** die
Verwaltung von Familie (mit Profilbildern), Terminen, Erinnerungen und Aufgaben.

Bedienung: Wischen nach links/rechts wechselt den Tag, Tippen auf das Datum öffnet einen Kalender,
das ＋ legt Termine, Erinnerungen oder Aufgaben an.

## Einrichtung

### 1. Supabase (gemeinsamer Speicher)

1. Im [Supabase-Dashboard](https://supabase.com/dashboard) ein neues Projekt anlegen
   (Region z. B. Frankfurt).
2. **SQL Editor → New query**: den Inhalt von [`supabase/schema.sql`](supabase/schema.sql) einfügen und **Run** drücken
   (bei der RLS-Warnung „Run without RLS“ – das Skript schaltet den Schutz selbst ein).
3. **Authentication → Users → Add user → Create new user**: ein Konto für jede Person anlegen
   (E-Mail + Passwort, Haken bei „Auto Confirm User“).
4. **Authentication → Sign In / Providers**: „Allow new users to sign up“ **ausschalten**.
   Dann kann sich niemand Fremdes registrieren.
5. **Project Settings → API**: die **Project URL** und den **anon / publishable key** in
   [`config.js`](config.js) eintragen.

### 2. Veröffentlichen mit GitHub Pages (kostenlos)

Im Repository auf GitHub: **Settings → Pages → Build and deployment → Source: „Deploy from a branch“**,
Branch **main**, Ordner **/ (root)** → **Save**. Nach ca. einer Minute ist die App erreichbar unter:

`https://timwolff86-bot.github.io/family-organizer/`

### 3. Aufs Handy holen

- **iPhone:** Link in **Safari** öffnen → Teilen-Symbol → **„Zum Home-Bildschirm“**.
- **Android:** Link in Chrome öffnen → Menü ⋮ → **„App installieren“**.

Beim ersten Start anmelden und auswählen, wer man ist.

## Lokaler Modus

Solange in `config.js` nichts eingetragen ist, speichert die App nur auf dem jeweiligen Gerät.
Praktisch zum Ausprobieren, aber nicht geteilt.

## Technik

Reines HTML/CSS/JavaScript ohne Build-Schritt. Daten in Supabase (Postgres) mit Login und
Live-Aktualisierung zwischen den Geräten. Ein Service Worker macht die App installierbar.

| Datei | Inhalt |
|---|---|
| `index.html`, `styles.css` | Seite und Aussehen |
| `app.js` | Oberfläche und Logik |
| `store.js` | Speichern/Laden (Supabase oder lokal) |
| `dates.js` | Datums-Helfer |
| `products.js` | Einkaufs-Kategorien, Start-Produktkatalog, Erkennung |
| `config.js` | Supabase-Zugang |
| `sw.js`, `manifest.webmanifest`, `icons/` | Installierbare App |
| `supabase/schema.sql` | Datenbank-Tabellen und Zugriffsregeln |

Lokal starten: `python3 -m http.server` im Ordner, dann <http://localhost:8000> öffnen.
