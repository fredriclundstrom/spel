# Flygbygget

Multiplayerspel för 1 till 4 spelare i webbläsaren.

1. En spelare trycker **Skapa nytt spel** och får en fyrbokstavskod. Länken (`?kod=ABCD`) kan skickas till de andra.
2. Alla bygger planet i hangaren: öppna lådor, hitta delarna, bär dem till ritningen. Ordningen spelar roll, en låda är låst och det ligger skräp i flera lådor.
3. Kliv in genom dörren och veva igång motorn tillsammans.
4. Hoppa när det känns rätt, dra fallskärmen i tid och styr mot tavlan. Närmast mitten vinner.

Styrning: piltangenter/WASD och mellanslag. På mobil: dra med tummen och tryck på knappen.

Tekniskt: ren HTML/JS utan byggsteg. Spelarna kopplas ihop direkt med varandra via WebRTC (PeerJS och dess gratis mäklartjänst), så det räcker med statisk hosting som GitHub Pages. Den som skapar spelet är värd; stänger värden fliken tar spelet slut.
