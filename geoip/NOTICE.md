# GeoIP data

The Docker image bundles DB-IP IP to Country Lite. Local development downloads
the same database using `npm run geoip:download`. Runtime lookups are local.

IP Geolocation by [DB-IP](https://db-ip.com), licensed under
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
The database is updated monthly upstream; rebuild the image or explicitly run
the download command to refresh it. No accuracy guarantee is implied.
