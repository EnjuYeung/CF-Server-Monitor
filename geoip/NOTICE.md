# GeoIP data

The Docker image bundles DB-IP IP to Country Lite. Local development downloads
the same database using `npm run geoip:download`. Runtime lookups are local.

IP Geolocation by [DB-IP](https://db-ip.com), licensed under
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
The database is updated monthly upstream. The controller checks in the background
at startup and every 24 hours, saves validated updates under DATA_DIR/geoip, and
switches local readers without restarting. Failed updates retain the active
database and retry the next day. The bundled database remains an offline fallback;
`npm run geoip:download` refreshes that build/development copy. No accuracy
guarantee is implied.
