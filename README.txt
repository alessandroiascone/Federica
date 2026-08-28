LEZIONI MATEMATICA — PWA GITHUB PAGES
Versione contabilità + tariffe + mensili V6.1

AGGIORNAMENTO DI UNA REPO ESISTENTE
1. Estrai lo ZIP.
2. Nella repo GitHub carica/sostituisci i file della root con quelli di questo pacchetto.
3. Carica anche il nuovo file app.js.
4. Mantieni la cartella icons.
5. GitHub Pages: Settings > Pages > Deploy from a branch > main > /(root).
6. Attendi il deploy, poi apri la PWA online una volta per ricevere l'aggiornamento.

DATI ESISTENTI
- I dati già salvati sul telefono NON vengono azzerati dall'aggiornamento.
- La nuova versione continua a leggere il database locale precedente.
- Le vecchie lezioni che non avevano una tariffa NON ricevono un prezzo inventato: vengono segnalate come “Tariffa da impostare”.
- Da Impostazioni puoi esportare e importare un backup JSON.
- La cronologia di sicurezza conserva versioni precedenti dei dati locali.

TARIFFE
- Lezione collettiva: €10 per alunno
- Lezione individuale: €20
- Cliente abituale: €15
Le tariffe sono identiche per DAD e presenza.

CONTABILITÀ
- Vengono conteggiate solo le lezioni segnate come Svolte.
- Le lezioni passate non confermate restano in “Da verificare”.
- I totali mensili vengono calcolati automaticamente dalle tariffe delle singole lezioni.
- È disponibile una correzione manuale del totale mensile, se necessaria.
- Lo stato pagamento è Da inviare / Non pagato / Pagato.
- Il CSV mensile contiene anche tariffa e importi.

NAVIGAZIONE
- Le schermate interne hanno un tasto Indietro.
- I popup e il flusso Nuova lezione hanno un tasto Indietro dedicato: non serve ricaricare la pagina.


AGGIORNAMENTO V6 — CONTABILITÀ E MENSILI
- Prezzi a lezione: €10 collettiva, €20 individuale, €15 cliente abituale.
- La durata NON moltiplica il prezzo: una lezione da 1,5h conta come 1 lezione.
- Riepilogo pagamento con numero lezioni x tariffa e totale automatico.
- Totale finale sempre modificabile manualmente per sconti/casi particolari.
- Piano MENSILE per singolo alunno con quota fissa.
- Per un alunno mensile, la quota non viene richiesta a ogni lezione.
- Per OGNI nuova lezione mensile si scelgono sempre data, ora e modalità DAD/Presenza.
- La durata usa il valore abituale impostato nell'anagrafica dell'alunno.
- Nel riepilogo mensile vengono conteggiate le lezioni effettivamente svolte,
  mantenendo la quota mensile fissa.
- I dati esistenti restano nello stesso archivio locale del browser.


AGGIORNAMENTO V6.1 — MODALITÀ MENSILI
- Correzione richiesta: per gli alunni con piano mensile DAD/Presenza non è più preimpostato.
- Dopo data e ora, il flusso obbliga a scegliere DAD oppure Presenza prima della conferma.
- La quota mensile resta automatica e non viene richiesta durante la creazione della lezione.
